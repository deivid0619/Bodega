"""Remisiones: la entrada de mercancia de un proveedor, ya contada. Ver
README.md de este modulo (datos, rutas y reglas)."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.database import get_db
from app.core.deps import get_current_user
from app.modules.avisos import push
from app.modules.bodega.logic import DISPATCH
from app.modules.catalogo import service as catalog
from app.modules.inventario import service as inv, serializers as ser
from app.modules.documentos.service import already, norm_number

router = APIRouter(prefix="/api/documents", tags=["remisiones"])


@router.get("/recent-entries", response_model=list[schemas.RecentEntryOut])
def recent_entries(skus: str = Query(min_length=1, max_length=4000), days: int = Query(default=3, ge=1, le=30),
                   db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Lo que entro de estos codigos escaneando o a mano (sin remision) en los
    ultimos dias: si llega la remision de algo que ya se entro, es solo
    registro y no se debe sumar otra vez."""
    codes = {inv.resolve_sku(db, s) for s in skus.split(",")[:300] if s.strip()}
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (db.query(models.Movement.sku, func.sum(models.Movement.qty), func.max(models.Movement.created_at))
            .filter(models.Movement.sku.in_(codes), models.Movement.type.in_(("in", "new")),
                    models.Movement.created_at >= since,
                    or_(models.Movement.note.is_(None), models.Movement.note == ""))
            .group_by(models.Movement.sku).all())
    return [schemas.RecentEntryOut(sku=sku, qty=qty, last_at=last) for sku, qty, last in rows if qty]


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
    entra a la bodega (a la ubicacion elegida para su referencia, o a su
    ubicacion principal); sin codigo, o si se elige la reserva, queda en la
    reserva. Todo junto o nada."""
    number = norm_number(payload.number or "")
    if not number:
        # el papel no trae numero: uno automatico con la fecha y la hora (asi
        # no se puede revisar si ya entro, pero queda guardada)
        number = f"SN-{datetime.now(ser.BOGOTA):%m%d-%H%M%S}"
    prev = already(db, "remision", number)
    if prev:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"La remisión {number} ya entró el {when} ({prev.user_name}). "
                            "Si es otra entrega de la misma orden, márcala como otra entrega.")

    to_bodega = payload.destination == "bodega"
    passing = payload.destination == "despacho"
    record = payload.destination == "registro"  # solo el papel: lo que llego ya se habia entrado
    # la misma talla repetida se suma (si va al mismo lugar: una referencia se
    # puede repartir en dos ubicaciones)
    merged: dict[tuple[str, str, Optional[str], Optional[str], bool], list[int]] = {}
    for line in payload.lines:
        sku = inv.resolve_sku(db, line.sku or "") or None
        # repartida: esta parte de la talla va a la reserva aunque el resto entre a la bodega
        to_res = bool(line.to_reserve) and to_bodega
        loc = ((line.location_id or payload.location_id or "").strip() or None) if to_bodega and not to_res else None
        key = (" ".join(line.name.upper().split()), line.size.strip().upper(), sku, loc, to_res)
        acc = merged.setdefault(key, [0, 0])
        acc[0] += line.qty
        acc[1] += line.pending
    if not any(q or p for q, p in merged.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La remisión no tiene cantidades.")

    note = f"{inv.REMISION_NOTE}{number}"
    out_lines: list[dict] = []
    touched: list[str] = []
    try:
        chosen = {k[3] for k in merged if k[3]}
        if chosen - inv.location_ids(db):
            raise inv.InventoryError("Esa ubicación no existe.")
        for (name, size, sku, loc, to_res), (qty, pending) in merged.items():
            row = {"name": name, "size": size, "sku": sku, "qty": qty, "pending": pending,
                   "dest": None, "location_id": None}
            out_lines.append(row)
            if qty == 0:
                continue
            if record:
                row["dest"] = "registro"
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
            if not to_bodega or not sku or to_res:
                inv.add_to_reserve(db, product.name if product else name, product.size if product else size, sku, qty)
                row["dest"] = "reserva"
                continue
            if product:
                _, movs = inv.apply_movement(db, sku, "in", qty, user, location_id=loc, note=note, commit=False)
                row["location_id"] = movs[-1].location_id
            else:
                loc = loc or _sibling_location(db, name, {k[2] for k in merged if k[0] == name and k[2]})
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
            mode="registro" if record else None, user_id=user.id, user_name=user.name,
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
                        f"{'Solo registro: ' if record else ''}Entraron {doc.units} prendas{owed} · {user.name}",
                        "/summary", f"doc-{number}", user.id)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))
