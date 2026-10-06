"""Documentos que mueven inventario de una vez: la factura (todo lo que
salio en un despacho), la remision de un proveedor (lo que llego) y el
conteo de una ubicacion. Se aplican completos o nada, y el mismo numero no
se puede aplicar dos veces."""
from datetime import datetime
from typing import Literal, Optional

import threading
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import catalog, photo_store
from ..database import SessionLocal
from ..migrations import purge_old_photos
from ..layout_logic import DISPATCH
from .. import inventory_service as inv
from .. import models, push, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/documents", tags=["documentos"])


def _norm_number(number: str) -> str:
    return "".join(number.upper().split())


def _already(db: Session, kind: str, number: str) -> Optional[models.Document]:
    return db.query(models.Document).filter_by(kind=kind, number=number).first()


# ---- fotos del papel: la prueba de lo que llego y lo que salio ----
def _purge_in_background() -> None:
    def run():
        db = SessionLocal()
        try:
            purge_old_photos(db)
        finally:
            db.close()
    threading.Thread(target=run, daemon=True).start()


@router.get("/photo-store", response_model=schemas.PhotoStoreOut)
def photo_store_status(_: models.User = Depends(get_current_user)):
    """Si las fotos se estan guardando bien (en el Resumen)."""
    return photo_store.status()


@router.post("/{doc_id}/photos", response_model=schemas.DocumentOut)
async def add_photo(doc_id: int, request: Request, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    """Guarda la foto de la remision o la factura (la app la manda ya
    achicada, como JPG). Se guarda un mes y despues se borra sola."""
    doc = db.get(models.Document, doc_id)
    if not doc or doc.kind not in ("factura", "remision"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese documento no existe.")
    if not photo_store.usable():
        # en produccion sin Supabase se perderian al reiniciar: mejor decirlo
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, photo_store.NOT_READY)
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype not in photo_store.TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Solo fotos (JPG, PNG o WebP).")
    data = await request.body()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La foto llegó vacía. Intenta otra vez.")
    if len(data) > photo_store.MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "La foto es muy grande.")
    photos = list(doc.photos or [])
    if len(photos) >= photo_store.MAX_PER_DOC:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya tiene {photo_store.MAX_PER_DOC} fotos.")
    path = f"{doc.kind}/{doc.id}-{uuid.uuid4().hex[:12]}.{photo_store.TYPES[ctype]}"
    try:
        await run_in_threadpool(photo_store.put, path, data, ctype)
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo guardar la foto. Intenta otra vez.")
    doc.photos = photos + [{"path": path, "type": ctype, "size": len(data)}]
    db.commit()
    db.refresh(doc)
    _purge_in_background()  # de paso, las de hace mas de un mes
    return doc


