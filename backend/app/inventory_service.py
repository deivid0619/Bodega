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


class UnknownSku(InventoryError):
    """El codigo escaneado no esta registrado (la app ofrece registrarlo)."""


def location_ids(db: Session) -> set[str]:
    return set(all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                              for e in db.query(models.Element).all()]).keys())


def _lock(db: Session, sku: str) -> tuple[models.Product, dict[str, models.Stock]]:
    # SELECT ... FOR UPDATE sobre el codigo y sus existencias: si dos personas
    # mueven el mismo codigo al tiempo, la segunda espera a la primera en vez
    # de pisarla.
    product = db.query(models.Product).filter(models.Product.sku == sku).with_for_update().first()
    if not product:
        raise UnknownSku("Ese código no está registrado todavía.")
    rows = db.query(models.Stock).filter(models.Stock.sku == sku).with_for_update().all()
    return product, {r.location_id: r for r in rows}


def _add(db: Session, sku: str, rows: dict[str, models.Stock], location_id: str, delta: int) -> None:
    # las filas en cero no se borran aqui (borrar y volver a crear la misma
    # fila en una transaccion choca con la llave unica); se limpian al arrancar
    row = rows.get(location_id)
    if row is None:
        row = models.Stock(sku=sku, location_id=location_id, qty=0)
        db.add(row)
        rows[location_id] = row
    row.qty += delta


def _total(rows: dict[str, models.Stock]) -> int:
    return sum(r.qty for r in rows.values())


def _movement(product: models.Product, user: models.User, type_: str, qty: int, before: int, after: int,
              location_id: str, to_location_id: str | None = None) -> models.Movement:
    return models.Movement(
        sku=product.sku, type=type_, qty=qty, before=before, after=after,
        location_id=location_id, to_location_id=to_location_id,
        product_name=product.name, product_size=product.size, user_id=user.id, user_name=user.name,
    )


def register_product(db: Session, sku: str, name: str, size: str, location_id: str,
                      qty: int, min_qty: int, user: models.User,
                      image_url: str | None = None) -> tuple[models.Product, models.Movement]:
    sku = sku.strip().upper()
    if db.get(models.Product, sku):
        raise InventoryError(f"El código {sku} ya está registrado.")
    if location_id not in location_ids(db):
        raise InventoryError("Esa ubicación no existe.")
    product = models.Product(sku=sku, name=name.strip().upper(), size=size.strip().upper(),
                              location_id=location_id, qty=qty, min_qty=min_qty,
                              image_url=(image_url or None))
    db.add(product)
    if qty > 0:
        db.add(models.Stock(sku=sku, location_id=location_id, qty=qty))
    movement = _movement(product, user, "new", qty, 0, qty, location_id)
    db.add(movement)
    db.commit()
    db.refresh(product)
    db.refresh(movement)
    return product, movement


def apply_movement(db: Session, sku: str, type_: str, qty: int, user: models.User,
                   location_id: str | None = None) -> tuple[models.Product, list[models.Movement]]:
    """Entrada, salida o conteo de un codigo.

    Entrada y conteo van a location_id o, si no se elige, a la ubicacion
    principal del codigo; el conteo fija lo que hay EN ESA ubicacion.
    Salida: de location_id si se elige; si no, primero de la ubicacion
    principal y luego de donde haya mas (puede tocar varias ubicaciones, una
    fila de historial por cada una).
    """
    product, rows = _lock(db, sku)
    before = product.qty
    valid = location_ids(db)
    if location_id and location_id not in valid:
        raise InventoryError("Esa ubicación no existe.")
    label = f"{product.name} {product.size}".strip()
    movements: list[models.Movement] = []

    if type_ in ("in", "set"):
        loc = location_id or product.location_id
        if loc not in valid:
            raise InventoryError("La ubicación principal de este código ya no existe. Elige dónde guardarlo.")
        current = rows[loc].qty if loc in rows else 0
        if type_ == "in":
            if qty < 1:
                raise InventoryError("La cantidad debe ser 1 o más.")
            delta = qty
        else:
            if qty < 0:
                raise InventoryError("La cantidad no puede ser negativa.")
            delta = qty - current
        _add(db, sku, rows, loc, delta)
        product.qty = _total(rows)
        logged = abs(delta) if type_ == "set" else qty
        movements.append(_movement(product, user, type_, logged, before, product.qty, loc))
    elif type_ == "out":
        if qty < 1:
            raise InventoryError("La cantidad debe ser 1 o más.")
        if location_id:
            have = rows[location_id].qty if location_id in rows else 0
            if qty > have:
                raise InventoryError(f"En {location_id} solo hay {have} de {label}. La salida no se registró.")
            plan = [(location_id, qty)]
        else:
            if qty > before:
                raise InventoryError(f"Solo hay {before} de {label}. La salida no se registró.")
            order = sorted((r for r in rows.values() if r.qty > 0),
                           key=lambda r: (r.location_id != product.location_id, -r.qty))
            plan, left = [], qty
            for r in order:
                take = min(left, r.qty)
                plan.append((r.location_id, take))
                left -= take
                if left == 0:
                    break
        running = before
        for loc, take in plan:
            _add(db, sku, rows, loc, -take)
            movements.append(_movement(product, user, "out", take, running, running - take, loc))
            running -= take
        product.qty = _total(rows)
    else:
        raise InventoryError("Tipo de movimiento inválido.")

    db.add_all(movements)
    db.commit()
    db.refresh(product)
    for m in movements:
        db.refresh(m)
    return product, movements


