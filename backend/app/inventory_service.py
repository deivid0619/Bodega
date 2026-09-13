"""Logica de inventario: registrar prendas, aplicar movimientos con bloqueo
de fila (para que dos personas escaneando al tiempo no se pisen), deshacer,
y los reportes de pedidos e historial."""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .layout_logic import all_locations


class InventoryError(Exception):
    """Un movimiento no se pudo aplicar (cantidad invalida, no hay
    suficiente existencia, ubicacion inexistente...)."""


def _loc_name(db: Session, location_id: str) -> str:
    locs = all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                           for e in db.query(models.Element).all()])
    loc = locs.get(location_id)
    return loc["name"] if loc else f"{location_id} (ya no existe)"


def out_30d(db: Session, sku: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    total = (
        db.query(func.coalesce(func.sum(models.Movement.qty), 0))
        .filter(models.Movement.sku == sku, models.Movement.type == "out", models.Movement.created_at >= since)
        .scalar()
    )
    return int(total or 0)


def register_product(db: Session, sku: str, name: str, size: str, location_id: str,
                      qty: int, min_qty: int, user: models.User) -> tuple[models.Product, models.Movement]:
    sku = sku.strip().upper()
    if db.get(models.Product, sku):
        raise InventoryError(f"El código {sku} ya está registrado.")
    locs = all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                           for e in db.query(models.Element).all()])
    if location_id not in locs:
        raise InventoryError("Esa ubicación no existe.")
    product = models.Product(sku=sku, name=name.strip().upper(), size=size.strip().upper(),
                              location_id=location_id, qty=qty, min_qty=min_qty)
    db.add(product)
    movement = models.Movement(
        sku=sku, type="new", qty=qty, before=0, after=qty, location_id=location_id,
        product_name=product.name, product_size=product.size,
        user_id=user.id, user_name=user.name,
    )
    db.add(movement)
    db.commit()
    db.refresh(product)
    db.refresh(movement)
    return product, movement


def apply_movement(db: Session, sku: str, type_: str, qty: int, user: models.User) -> tuple[models.Product, models.Movement]:
    # SELECT ... FOR UPDATE: si dos personas escanean el mismo codigo al
    # mismo tiempo, la segunda espera a que la primera termine, en vez de
    # que una sobreescriba silenciosamente a la otra.
    product = (
        db.query(models.Product)
        .filter(models.Product.sku == sku)
        .with_for_update()
        .first()
    )
    if not product:
        raise InventoryError("Ese código no está registrado todavía.")

    before = product.qty
    if type_ == "in":
        if qty < 1:
            raise InventoryError("La cantidad debe ser 1 o más.")
        after = before + qty
    elif type_ == "out":
        if qty < 1:
            raise InventoryError("La cantidad debe ser 1 o más.")
        if qty > before:
            raise InventoryError(f"Solo hay {before} de {product.name} {product.size}. La salida no se registró.")
        after = before - qty
    elif type_ == "set":
        after = qty
    else:
        raise InventoryError("Tipo de movimiento inválido.")

    product.qty = after
    logged_qty = abs(after - before) if type_ == "set" else qty
    movement = models.Movement(
        sku=sku, type=type_, qty=logged_qty, before=before, after=after,
        location_id=product.location_id, product_name=product.name, product_size=product.size,
        user_id=user.id, user_name=user.name,
    )
    db.add(movement)
    db.commit()
    db.refresh(product)
    db.refresh(movement)
    return product, movement


def undo_last_movement(db: Session, movement_id: int, user: models.User) -> models.Product:
    last = db.query(models.Movement).order_by(models.Movement.id.desc()).first()
    if not last or last.id != movement_id:
        raise InventoryError("Solo se puede deshacer el último movimiento registrado.")
    product = db.query(models.Product).filter(models.Product.sku == last.sku).with_for_update().first()
    if not product:
        raise InventoryError("La prenda de ese movimiento ya no existe.")
    if last.type == "new":
        db.delete(product)
    else:
        product.qty = last.before
    db.delete(last)
    db.commit()
    return product