@router.get("/{doc_id}/photos/{index}")
def get_photo(doc_id: int, index: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """La foto (para verla o descargarla). Solo con sesion: nunca es publica."""
    doc = db.get(models.Document, doc_id)
    photos = (doc.photos or []) if doc else []
    if not 0 <= index < len(photos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan un mes.")
    p = photos[index]
    try:
        data = photo_store.get(p["path"])
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo traer la foto. Intenta otra vez.")
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan un mes.")
    return Response(content=data, media_type=p.get("type") or "image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("", response_model=list[schemas.DocumentOut])
def list_documents(kind: Optional[Literal["factura", "remision", "conteo"]] = None, number: Optional[str] = None,
                   base: Optional[str] = None, prefix: Optional[str] = None, limit: int = Query(default=30, le=200),
                   db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    q = db.query(models.Document).order_by(models.Document.id.desc())
    if kind:
        q = q.filter(models.Document.kind == kind)
    if number:
        q = q.filter(models.Document.number == _norm_number(number))
    if prefix:
        # conteos de una ubicacion: P-D1@...
        q = q.filter(models.Document.number.startswith(prefix.upper(), autoescape=True))
    if base:
        # todas las entregas de una misma orden: OPR123, OPR123#2, OPR123#3...
        b = _norm_number(base).split("#")[0]
        q = q.filter(or_(models.Document.number == b,
                         models.Document.number.startswith(b + "#", autoescape=True)))
    return q.limit(limit).all()


@router.post("/factura", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_factura(payload: schemas.FacturaIn, background: BackgroundTasks, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    number = _norm_number(payload.number)
    prev = _already(db, "factura", number)
    if prev:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se descontó el {when} ({prev.user_name}).")

    # la misma referencia repetida en la factura se descuenta una sola vez, sumada
    merged: dict[tuple[str, Optional[str]], int] = {}
    for line in payload.lines:
        key = (inv.resolve_sku(db, line.sku), line.location_id or None)
        merged[key] = merged.get(key, 0) + line.qty

    note = f"Factura {number}"
    touched: list[str] = []
    first_before: dict[str, int] = {}
    try:
        # primero lo que sale de una ubicacion elegida; despues lo de "donde
        # haya", para que no se lleve lo de la canasta que se eligio
        for (sku, loc), qty in sorted(merged.items(), key=lambda kv: kv[0][1] is None):
            _, movs = inv.apply_movement(db, sku, "out", qty, user, location_id=loc, note=note, commit=False)
            first_before.setdefault(sku, movs[0].before)
            touched.append(sku)
        doc = models.Document(
            kind="factura", number=number, units=sum(merged.values()),
            lines=[{"sku": sku, "qty": qty, "location_id": loc} for (sku, loc), qty in merged.items()],
            user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{sku}: {e} No se descontó nada de la factura.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se descontó.")
    db.refresh(doc)
    products = db.query(models.Product).filter(models.Product.sku.in_(set(touched))).all()
    background.add_task(push.notify, "docs", f"Factura {number}",
                        f"Salieron {doc.units} prendas · {user.name}", "/summary", f"doc-{number}", user.id)
    for p in products:
        if p.min_qty > 0 and first_before.get(p.sku, 0) > p.min_qty >= p.qty:
            background.add_task(push.notify, "low", f"Bajo mínimo · {push.label(p.name, p.size)}",
                                f"Quedan {p.qty} (mínimo {p.min_qty}). Revisa la reserva o haz el pedido.",
                                "/summary", f"low-{p.sku}", None)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


def _sibling_location(db: Session, name: str, skus: set[str]) -> Optional[str]:
    """Donde estan las otras tallas de la referencia (por nombre, o las tallas
    de la misma referencia que ya estan registradas): una talla nueva se
    guarda con ellas si no se elige otra ubicacion."""
    q = db.query(models.Product).filter((models.Product.name == name) | (models.Product.sku.in_(skus or {""})))
    p = q.order_by(models.Product.qty.desc()).first()
    return p.location_id if p else None


@router.post("/remision", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_remision(payload: schemas.RemisionIn, background: BackgroundTasks, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    """Entrada de mercancia de un proveedor, ya contada. Cada talla con codigo
    entra a la bodega (a su ubicacion principal o a la elegida); sin codigo, o
    si se elige la reserva, queda en la reserva. Todo junto o nada."""
    number = _norm_number(payload.number or "")
    if not number:
        # el papel no trae numero: uno automatico con la fecha y la hora (asi
        # no se puede revisar si ya entro, pero queda guardada)
        number = f"SN-{datetime.now(ser.BOGOTA):%m%d-%H%M%S}"
    prev = _already(db, "remision", number)
    if prev:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"La remisión {number} ya entró el {when} ({prev.user_name}). "
                            "Si es otra entrega de la misma orden, márcala como otra entrega.")

    # la misma talla repetida se suma
    merged: dict[tuple[str, str, Optional[str]], list[int]] = {}
    for line in payload.lines:
        sku = inv.resolve_sku(db, line.sku or "") or None
        key = (" ".join(line.name.upper().split()), line.size.strip().upper(), sku)
        acc = merged.setdefault(key, [0, 0])
        acc[0] += line.qty
        acc[1] += line.pending
    if not any(q or p for q, p in merged.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La remisión no tiene cantidades.")

    note = f"{inv.REMISION_NOTE}{number}"
    out_lines: list[dict] = []
    touched: list[str] = []
    to_bodega = payload.destination == "bodega"
    passing = payload.destination == "despacho"
    try:
        if to_bodega and payload.location_id and payload.location_id not in inv.location_ids(db):
            raise inv.InventoryError("Esa ubicación no existe.")
        for (name, size, sku), (qty, pending) in merged.items():
            row = {"name": name, "size": size, "sku": sku, "qty": qty, "pending": pending,
                   "dest": None, "location_id": None}
            out_lines.append(row)
            if qty == 0:
                continue
            product = db.get(models.Product, sku) if sku else None
            if passing:
                # de paso: se cuenta en Despacho; sin codigo no se puede (no queda en la bodega)
                if not sku:
                    raise inv.InventoryError(f"{name} {size}: para dejarla de paso hace falta el código de la etiqueta.".replace("  ", " "))
                if product:
                    inv.apply_movement(db, sku, "in", qty, user, location_id=DISPATCH, note=note, commit=False)
                else:
                    image = (catalog.lookup(sku, fetch=False) or {}).get("image")
                    inv.register_product(db, sku, name, size, DISPATCH, qty, 0, user, image_url=image, note=note, commit=False)
                row["dest"], row["location_id"] = "despacho", DISPATCH
                touched.append(sku)
                continue
            if not to_bodega or not sku:
                inv.add_to_reserve(db, product.name if product else name, product.size if product else size, sku, qty)
                row["dest"] = "reserva"
                continue
            if product:
                _, movs = inv.apply_movement(db, sku, "in", qty, user, location_id=payload.location_id,
                                             note=note, commit=False)
                row["location_id"] = movs[-1].location_id
            else:
                loc = payload.location_id or _sibling_location(db, name, {k[2] for k in merged if k[0] == name and k[2]})
                if not loc:
                    raise inv.InventoryError(f"{sku} es un código nuevo: elige en qué ubicación guardarlo.")
                image = (catalog.lookup(sku, fetch=False) or {}).get("image")
                inv.register_product(db, sku, name, size, loc, qty, 0, user, image_url=image, note=note, commit=False)
                row["location_id"] = loc
            row["dest"] = "bodega"
            touched.append(sku)
        doc = models.Document(
            kind="remision", number=number, supplier=payload.supplier.strip() or None, doc_date=payload.date,
            notes=" ".join(payload.notes.split()) or None,
            lines=out_lines, units=sum(r["qty"] for r in out_lines), pending=sum(r["pending"] for r in out_lines),
            user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No entró nada de la remisión.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"La remisión {number} ya entró.")
    db.refresh(doc)
    products = db.query(models.Product).filter(models.Product.sku.in_(set(touched))).all() if touched else []
    owed = f" · quedaron debiendo {doc.pending}" if doc.pending else ""
    shown = "sin número" if number.startswith("SN-") else number
    background.add_task(push.notify, "docs", f"Remisión {shown}" + (f" · {doc.supplier}" if doc.supplier else ""),
                        f"Entraron {doc.units} prendas{owed} · {user.name}", "/summary", f"doc-{number}", user.id)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


@router.post("/conteo", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_count(payload: schemas.CountIn, background: BackgroundTasks, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    """Conteo de una ubicacion: cada codigo contado queda con lo que se conto
    EN ESA ubicacion (las demas no se tocan). Solo los que no cuadran generan
    un ajuste en el historial; el conteo completo queda guardado."""
    loc = payload.location_id
    if loc not in inv.location_ids(db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa ubicación no existe.")
    counted: dict[str, int] = {}
    for line in payload.lines:
        counted[inv.resolve_sku(db, line.sku)] = line.qty

    note = f"Conteo {loc}"
    out_lines: list[dict] = []
    try:
        for sku, qty in counted.items():
            if db.get(models.Product, sku) is None:
                raise inv.UnknownSku(f"El código {sku} no está registrado.")
            row = (db.query(models.Stock).filter_by(sku=sku, location_id=loc)
                   .with_for_update().first())
            before = row.qty if row else 0
            if qty != before:
                inv.apply_movement(db, sku, "set", qty, user, location_id=loc, note=note, commit=False)
            out_lines.append({"sku": sku, "before": before, "counted": qty})
        stamp = datetime.now(ser.BOGOTA).strftime("%Y%m%d%H%M%S")
        doc = models.Document(
            kind="conteo", number=f"{loc[:24]}@{stamp}", lines=out_lines,
            units=sum(abs(l["counted"] - l["before"]) for l in out_lines),
            user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se guardó el conteo.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese conteo ya se guardó.")
    db.refresh(doc)
    products = db.query(models.Product).filter(models.Product.sku.in_(list(counted))).all()
    fixed = sum(1 for l in out_lines if l["counted"] != l["before"])
    if fixed:
        background.add_task(push.notify, "set", f"Conteo de {loc}",
                            f"{fixed} {'ajuste' if fixed == 1 else 'ajustes'} · {user.name}", "/summary", f"count-{loc}", user.id)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))
