"""Inventario: buscar, ver, editar y eliminar códigos de producto."""
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import catalog
from .. import inventory_service as inv
from .. import layout_service as lsvc
from .. import models, push, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/products", tags=["inventario"])


def _out(db: Session, p: models.Product) -> schemas.ProductOut:
    return ser.one_product_out(db, p)


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
    return ser.products_out(db, products)


@router.get("/{sku}", response_model=schemas.ProductOut)
def get_product(sku: str, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    return _out(db, p)


@router.post("", response_model=schemas.MovementResult, status_code=status.HTTP_201_CREATED)
def create_product(payload: schemas.ProductCreateIn, background: BackgroundTasks, db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    image = payload.image_url or (catalog.lookup(payload.sku) or {}).get("image")
    try:
        product, movement = inv.register_product(
            db, payload.sku, payload.name, payload.size, payload.location_id,
            payload.qty, payload.min_qty, user, image_url=image,
        )
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    if movement.qty > 0:
        for event in push.movement_events(product, "new", [movement], user):
            background.add_task(push.notify, *event)
    names = ser.loc_names(db)
    return schemas.MovementResult(
        product=ser.one_product_out(db, product, names),
        movement=ser.movement_out(movement, names),
        movements=[ser.movement_out(movement, names)],
    )


@router.patch("/{sku}", response_model=schemas.ProductOut)
def update_product(sku: str, payload: schemas.ProductUpdateIn, db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    if payload.location_id is not None and payload.location_id != p.location_id:
        if payload.location_id not in inv.location_ids(db):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa ubicación no existe.")
        rows = [r for r in db.query(models.Stock).filter(models.Stock.sku == p.sku).all() if r.qty > 0]
        if len(rows) == 1 and rows[0].location_id == p.location_id:
            # todo estaba en la ubicacion principal: las prendas se van con ella
            inv.move_stock(db, p.sku, p.location_id, payload.location_id, rows[0].qty, user)
            db.refresh(p)
        p.location_id = payload.location_id
    if payload.name is not None and payload.name.strip():
        p.name = payload.name.strip().upper()
    if payload.size is not None:
        p.size = payload.size.strip().upper()
    if payload.min_qty is not None:
        p.min_qty = payload.min_qty
    if payload.image_url is not None:
        p.image_url = payload.image_url or None
    db.commit()
    db.refresh(p)
    return _out(db, p)


@router.post("/{sku}/move", response_model=schemas.MovementResult)
def move_product(sku: str, payload: schemas.MoveIn, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    try:
        product, movement = inv.move_stock(db, sku.strip().upper(), payload.from_location,
                                           payload.to_location, payload.qty, user)
    except inv.UnknownSku as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    except inv.InventoryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    names = ser.loc_names(db)
    out = ser.movement_out(movement, names)
    return schemas.MovementResult(product=ser.one_product_out(db, product, names), movement=out, movements=[out])


@router.delete("/{sku}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(sku: str, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    p = db.query(models.Product).filter(models.Product.sku == sku.upper()).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está registrado.")
    db.delete(p)
    db.commit()


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def reset_inventory(confirm: str = "", db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Empezar de cero: borra prendas, existencias, historial, reserva, lo de
    paso y los documentos (facturas, remisiones, conteos). Conserva las cuentas y la
    distribución de la bodega. Pide la palabra BORRAR para que no se
    dispare por accidente."""
    if confirm.strip().upper() != "BORRAR":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribe BORRAR para confirmar.")
    db.query(models.Stock).delete()
    db.query(models.Movement).delete()
    db.query(models.Product).delete()
    db.query(models.ReserveItem).delete()
    db.query(models.Document).delete()
    db.query(models.Parcel).delete()
    db.commit()
