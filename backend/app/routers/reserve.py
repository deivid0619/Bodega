"""Bodega de reserva: mercancía guardada aparte, todavía sin ubicación
física, que se va enviando a la bodega principal (con SELECT ... FOR
UPDATE en el envío, igual que un escaneo normal, para que dos personas
enviando la misma referencia al tiempo no se pisen)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import catalog
from .. import inventory_service as inv
from .. import models, push, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user
from .products import _out as _product_out

router = APIRouter(prefix="/api/reserve", tags=["bodega de reserva"])


@router.get("", response_model=list[schemas.ReserveItemOut])
def list_reserve(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    items = db.query(models.ReserveItem).order_by(models.ReserveItem.name, models.ReserveItem.size).all()
    # lo que se guardo sin foto (antes no se guardaba): la de la bodega o la
    # de la tienda, una sola vez; y la prenda de la bodega sin foto toma la
    # de la reserva (una prenda, una foto)
    found = False
    for it in items:
        if it.sku and not it.image_url:
            it.image_url = _photo(db, it.sku)
            found = found or bool(it.image_url)
        if it.sku and it.image_url:
            p = db.get(models.Product, it.sku)
            if p and not p.image_url:
                p.image_url = it.image_url
                found = True
    if found:
        db.commit()
    return items


@router.get("/restock", response_model=list[schemas.RestockOut])
def restock(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Que traer de la reserva a la bodega ahora mismo."""
    rows = inv.restock(db)
    outs = ser.products_out(db, [p for _, p, _ in rows])
    return [schemas.RestockOut(reserve=it, product=o, suggest=n) for o, (it, _, n) in zip(outs, rows)]


