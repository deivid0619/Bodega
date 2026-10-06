"""Logica de inventario: registrar prendas, aplicar movimientos con bloqueo
de fila (para que dos personas escaneando al tiempo no se pisen), deshacer,
y los reportes de pedidos e historial."""
from __future__ import annotations

import random
import unicodedata
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .layout_logic import DISPATCH, all_locations


# nota de los movimientos de una remision: "Remisión OPR123"
REMISION_NOTE = "Remisión "


class InventoryError(Exception):
    """Un movimiento no se pudo aplicar (cantidad invalida, no hay
    suficiente existencia, ubicacion inexistente...)."""


class UnknownSku(InventoryError):
    """El codigo escaneado no esta registrado (la app ofrece registrarlo)."""


def _locations(db: Session) -> dict[str, dict]:
    return all_locations([{"id": e.id, "type": e.type, "code": e.code, "params": e.params}
                          for e in db.query(models.Element).all()])


def location_ids(db: Session) -> set[str]:
    return set(_locations(db).keys())


def outlet_ids(db: Session) -> set[str]:
    """Ubicaciones de muebles marcados como outlet: lo que hay ahi no cuenta."""
    return {k for k, v in _locations(db).items() if v.get("outlet")}


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
              location_id: str, to_location_id: str | None = None, note: str | None = None) -> models.Movement:
    return models.Movement(
        sku=product.sku, type=type_, qty=qty, before=before, after=after,
        location_id=location_id, to_location_id=to_location_id, note=note,
        product_name=product.name, product_size=product.size, user_id=user.id, user_name=user.name,
    )


def register_product(db: Session, sku: str, name: str, size: str, location_id: str,
                      qty: int, min_qty: int, user: models.User,
                      image_url: str | None = None, note: str | None = None,
                      commit: bool = True) -> tuple[models.Product, models.Movement]:
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
    movement = _movement(product, user, "new", qty, 0, qty, location_id, note=note)
    db.add(movement)
    if not commit:
        db.flush()
        return product, movement
    db.commit()
    db.refresh(product)
    db.refresh(movement)
    return product, movement


def add_to_reserve(db: Session, name: str, size: str, sku: str | None, qty: int) -> models.ReserveItem:
    """Suma a la reserva: al item con ese codigo o, si no hay codigo, al de la
    misma referencia y talla sin codigo. No confirma: lo hace quien llama."""
    name, size = name.strip().upper(), size.strip().upper()
    item = None
    if sku:
        item = db.query(models.ReserveItem).filter(models.ReserveItem.sku == sku).with_for_update().first()
    if item is None:
        # la misma referencia y talla guardada sin codigo: es la misma mercancia
        item = (db.query(models.ReserveItem)
                .filter(models.ReserveItem.sku.is_(None), models.ReserveItem.name == name,
                        models.ReserveItem.size == size)
                .with_for_update().first())
        if item is not None and sku:
            item.sku = sku
    if item is None:
        item = models.ReserveItem(sku=sku, name=name, size=size, qty=0)
        db.add(item)
    item.qty += qty
    db.flush()
    return item


def apply_movement(db: Session, sku: str, type_: str, qty: int, user: models.User,
                   location_id: str | None = None, note: str | None = None,
                   commit: bool = True) -> tuple[models.Product, list[models.Movement]]:
    """Entrada, salida o conteo de un codigo.

    Entrada y conteo van a location_id o, si no se elige, a la ubicacion
    principal del codigo; el conteo fija lo que hay EN ESA ubicacion.
    Salida: de location_id si se elige; si no, primero de la ubicacion
    principal y luego de donde haya mas (puede tocar varias ubicaciones, una
    fila de historial por cada una).
    """
    product, rows = _lock(db, sku)
    before = product.qty
    locs = _locations(db)
    valid = set(locs)
    outlet = {k for k, v in locs.items() if v.get("outlet")}
    if location_id and location_id not in valid:
        raise InventoryError("Esa ubicación no existe.")
    label = f"{product.name} {product.size}".strip()
    movements: list[models.Movement] = []

    if type_ in ("in", "set"):
        if not location_id and product.location_id == DISPATCH:
            raise InventoryError(f"{label} solo está en Despacho (de paso): elige en qué ubicación de la bodega guardarla.")
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
        movements.append(_movement(product, user, type_, logged, before, product.qty, loc, note=note))
    elif type_ == "out":
        if qty < 1:
            raise InventoryError("La cantidad debe ser 1 o más.")
        if location_id:
            have = rows[location_id].qty if location_id in rows else 0
            if qty > have:
                raise InventoryError(f"En {location_id} solo hay {have} de {label}. La salida no se registró.")
            plan = [(location_id, qty)]
        else:
            # sin ubicacion nunca se saca del outlet: esas no se entregan normalmente
            usable = [r for r in rows.values() if r.qty > 0 and r.location_id not in outlet]
            have = sum(r.qty for r in usable)
            if qty > have:
                apart = before - have
                extra = f" (las otras {apart} están en outlet: elige esa ubicación para sacarlas)" if apart else ""
                raise InventoryError(f"Solo hay {have} de {label}{extra}. La salida no se registró.")
            order = sorted(usable, key=lambda r: (r.location_id != DISPATCH, r.location_id != product.location_id, -r.qty))
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
            movements.append(_movement(product, user, "out", take, running, running - take, loc, note=note))
            running -= take
        product.qty = _total(rows)
    else:
        raise InventoryError("Tipo de movimiento inválido.")

    db.add_all(movements)
    if not commit:
        # parte de un documento: el que llama confirma todo junto (o nada)
        db.flush()
        return product, movements
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


