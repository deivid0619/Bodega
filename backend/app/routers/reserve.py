"""Bodega de reserva: mercancía guardada aparte, todavía sin ubicación
física, que se va enviando a la bodega principal (con SELECT ... FOR
UPDATE en el envío, igual que un escaneo normal, para que dos personas
enviando la misma referencia al tiempo no se pisen)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user, require_admin
from .products import _out as _product_out

router = APIRouter(prefix="/api/reserve", tags=["bodega de reserva"])


@router.get("", response_model=list[schemas.ReserveItemOut])
def list_reserve(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    items = db.query(models.ReserveItem).order_by(models.ReserveItem.name, models.ReserveItem.size).all()
    return items


@router.post("", response_model=schemas.ReserveItemOut, status_code=status.HTTP_201_CREATED)
def create_reserve(payload: schemas.ReserveItemCreateIn, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    item = models.ReserveItem(
        sku=(payload.sku or "").strip().upper() or None,
        name=payload.name.strip().upper(), size=payload.size.strip().upper(), qty=payload.qty,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


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


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reserve(item_id: int, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    item = db.get(models.ReserveItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese ítem de reserva ya no existe.")
    db.delete(item)
    db.commit()


@router.post("/{item_id}/transfer", response_model=schemas.ReserveTransferResult)
def transfer_to_warehouse(item_id: int, payload: schemas.ReserveTransferIn, db: Session = Depends(get_db),
                           user: models.User = Depends(get_current_user)):
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

    sku = (payload.sku or item.sku or "").strip().upper()
    if not sku:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta el código (SKU) para enviarlo a la bodega.")

    existing = db.get(models.Product, sku)
    try:
        if existing:
            product, _movement = inv.apply_movement(db, sku, "in", payload.qty, user)
            if existing.location_id != payload.location_id:
                # ya existe con ese sku pero en otra ubicacion: no la movemos
                # sola (podria tener otras prendas ahi), solo avisamos por la
                # ubicacion que ya tiene
                pass
        else:
            product, _movement = inv.register_product(
                db, sku, item.name, item.size, payload.location_id, payload.qty, 0, user,
            )
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    item.sku = sku
    item.qty -= payload.qty
    db.commit()
    db.refresh(item)
    db.refresh(product)
    return schemas.ReserveTransferResult(reserve=item, product=_product_out(db, product))