def move_stock(db: Session, sku: str, from_location: str, to_location: str, qty: int,
               user: models.User) -> tuple[models.Product, models.Movement]:
    """Traslada prendas de una ubicacion a otra (el total no cambia)."""
    if from_location == to_location:
        raise InventoryError("Elige una ubicación distinta a la de origen.")
    product, rows = _lock(db, sku)
    if to_location not in location_ids(db):
        raise InventoryError("Esa ubicación no existe.")
    have = rows[from_location].qty if from_location in rows else 0
    if qty < 1 or qty > have:
        raise InventoryError(f"En {from_location} solo hay {have}.")
    _add(db, sku, rows, from_location, -qty)
    _add(db, sku, rows, to_location, qty)
    # si se llevo todo lo de la ubicacion principal, la principal pasa a ser el destino
    if product.location_id == from_location and rows[from_location].qty == 0:
        product.location_id = to_location
    movement = _movement(product, user, "move", qty, product.qty, product.qty, from_location, to_location)
    db.add(movement)
    db.commit()
    db.refresh(product)
    db.refresh(movement)
    return product, movement


def undo_last_movement(db: Session, movement_id: int, user: models.User) -> models.Product:
    last = db.query(models.Movement).order_by(models.Movement.id.desc()).first()
    if not last or last.id != movement_id:
        raise InventoryError("Solo se puede deshacer el último movimiento registrado.")
    try:
        product, rows = _lock(db, last.sku)
    except UnknownSku:
        raise InventoryError("La prenda de ese movimiento ya no existe.")
    if last.type == "new":
        db.delete(product)
    elif last.type == "move":
        back = rows[last.to_location_id].qty if last.to_location_id in rows else 0
        if back < last.qty:
            raise InventoryError("Esas prendas ya no están en el destino; no se puede deshacer.")
        _add(db, last.sku, rows, last.to_location_id, -last.qty)
        _add(db, last.sku, rows, last.location_id, last.qty)
    else:
        # el cambio del total es justo el cambio en esa ubicacion
        delta = last.after - last.before
        current = rows[last.location_id].qty if last.location_id in rows else 0
        if current - delta < 0:
            raise InventoryError("Las existencias ya cambiaron; no se puede deshacer.")
        _add(db, last.sku, rows, last.location_id, -delta)
        product.qty = _total(rows)
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


# (codigo base, referencia, tallas, va colgada en perchero)
DEMO_REFS = [
    ("D-FNX01", "CHAQUETA FENIX BLACK FEM", ["S", "M", "L", "XL"], True),
    ("D-GNS02", "CHAQUETA GENESIS INVIERNO MASC", ["M", "L", "XL"], True),
    ("D-TRG03", "CHAQUETA TOURING GRIS", ["S", "M", "L", "XL"], True),
    ("D-URB04", "CORTAVIENTOS URBAN AZUL", ["M", "L", "XL"], True),
    ("D-CMO05", "CHAQUETA CAMO NEÓN", ["M", "L"], True),
    ("D-IMP06", "IMPERMEABLE 2 PIEZAS NEGRO", ["S", "M", "L", "XL"], True),
    ("D-XPL07", "BODY ARMOR XPLORER", ["M", "L", "XL"], False),
    ("D-PAN08", "PANTALÓN CORDURA NEGRO", ["M", "L", "XL"], False),
    ("D-GUA09", "GUANTES VERANO NEGRO", ["S", "M", "L"], False),
    ("D-CHL10", "CHALECO REFLECTIVO NEÓN", ["M", "L"], False),
    ("D-RZ884", "RODILLERA Y CODERA RZ-884", [""], False),
]


def has_demo_data(db: Session) -> bool:
    return db.query(models.Product).filter(models.Product.demo.is_(True)).first() is not None


def remove_demo_data(db: Session) -> None:
    demo_skus = [sku for (sku,) in db.query(models.Product.sku).filter(models.Product.demo.is_(True))]
    db.query(models.Stock).filter(models.Stock.sku.in_(demo_skus)).delete(synchronize_session=False)
    db.query(models.Movement).filter(models.Movement.demo.is_(True)).delete(synchronize_session=False)
    db.query(models.Product).filter(models.Product.demo.is_(True)).delete(synchronize_session=False)
    db.commit()


def load_demo_data(db: Session, user: models.User) -> None:
    elements = db.query(models.Element).all()
    all_locs = list(all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params} for e in elements]).keys())
    used = {p.location_id for p in db.query(models.Product).all()}
    free = [l for l in all_locs if l not in used]
    rnd = random.Random(418)
    rnd.shuffle(free)
    # como en la bodega real: cada chaqueta cuelga con todas sus tallas en una
    # misma barra de perchero; lo pequeno va en canastas
    bars = [l for l in free if l.startswith("P-")]
    boxes = [l for l in free if not l.startswith("P-")]
    made: list[models.Product] = []
    for base, name, sizes, hangs in DEMO_REFS:
        bar = bars.pop() if hangs and bars else None
        for size in sizes:
            loc = bar or (boxes.pop() if boxes else None)
            if not loc:
                break
            sku = base + size
            if db.get(models.Product, sku):
                continue
            qty = rnd.randint(1, 7) if bar else rnd.randint(0, 10)
            p = models.Product(sku=sku, name=name, size=size, location_id=loc, qty=qty, min_qty=2 if bar else 3, demo=True)
            db.add(p)
            if qty > 0:
                db.add(models.Stock(sku=sku, location_id=loc, qty=qty))
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