def ref_key(name: str, size: str = "") -> tuple[str, str]:
    """Referencia y talla comparables: sin tildes, mayusculas y un solo espacio
    (PROTECCIÓN = PROTECCION)."""
    def norm(s: str) -> str:
        s = unicodedata.normalize("NFD", str(s or ""))
        return " ".join("".join(ch for ch in s if unicodedata.category(ch) != "Mn").upper().split())
    return norm(name), norm(size)


def _reserve_index(db: Session) -> tuple[dict[str, list[models.ReserveItem]], dict[tuple[str, str], list[models.ReserveItem]]]:
    by_sku: dict[str, list[models.ReserveItem]] = {}
    by_ref: dict[tuple[str, str], list[models.ReserveItem]] = {}
    for it in db.query(models.ReserveItem).filter(models.ReserveItem.qty > 0).all():
        if it.sku:
            by_sku.setdefault(it.sku, []).append(it)
        else:
            by_ref.setdefault(ref_key(it.name, it.size), []).append(it)
    return by_sku, by_ref


def _reserve_for(p: models.Product, index) -> list[models.ReserveItem]:
    """Lo que hay en la reserva de este codigo: con su codigo o, si se guardo
    sin codigo, con la misma referencia y talla."""
    by_sku, by_ref = index
    return by_sku.get(p.sku, []) + by_ref.get(ref_key(p.name, p.size), [])


def apart_qty(db: Session) -> dict[str, int]:
    """Por codigo, lo que no cuenta como bodega: lo de paso (Despacho) y lo
    del outlet."""
    apart = [DISPATCH, *outlet_ids(db)]
    out: dict[str, int] = {}
    for sku, qty in (db.query(models.Stock.sku, models.Stock.qty)
                     .filter(models.Stock.location_id.in_(apart), models.Stock.qty > 0).all()):
        out[sku] = out.get(sku, 0) + qty
    return out


def stock_qty(p: models.Product, passing: dict[str, int]) -> int:
    """Lo que hay de un codigo en la bodega, sin lo de paso ni lo del outlet."""
    return p.qty - passing.get(p.sku, 0)


def needs(db: Session) -> list[tuple[models.Product, int, int]]:
    """Tallas en o bajo su minimo: (prenda, cuanto pedir, cuanto hay en reserva).
    Se pide para llegar al doble del minimo, descontando lo que ya esta en la
    reserva (eso se trae, no se compra). Lo de paso y el outlet no cuentan."""
    passing = apart_qty(db)
    products = [p for p in db.query(models.Product).filter(models.Product.min_qty > 0).all()
                if stock_qty(p, passing) <= p.min_qty]
    index = _reserve_index(db)
    out = []
    for p in products:
        in_reserve = sum(it.qty for it in _reserve_for(p, index))
        out.append((p, max(p.min_qty * 2 - stock_qty(p, passing) - in_reserve, 0), in_reserve))
    out.sort(key=lambda t: stock_qty(t[0], passing) / t[0].min_qty if t[0].min_qty else 0)
    return out


