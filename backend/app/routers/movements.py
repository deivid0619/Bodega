"""Escaneo: aplicar entradas, salidas y conteos, ver el historial y
deshacer el último movimiento."""
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import models, push, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/movements", tags=["movimientos"])


@router.post("", response_model=schemas.MovementResult)
def apply_movement(payload: schemas.MovementIn, background: BackgroundTasks, db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    try:
        product, movs = inv.apply_movement(db, payload.sku.strip().upper(), payload.type, payload.qty, user,
                                           location_id=payload.location_id)
    except inv.UnknownSku as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    for event in push.movement_events(product, payload.type, movs, user):
        background.add_task(push.notify, *event)
    names = ser.loc_names(db)
    return schemas.MovementResult(
        product=ser.one_product_out(db, product, names),
        movement=ser.movement_out(movs[-1], names),
        movements=[ser.movement_out(m, names) for m in movs],
    )


@router.get("", response_model=list[schemas.MovementOut])
def list_movements(
    type: Optional[Literal["in", "out", "set", "new", "move"]] = None,
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
    names = ser.loc_names(db)
    return [ser.movement_out(m, names) for m in q.limit(limit).all()]


@router.post("/{movement_id}/undo", response_model=schemas.ProductOut)
def undo(movement_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    try:
        product = inv.undo_last_movement(db, movement_id, user)
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    if product not in db:  # el deshacer de un registro nuevo borra la prenda
        names = ser.loc_names(db)
        return ser.product_out(product, names, {})
    return ser.one_product_out(db, product)
