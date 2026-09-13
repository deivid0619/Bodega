"""Inventario: buscar, ver, editar y eliminar códigos de producto."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import layout_service as lsvc
from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/products", tags=["inventario"])


def _out(db: Session, p: models.Product) -> schemas.ProductOut:
    return schemas.ProductOut(
        sku=p.sku, name=p.name, size=p.size, location_id=p.location_id,
        location_name=inv._loc_name(db, p.location_id), qty=p.qty, min_qty=p.min_qty,
        demo=p.demo, out_30d=inv.out_30d(db, p.sku), created_at=p.created_at, updated_at=p.updated_at,
    )


@router.get("", response_model=list[schemas.ProductOut])
def list_products(
    search: Optional[str] = None,
    filter: Optional[Literal["low", "zero", "orphan"]] = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    q = db.query(models.Product)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            (models.Product.sku.ilike(like)) | (models.Product.name.ilike(like)) |
            (models.Product.size.ilike(like)) | (models.Product.location_id.ilike(like))
        )
    products = q.all()
    from ..layout_logic import all_locations
    loc_map = all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                              for e in db.query(models.Element).all()])
    if filter == "low":
        products = [p for p in products if p.min_qty > 0 and p.qty <= p.min_qty]
    elif filter == "zero":
        products = [p for p in products if p.qty == 0]
    elif filter == "orphan":
        products = [p for p in products if p.location_id not in loc_map]
    products.sort(key=lambda p: (p.name, p.size))
    return [_out(db, p) for p in products]


@router.get("/{sku}", response_model=schemas.ProductOut)
def get_product(sku: str, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    return _out(db, p)


@router.post("", response_model=schemas.MovementResult, status_code=status.HTTP_201_CREATED)
def create_product(payload: schemas.ProductCreateIn, db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    try:
        product, movement = inv.register_product(
            db, payload.sku, payload.name, payload.size, payload.location_id,
            payload.qty, payload.min_qty, user,
        )
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return schemas.MovementResult(
        product=_out(db, product),
        movement=schemas.MovementOut(
            id=movement.id, sku=movement.sku, type=movement.type, qty=movement.qty,
            before=movement.before, after=movement.after, location_id=movement.location_id,
            location_name=inv._loc_name(db, movement.location_id), product_name=movement.product_name,
            product_size=movement.product_size, user_name=movement.user_name, demo=movement.demo,
            created_at=movement.created_at,
        ),
    )


@router.patch("/{sku}", response_model=schemas.ProductOut)
def update_product(sku: str, payload: schemas.ProductUpdateIn, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    from ..layout_logic import all_locations
    if payload.location_id is not None:
        loc_map = all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                                  for e in db.query(models.Element).all()])
        if payload.location_id not in loc_map:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa ubicación no existe.")
        p.location_id = payload.location_id
    if payload.name is not None and payload.name.strip():
        p.name = payload.name.strip().upper()
    if payload.size is not None:
        p.size = payload.size.strip().upper()
    if payload.min_qty is not None:
        p.min_qty = payload.min_qty
    db.commit()
    db.refresh(p)
    return _out(db, p)


@router.delete("/{sku}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(sku: str, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    db.delete(p)
    db.commit()


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def reset_inventory(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Borra todas las prendas y el historial, pero conserva la distribución
    de la bodega y las cuentas de usuario."""
    db.query(models.Movement).delete()
    db.query(models.Product).delete()
    db.commit()
