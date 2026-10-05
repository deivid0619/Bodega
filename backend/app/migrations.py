"""Cambios de esquema que create_all no hace solo (agregar columnas a tablas
que ya existen en produccion) y el paso de las existencias al esquema por
ubicacion. Todo es idempotente: se puede correr en cada arranque."""
from sqlalchemy import func, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from . import models


def ensure_columns(engine: Engine) -> None:
    cols = {c["name"] for c in inspect(engine).get_columns("movements")}
    if "to_location_id" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE movements ADD COLUMN to_location_id VARCHAR(32)"))


def backfill_stock(db: Session) -> None:
    """Antes cada codigo tenia una sola ubicacion con su cantidad; ahora las
    existencias van por ubicacion. Los codigos que todavia no tienen filas
    de existencias reciben una en su ubicacion de siempre, y el total de
    cada codigo se iguala a la suma por ubicacion."""
    with_rows = {sku for (sku,) in db.query(models.Stock.sku).distinct()}
    for p in db.query(models.Product).filter(models.Product.qty > 0).all():
        if p.sku not in with_rows:
            db.add(models.Stock(sku=p.sku, location_id=p.location_id, qty=p.qty))
    db.flush()
    db.query(models.Stock).filter(models.Stock.qty <= 0).delete(synchronize_session=False)
    sums = dict(db.query(models.Stock.sku, func.sum(models.Stock.qty)).group_by(models.Stock.sku).all())
    for p in db.query(models.Product).all():
        total = int(sums.get(p.sku) or 0)
        if p.qty != total:
            p.qty = total
    db.commit()