def needs(db: Session) -> list[tuple[models.Product, int]]:
    products = db.query(models.Product).filter(models.Product.min_qty > 0, models.Product.qty <= models.Product.min_qty).all()
    out = [(p, max(p.min_qty * 2 - p.qty, 1)) for p in products]
    out.sort(key=lambda pair: pair[0].qty / pair[0].min_qty if pair[0].min_qty else 0)
    return out


def top_movers(db: Session, days: int = 30, limit: int = 5) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(
            models.Movement.sku,
            models.Movement.product_name,
            models.Movement.product_size,
            func.sum(models.Movement.qty).label("total"),
        )
        .filter(models.Movement.type == "out", models.Movement.created_at >= since)
        .group_by(models.Movement.sku, models.Movement.product_name, models.Movement.product_size)
        .order_by(func.sum(models.Movement.qty).desc())
        .limit(limit)
        .all()
    )
    return [{"sku": r.sku, "name": r.product_name, "size": r.product_size, "qty_out": int(r.total)} for r in rows]


DEMO_REFS = [
    ("D-CHQ5001", "CHAQUETA CAMO NEÓN", ["M", "L", "XL"]),
    ("D-CHQ5002", "CHAQUETA TOURING NEGRO", ["S", "M", "L", "XL"]),
    ("D-CHQ5003", "CHAQUETA URBAN AZUL", ["M", "L"]),
    ("D-IMP3001", "IMPERMEABLE 2 PIEZAS NEGRO", ["S", "M", "L", "XL"]),
    ("D-PAN4001", "PANTALÓN CORDURA NEGRO", ["M", "L", "XL"]),
    ("D-GUA6001", "GUANTES VERANO NEGRO", ["S", "M", "L"]),
    ("D-CHL9001", "CHALECO REFLECTIVO NEÓN", ["M", "L"]),
    ("D-BOT2001", "BOTAS IMPERMEABLES", ["M", "L"]),
    ("D-RZ884", "RODILLERA Y CODERA RZ-884", [""]),
]


def has_demo_data(db: Session) -> bool:
    return db.query(models.Product).filter(models.Product.demo.is_(True)).first() is not None


def remove_demo_data(db: Session) -> None:
    db.query(models.Product).filter(models.Product.demo.is_(True)).delete()
    db.query(models.Movement).filter(models.Movement.demo.is_(True)).delete()
    db.commit()


def load_demo_data(db: Session, user: models.User) -> None:
    elements = db.query(models.Element).all()
    all_locs = list(all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params} for e in elements]).keys())
    used = {p.location_id for p in db.query(models.Product).all()}
    free = [l for l in all_locs if l not in used]
    rnd = random.Random(418)
    rnd.shuffle(free)
    made: list[models.Product] = []
    for base, name, sizes in DEMO_REFS:
        for size in sizes:
            if not free:
                break
            sku = base + size
            if db.get(models.Product, sku):
                continue
            loc = free.pop()
            qty = rnd.randint(0, 12)
            p = models.Product(sku=sku, name=name, size=size, location_id=loc, qty=qty, min_qty=3, demo=True)
            db.add(p)
            made.append(p)
    db.flush()
    now = datetime.now(timezone.utc)
    for i in range(60):
        if not made:
            break
        p = rnd.choice(made)
        mtype = "out" if rnd.random() < 0.7 else "in"
        db.add(models.Movement(
            sku=p.sku, type=mtype, qty=1 + rnd.randint(0, 2), before=p.qty, after=p.qty,
            location_id=p.location_id, product_name=p.name, product_size=p.size,
            user_id=user.id, user_name=user.name, demo=True,
            created_at=now - timedelta(seconds=rnd.randint(0, 29 * 24 * 3600)),
        ))
    db.commit()
