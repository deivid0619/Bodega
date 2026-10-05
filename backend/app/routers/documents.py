"""Documentos que mueven inventario de una vez: la factura (todo lo que
salio en un despacho) y, despues, la remision de un proveedor. Se aplican
completos o nada, y el mismo numero no se puede aplicar dos veces."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import models, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/documents", tags=["documentos"])


def _norm_number(number: str) -> str:
    return "".join(number.upper().split())


def _already(db: Session, kind: str, number: str) -> Optional[models.Document]:
    return db.query(models.Document).filter_by(kind=kind, number=number).first()


@router.get("", response_model=list[schemas.DocumentOut])
def list_documents(kind: Optional[Literal["factura", "remision"]] = None, number: Optional[str] = None,
                   limit: int = Query(default=30, le=200), db: Session = Depends(get_db),
                   _: models.User = Depends(get_current_user)):
    q = db.query(models.Document).order_by(models.Document.id.desc())
    if kind:
        q = q.filter(models.Document.kind == kind)
    if number:
        q = q.filter(models.Document.number == _norm_number(number))
    return q.limit(limit).all()


@router.post("/factura", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_factura(payload: schemas.FacturaIn, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    number = _norm_number(payload.number)
    prev = _already(db, "factura", number)
    if prev:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se descontó el {when} ({prev.user_name}).")

    # la misma referencia repetida en la factura se descuenta una sola vez, sumada
    merged: dict[tuple[str, Optional[str]], int] = {}
    for line in payload.lines:
        key = (line.sku.strip().upper(), line.location_id or None)
        merged[key] = merged.get(key, 0) + line.qty

    note = f"Factura {number}"
    touched: list[str] = []
    try:
        for (sku, loc), qty in merged.items():
            inv.apply_movement(db, sku, "out", qty, user, location_id=loc, note=note, commit=False)
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
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))