def restock(db: Session) -> list[tuple[models.ReserveItem, models.Product, int]]:
    """Que traer de la reserva: tallas agotadas o en su minimo en la bodega
    que tienen prendas guardadas en la reserva, con cuantas llevar (hasta el
    doble del minimo; si no tiene minimo, 2)."""
    index = _reserve_index(db)
    if not index[0] and not index[1]:
        return []
    passing = apart_qty(db)
    out = []
    for p in db.query(models.Product).all():
        have = stock_qty(p, passing)
        if have > p.min_qty:
            continue
        items = _reserve_for(p, index)
        if not items:
            continue
        item = max(items, key=lambda it: (it.sku == p.sku, it.qty))
        want = p.min_qty * 2 - have if p.min_qty > 0 else 2
        out.append((item, p, max(1, min(item.qty, want))))
    # primero lo agotado, despues lo que esta mas cerca de agotarse
    out.sort(key=lambda t: (t[1].qty > 0, t[1].qty / t[1].min_qty if t[1].min_qty else 1, t[1].name, t[1].size))
    return out


def _aware(dt: datetime) -> datetime:
    # SQLite devuelve las fechas sin zona; se guardaron en UTC
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def weekly_flow(db: Session, weeks: int = 8, tz=timezone.utc) -> list[dict]:
    """Prendas que entraron y salieron por semana (lunes a domingo, hora
    local), de la mas vieja a la actual. Entradas: entradas y registros
    nuevos; salidas: salidas. Los conteos y traslados no cuentan."""
    today = datetime.now(tz).date()
    start = today - timedelta(days=today.weekday() + 7 * (weeks - 1))
    since = datetime.combine(start, datetime.min.time(), tzinfo=tz)
    buckets = {start + timedelta(weeks=i): {"in": 0, "out": 0} for i in range(weeks)}
    rows = (db.query(models.Movement.type, models.Movement.qty, models.Movement.created_at)
            .filter(models.Movement.type.in_(("in", "new", "out")), models.Movement.created_at >= since.astimezone(timezone.utc))
            .all())
    for type_, qty, created in rows:
        day = _aware(created).astimezone(tz).date()
        week = day - timedelta(days=day.weekday())
        if week in buckets:
            buckets[week]["out" if type_ == "out" else "in"] += qty
    return [{"week": w.isoformat(), "in": v["in"], "out": v["out"]} for w, v in sorted(buckets.items())]


def dead_stock(db: Session, days: int = 60) -> list[tuple[models.Product, datetime | None]]:
    """Prendas con existencias que no han salido en `days` dias (o nunca),
    registradas hace mas de esos dias. De mas a menos prendas paradas."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    last_out = dict(db.query(models.Movement.sku, func.max(models.Movement.created_at))
                    .filter(models.Movement.type == "out").group_by(models.Movement.sku).all())
    passing = apart_qty(db)
    out = []
    for p in db.query(models.Product).filter(models.Product.qty > 0).all():
        if stock_qty(p, passing) <= 0:
            continue  # solo esta de paso o en el outlet
        last = last_out.get(p.sku)
        if last is not None and _aware(last) >= since:
            continue
        if p.created_at is not None and _aware(p.created_at) >= since:
            continue  # recien registrada: todavia no ha tenido tiempo de salir
        out.append((p, _aware(last) if last else None))
    out.sort(key=lambda t: (-t[0].qty, t[0].name, t[0].size))
    return out


def dispatch_list(db: Session) -> list[tuple[models.Product, int, datetime | None, models.Document | None]]:
    """Lo que esta de paso en Despacho: (prenda, cuantas, cuando llego la
    ultima, la remision con que llego, si fue con una)."""
    rows = db.query(models.Stock).filter(models.Stock.location_id == DISPATCH, models.Stock.qty > 0).all()
    if not rows:
        return []
    skus = [r.sku for r in rows]
    last: dict[str, models.Movement] = {}
    for m in (db.query(models.Movement)
              .filter(models.Movement.sku.in_(skus), models.Movement.type.in_(("in", "new")),
                      models.Movement.location_id == DISPATCH)
              .order_by(models.Movement.created_at.desc(), models.Movement.id.desc())):
        last.setdefault(m.sku, m)
    number = {sku: m.note[len(REMISION_NOTE):] for sku, m in last.items() if (m.note or "").startswith(REMISION_NOTE)}
    docs = {d.number: d for d in db.query(models.Document).filter(
        models.Document.kind == "remision", models.Document.number.in_(set(number.values())))} if number else {}
    products = {p.sku: p for p in db.query(models.Product).filter(models.Product.sku.in_(skus)).all()}
    out = [(products[r.sku], r.qty, _aware(last[r.sku].created_at) if r.sku in last else None, docs.get(number.get(r.sku)))
           for r in rows if r.sku in products]
    out.sort(key=lambda t: (t[2] is None, t[2] or datetime.now(timezone.utc)))  # lo que mas lleva, primero
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
