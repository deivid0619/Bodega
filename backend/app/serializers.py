"""Convierte filas de la base en respuestas de la API.

Los nombres de ubicacion y las salidas de 30 dias se calculan UNA vez por
peticion (dos consultas en total), no una por prenda: con la base en otro
servidor, consultar por cada fila hacia lenta toda la app."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models, schemas
from .layout_logic import all_locations


def loc_names(db: Session) -> dict[str, str]:
    locs = all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                          for e in db.query(models.Element).all()])
    return {k: v["name"] for k, v in locs.items()}


def out_30d_map(db: Session, skus: list[str] | None = None) -> dict[str, int]:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    q = (db.query(models.Movement.sku, func.sum(models.Movement.qty))
         .filter(models.Movement.type == "out", models.Movement.created_at >= since))
    if skus is not None:
        if not skus:
            return {}
        q = q.filter(models.Movement.sku.in_(skus))
    return {sku: int(total or 0) for sku, total in q.group_by(models.Movement.sku).all()}


def stock_map(db: Session, skus: list[str] | None = None) -> dict[str, list[tuple[str, int]]]:
    q = db.query(models.Stock.sku, models.Stock.location_id, models.Stock.qty).filter(models.Stock.qty > 0)
    if skus is not None:
        if not skus:
            return {}
        q = q.filter(models.Stock.sku.in_(skus))
    out: dict[str, list[tuple[str, int]]] = {}
    for sku, loc, qty in q.all():
        out.setdefault(sku, []).append((loc, qty))
    return out


def _name(names: dict[str, str], location_id: str) -> str:
    return names.get(location_id) or f"{location_id} (ya no existe)"


def product_out(p: models.Product, names: dict[str, str], outs: dict[str, int],
                stock: list[tuple[str, int]] | None = None) -> schemas.ProductOut:
    rows = sorted(stock or [], key=lambda r: (r[0] != p.location_id, -r[1], r[0]))
    return schemas.ProductOut(
        sku=p.sku, name=p.name, size=p.size, location_id=p.location_id,
        location_name=_name(names, p.location_id), qty=p.qty, min_qty=p.min_qty,
        image_url=p.image_url, demo=p.demo, out_30d=outs.get(p.sku, 0),
        stock=[schemas.StockOut(location_id=loc, location_name=_name(names, loc), qty=q) for loc, q in rows],
        created_at=p.created_at, updated_at=p.updated_at,
    )


def movement_out(m: models.Movement, names: dict[str, str]) -> schemas.MovementOut:
    return schemas.MovementOut(
        id=m.id, sku=m.sku, type=m.type, qty=m.qty, before=m.before, after=m.after,
        location_id=m.location_id, location_name=_name(names, m.location_id),
        to_location_id=m.to_location_id,
        to_location_name=_name(names, m.to_location_id) if m.to_location_id else None,
        product_name=m.product_name, product_size=m.product_size, user_name=m.user_name,
        demo=m.demo, created_at=m.created_at,
    )


def products_out(db: Session, products: list[models.Product],
                 names: dict[str, str] | None = None) -> list[schemas.ProductOut]:
    names = names if names is not None else loc_names(db)
    skus = [p.sku for p in products]
    outs = out_30d_map(db, skus)
    stock = stock_map(db, skus)
    return [product_out(p, names, outs, stock.get(p.sku)) for p in products]


def one_product_out(db: Session, p: models.Product, names: dict[str, str] | None = None) -> schemas.ProductOut:
    return products_out(db, [p], names)[0]
