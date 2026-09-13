"""Escaneo: aplicar entradas, salidas y conteos, ver el historial y
deshacer el último movimiento."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/movements", tags=["movimientos"])


def _mv_out(db: Session, m: models.Movement) -> schemas.MovementOut:
    return schemas.MovementOut(
        id=m.id, sku=m.sku, type=m.type, qty=m.qty, before=m.before, after=m.after,
        location_id=m.location_id, location_name=inv._loc_name(db, m.location_id),
        product_name=m.product_name, product_size=m.product_size, user_name=m.user_name,
        demo=m.demo, created_at=m.created_at,
    )


def _prod_out(db: Session, p: models.Product) -> schemas.ProductOut:
    return schemas.ProductOut(
        sku=p.sku, name=p.name, size=p.size, location_id=p.location_id,
        location_name=inv._loc_name(db, p.location_id), qty=p.qty, min_qty=p.min_qty,
        demo=p.demo, out_30d=inv.out_30d(db, p.sku), created_at=p.created_at, updated_at=p.updated_at,
    )


@router.post("", response_model=schemas.MovementResult)
def apply_movement(payload: schemas.MovementIn, db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    try:
        product, movement = inv.apply_movement(db, payload.sku.strip().upper(), payload.type, payload.qty, user)
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return schemas.MovementResult(product=_prod_out(db, product), movement=_mv_out(db, movement))


@router.get("", response_model=list[schemas.MovementOut])
def list_movements(
    type: Optional[Literal["in", "out", "set", "new"]] = None,
    sku: Optional[str] = None,
    limit: int = Query(default=150, le=500),
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    q = db.query(models.Movement).order_by(models.Movement.id.desc())
    if type:
        q = q.filter(models.Movement.type == type)
    if sku:
        q = q.filter(models.Movement.sku == sku.upper())
    return [_mv_out(db, m) for m in q.limit(limit).all()]


@router.post("/{movement_id}/undo", response_model=schemas.ProductOut)
def undo(movement_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    try:
        product = inv.undo_last_movement(db, movement_id, user)
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return _prod_out(db, product)