@router.post("", response_model=schemas.ReserveItemOut, status_code=status.HTTP_201_CREATED)
def create_reserve(payload: schemas.ReserveItemCreateIn, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    item = models.ReserveItem(
        sku=(payload.sku or "").strip().upper() or None,
        name=payload.name.strip().upper(), size=payload.size.strip().upper(), qty=payload.qty,
        image_url=payload.image_url or None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


# ---- escanear para la reserva: igual que una entrada, pero sin ubicacion ----
def _norm_sku(sku: str) -> str:
    return "".join(str(sku or "").upper().split())


def _code(db: Session, sku: str) -> str:
    """El codigo de la etiqueta, ya corregido si venia mal impreso."""
    return inv.resolve_sku(db, _norm_sku(sku))


def _photo(db: Session, sku: str, fetch: bool = True) -> str | None:
    """La foto de un codigo: la de la bodega o la de la tienda. fetch=False
    no sale a internet (dentro de una transaccion con bloqueo)."""
    p = db.get(models.Product, sku)
    if p and p.image_url:
        return p.image_url
    hit = catalog.lookup(sku, fetch=fetch)
    if not hit:
        # un codigo casi igual en la tienda (P-PRM001800XL / P-PRM00180XL): la
        # foto solo si hay uno solo, para no poner la de otra prenda
        close = catalog.near(sku, fetch=fetch)
        hit = close[0] if len(close) == 1 else None
    return (hit or {}).get("image") or None


def _identify(db: Session, sku: str) -> dict | None:
    """Nombre y talla de un codigo: el de la bodega y, si todavia no esta
    registrado, el de la tienda (el codigo de la etiqueta es el mismo)."""
    p = db.get(models.Product, sku)
    if p:
        return {"name": p.name, "size": p.size or "", "image": p.image_url, "source": "bodega"}
    hit = catalog.lookup(sku)
    if hit:
        return {"name": hit["name"].strip().upper(), "size": (hit.get("size") or "").strip().upper(),
                "image": hit.get("image"), "source": "tienda"}
    # un codigo que solo existe en la reserva (se escribio a mano la primera vez)
    item = db.query(models.ReserveItem).filter(models.ReserveItem.sku == sku).order_by(models.ReserveItem.id).first()
    if item:
        return {"name": item.name, "size": item.size or "", "image": item.image_url, "source": "reserva"}
    return None


def _item_for(db: Session, sku: str, name: str, size: str, lock: bool = False):
    """Lo que ya hay en la reserva de ese codigo; o lo que se guardo a mano sin
    codigo con la misma referencia y talla (asi no queda repetido)."""
    q = db.query(models.ReserveItem)
    if lock:
        q = q.with_for_update()
    item = q.filter(models.ReserveItem.sku == sku).order_by(models.ReserveItem.id).first()
    if not item:
        # sin tildes ni espacios de mas: PROTECCIÓN y PROTECCION son la misma
        want = inv.ref_key(name, size)
        item = next((it for it in q.filter(models.ReserveItem.sku.is_(None)).order_by(models.ReserveItem.id).all()
                     if inv.ref_key(it.name, it.size) == want), None)
    return item


NOT_FOUND = "Ese código no está en la bodega ni en la tienda: escribe la referencia."
FROM_RESERVE = "Desde la reserva"


@router.get("/identify/{sku}", response_model=schemas.ReserveIdentifyOut)
def identify(sku: str, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Que prenda es (sin guardar nada), para la lista "Por confirmar"."""
    sku = _code(db, sku)
    who = _identify(db, sku)
    if not who:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    item = _item_for(db, sku, who["name"], who["size"])
    return schemas.ReserveIdentifyOut(sku=sku, in_reserve=item.qty if item else 0, **who)


@router.post("/scan", response_model=schemas.ReserveScanOut)
def scan_in(payload: schemas.ReserveScanIn, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Suma a la reserva lo escaneado: a lo que ya habia de ese codigo, o
    nuevo con el nombre y la talla de la bodega o de la tienda."""
    label = _norm_sku(payload.sku)
    sku = _code(db, label)
    who = _identify(db, sku)  # puede ir a la tienda: antes de bloquear nada
    if not who:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    item = _item_for(db, sku, who["name"], who["size"], lock=True)
    if not item and label != sku:
        # guardada antes con la etiqueta mal: es la misma
        item = (db.query(models.ReserveItem).filter(models.ReserveItem.sku == label).with_for_update()
                .order_by(models.ReserveItem.id).first())
    created = item is None
    if created:
        item = models.ReserveItem(sku=sku, name=who["name"], size=who["size"], qty=0)
        db.add(item)
    item.sku = sku
    item.image_url = item.image_url or who.get("image")
    item.qty += payload.qty
    db.commit()
    db.refresh(item)
    return schemas.ReserveScanOut(item=item, added=payload.qty, created=created, source=who["source"])


@router.patch("/{item_id}", response_model=schemas.ReserveItemOut)
def update_reserve(item_id: int, payload: schemas.ReserveItemUpdateIn, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    item = db.get(models.ReserveItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese ítem de reserva ya no existe.")
    if payload.sku is not None:
        item.sku = payload.sku.strip().upper() or None
    if payload.name is not None and payload.name.strip():
        item.name = payload.name.strip().upper()
    if payload.size is not None:
        item.size = payload.size.strip().upper()
    if payload.qty is not None:
        item.qty = payload.qty
    db.commit()
    db.refresh(item)
    return item


@router.post("/clean")
def clean_reserve(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Quita de la reserva lo que se acabo (en 0)."""
    removed = db.query(models.ReserveItem).filter(models.ReserveItem.qty <= 0).delete(synchronize_session=False)
    db.commit()
    return {"removed": removed}


# quitar una de la lista es como dejarla en 0 (eso ya lo puede hacer cualquiera)
@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reserve(item_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    item = db.get(models.ReserveItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese ítem de reserva ya no existe.")
    db.delete(item)
    db.commit()


@router.post("/{item_id}/transfer", response_model=schemas.ReserveTransferResult)
def transfer_to_warehouse(item_id: int, payload: schemas.ReserveTransferIn, background: BackgroundTasks,
                           db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    item = (
        db.query(models.ReserveItem)
        .filter(models.ReserveItem.id == item_id)
        .with_for_update()
        .first()
    )
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese ítem de reserva ya no existe.")
    if payload.qty > item.qty:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Solo hay {item.qty} en reserva.")

    sku = inv.resolve_sku(db, payload.sku or item.sku or "")
    if not sku:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta el código (SKU) para enviarlo a la bodega.")

    existing = db.get(models.Product, sku)
    # la prenda llega a la bodega con su foto
    photo = item.image_url or (None if existing and existing.image_url else _photo(db, sku, fetch=False))
    try:
        if existing:
            # entra a la ubicacion elegida, aunque el codigo ya tenga otra principal
            product, movs = inv.apply_movement(db, sku, "in", payload.qty, user, location_id=payload.location_id,
                                               note=FROM_RESERVE)
            if not product.image_url and photo:
                product.image_url = photo
        else:
            product, movement = inv.register_product(
                db, sku, item.name, item.size, payload.location_id, payload.qty, 0, user, image_url=photo,
                note=FROM_RESERVE,
            )
            movs = [movement]
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    item.sku = sku
    item.qty -= payload.qty
    db.commit()
    for kind, title, body, *rest in push.movement_events(product, "in", movs, user):
        background.add_task(push.notify, kind, title, f"{body} · desde la reserva", *rest)
    db.refresh(item)
    db.refresh(product)
    names = ser.loc_names(db)
    out = schemas.ReserveTransferResult(
        reserve=item, product=_product_out(db, product),
        movement=ser.movement_out(movs[-1], names), movements=[ser.movement_out(m, names) for m in movs],
    )
    if item.qty <= 0:
        # se acabo: sale sola de la reserva (no queda una linea en 0)
        db.delete(item)
        db.commit()
    return out
