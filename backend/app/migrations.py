"""Cambios de esquema que create_all no hace solo (agregar columnas a tablas
que ya existen en produccion) y el paso de las existencias al esquema por
ubicacion. Todo es idempotente: se puede correr en cada arranque."""
from sqlalchemy import func, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from . import models

# columnas que se agregaron despues de crear cada tabla
_NEW_COLUMNS = {
    "movements": [("to_location_id", "VARCHAR(32)"), ("note", "VARCHAR(80)")],
    "documents": [("pending", "INTEGER NOT NULL DEFAULT 0"), ("supplier", "VARCHAR(120)"), ("doc_date", "VARCHAR(10)"),
                  ("notes", "VARCHAR(500)")],
    "reserve_items": [("image_url", "VARCHAR(500)")],
}


def ensure_columns(engine: Engine) -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, columns in _NEW_COLUMNS.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in columns:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def table_bins(db: Session) -> None:
    """2026-10-05: las canastas debajo de la mesa blanca tambien guardan
    prendas (18: 6 pilas de 3). Se aplica una sola vez a la distribucion que
    ya existe; si despues se cambia en el editor, no se vuelve a tocar."""
    key = "layout_mesa_18_canastas"
    if db.get(models.AppSetting, key):
        return
    tables = db.query(models.Element).filter(models.Element.type == "table").all()
    if len(tables) == 1 and not (tables[0].params or {}).get("bins"):
        table = tables[0]
        table.params = {**(table.params or {}), "bins": 18}
        if not table.code:
            used = {e.code for e in db.query(models.Element).all() if e.code}
            table.code = next((c for c in "MNOPQRSTUVWXYZ" if c not in used), "M2")
    db.add(models.AppSetting(key=key, value="hecho"))
    db.commit()


def remove_sample_product(db: Session) -> None:
    """2026-10-05: el arranque creaba una prenda de ejemplo (la de la etiqueta
    del prototipo) cada vez que no existia: si se borraba, volvia a salir
    cuando el servidor se reiniciaba. Ya no se crea; esta limpieza quita la
    que quedo, una sola vez y solo si nunca se uso (sin prendas ni historial)."""
    key = "prenda_ejemplo_quitada"
    if db.get(models.AppSetting, key):
        return
    p = db.get(models.Product, "P-WPM210200L")
    if p and p.qty == 0 and not db.query(models.Movement).filter_by(sku=p.sku).first() \
            and not db.query(models.Stock).filter(models.Stock.sku == p.sku, models.Stock.qty > 0).first():
        db.delete(p)
    db.add(models.AppSetting(key=key, value="hecho"))
    db.commit()


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
