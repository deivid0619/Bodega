"""Aplica cambios a la distribucion (agregar, mover, redimensionar, borrar
muebles) protegiendo el inventario: nunca deja una prenda con existencias
sin una ubicacion valida."""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from . import models
from .layout_logic import (
    DEFAULT_PARAMS, all_locations, clamp, el_name, locs_of_el, next_code,
    validate_params,
)


class LayoutError(Exception):
    """Un cambio de distribucion no se puede aplicar (choque de codigos o
    prendas que quedarian sin ubicacion)."""


def _el_to_dict(el: models.Element) -> dict:
    return {"id": el.id, "type": el.type, "code": el.code, "x": el.x, "z": el.z,
            "rot": el.rot, "y0": el.y0 or 0, "params": el.params or {}}


def get_room(db: Session) -> models.RoomConfig:
    room = db.query(models.RoomConfig).first()
    if not room:
        room = models.RoomConfig(id=1, width=8.4, depth=7.0)
        db.add(room)
        db.commit()
        db.refresh(room)
    return room


def get_elements(db: Session) -> list[models.Element]:
    return db.query(models.Element).all()


def element_out(el: models.Element) -> dict:
    d = _el_to_dict(el)
    return {**d, "name": el_name(d), "locations": locs_of_el(d)}


def _replace_all(db: Session, new_elements: list[dict], room: dict | None = None) -> None:
    """Nucleo del editor: recibe la lista completa de muebles ya validada
    (codigos, parametros) y la aplica, remapeando las prendas cuyo mueble
    cambio de tamano o de codigo, y bloqueando el cambio si alguna prenda
    con existencias quedaria sin ubicacion."""
    old_by_id = {e.id: _el_to_dict(e) for e in db.query(models.Element).all()}

    seen: dict[str, str] = {}
    for ne in new_elements:
        for loc in locs_of_el(ne):
            if loc["id"] in seen:
                raise LayoutError(f"El código {loc['id']} quedaría repetido. Usa otro código.")
            seen[loc["id"]] = ne["id"]
    new_ids = set(seen.keys())

    rename: dict[str, str] = {}
    for ne in new_elements:
        old = old_by_id.get(ne["id"])
        if not old:
            continue
        old_locs = locs_of_el(old)
        new_locs = locs_of_el(ne)
        for i, ol in enumerate(old_locs):
            if i < len(new_locs) and ol["id"] != new_locs[i]["id"]:
                rename[ol["id"]] = new_locs[i]["id"]

    products = db.query(models.Product).filter(models.Product.qty > 0).all()
    lost = [p for p in products if rename.get(p.location_id, p.location_id) not in new_ids]
    if lost:
        n = len(lost)
        noun = "código con prendas quedaría" if n == 1 else "códigos con prendas quedarían"
        raise LayoutError(f"{n} {noun} sin ubicación. Muévelos a otro lugar primero.")

    for p in db.query(models.Product).filter(models.Product.location_id.in_(rename.keys())).all():
        p.location_id = rename[p.location_id]

    db.query(models.Element).delete()
    db.flush()
    for ne in new_elements:
        db.add(models.Element(
            id=ne["id"], type=ne["type"], code=ne.get("code"),
            x=ne["x"], z=ne["z"], rot=ne.get("rot", 0), y0=ne.get("y0", 0), params=ne.get("params", {}),
        ))
    if room is not None:
        rc = get_room(db)
        rc.width, rc.depth = room["width"], room["depth"]
    db.commit()


def update_room(db: Session, width: float, depth: float) -> models.RoomConfig:
    elements = [_el_to_dict(e) for e in db.query(models.Element).all()]
    for e in elements:
        e["x"] = clamp(e["x"], -width / 2, width / 2)
        e["z"] = clamp(e["z"], -depth / 2, depth / 2)
    _replace_all(db, elements, room={"width": width, "depth": depth})
    return get_room(db)


def add_element(db: Session, type_: str, x: float, z: float, rot: int, y0: float = 0) -> models.Element:
    elements = [_el_to_dict(e) for e in db.query(models.Element).all()]
    room = get_room(db)
    new_el = {
        "id": uuid.uuid4().hex[:8],
        "type": type_,
        "x": clamp(x, -room.width / 2, room.width / 2),
        "z": clamp(z, -room.depth / 2, room.depth / 2),
        "rot": rot % 4,
        "y0": y0,
        "params": dict(DEFAULT_PARAMS.get(type_, {})),
    }
    if type_ in ("bins", "shelf", "rack", "boxes"):
        new_el["code"] = next_code(elements, type_)
    _replace_all(db, elements + [new_el])
    return db.get(models.Element, new_el["id"])


def update_element(db: Session, element_id: str, changes: dict) -> models.Element:
    elements = [_el_to_dict(e) for e in db.query(models.Element).all()]
    target = next((e for e in elements if e["id"] == element_id), None)
    if not target:
        raise LayoutError("Ese elemento ya no existe.")
    room = get_room(db)

    if "code" in changes and changes["code"] is not None:
        code = str(changes["code"]).upper().strip()
        code = "".join(ch for ch in code if ch.isalnum())[:6]
        if not code:
            raise LayoutError("El código no puede quedar vacío.")
        if any(e["id"] != element_id and e.get("code") == code for e in elements):
            raise LayoutError(f"Ya hay un elemento con el código {code}.")
        target["code"] = code
    if "params" in changes and changes["params"]:
        target["params"] = validate_params(target["type"], {**target["params"], **changes["params"]})
    if "rot" in changes and changes["rot"] is not None:
        target["rot"] = changes["rot"] % 4
    if "x" in changes and changes["x"] is not None:
        target["x"] = clamp(changes["x"], -room.width / 2, room.width / 2)
    if "z" in changes and changes["z"] is not None:
        target["z"] = clamp(changes["z"], -room.depth / 2, room.depth / 2)
    if "y0" in changes and changes["y0"] is not None:
        target["y0"] = clamp(changes["y0"], 0, 2.6)

    _replace_all(db, elements)
    return db.get(models.Element, element_id)


def delete_element(db: Session, element_id: str) -> None:
    elements = [_el_to_dict(e) for e in db.query(models.Element).all() if e.id != element_id]
    if len(elements) == db.query(models.Element).count():
        raise LayoutError("Ese elemento ya no existe.")
    _replace_all(db, elements)


## Distribucion real de la bodega (descrita por el dueño):
## - Al entrar por la puerta (pared de atras, z negativo), pared derecha
##   (x positivo): percheros A y B, 4 tubos cada uno, partiendo la pared
##   por la mitad.
## - Pared del frente (z positivo): pared de canastas C, 80 canastas
##   (10 por fila x 8 filas).
## - Pared izquierda (x negativo): igual que la derecha, percheros D y E,
##   4 tubos cada uno.
## - Pared de atras (misma de la puerta): canastas F (8, en una sola
##   columna vertical) y, al lado, un mueble de 3 niveles apilados
##   (G arriba/5 canastas, H en medio/10 canastas, I abajo/5 canastas).
DEFAULT_LAYOUT = [
    {"id": "e1", "type": "rack", "code": "A", "x": 3.92, "z": -1.6, "rot": 3, "y0": 0, "params": {"w": 3.0, "bars": 4}},
    {"id": "e2", "type": "rack", "code": "B", "x": 3.92, "z": 1.6, "rot": 3, "y0": 0, "params": {"w": 3.0, "bars": 4}},
    {"id": "e3", "type": "bins", "code": "C", "x": 0, "z": 3.24, "rot": 2, "y0": 0, "params": {"cols": 10, "rows": 8}},
    {"id": "e4", "type": "rack", "code": "D", "x": -3.92, "z": -1.6, "rot": 1, "y0": 0, "params": {"w": 3.0, "bars": 4}},
    {"id": "e5", "type": "rack", "code": "E", "x": -3.92, "z": 1.6, "rot": 1, "y0": 0, "params": {"w": 3.0, "bars": 4}},
    {"id": "e6", "type": "bins", "code": "F", "x": 2.7, "z": -3.24, "rot": 0, "y0": 0, "params": {"cols": 1, "rows": 8}},
    {"id": "e7", "type": "bins", "code": "G", "x": -1.2, "z": -3.24, "rot": 0, "y0": 1.4, "params": {"cols": 5, "rows": 1}},
    {"id": "e8", "type": "bins", "code": "H", "x": -1.2, "z": -3.24, "rot": 0, "y0": 0.7, "params": {"cols": 10, "rows": 1}},
    {"id": "e9", "type": "bins", "code": "I", "x": -1.2, "z": -3.24, "rot": 0, "y0": 0, "params": {"cols": 5, "rows": 1}},
    {"id": "e10", "type": "table", "code": None, "x": 0, "z": 0, "rot": 0, "y0": 0, "params": {"w": 1.3}},
]
DEFAULT_ROOM = {"width": 8.4, "depth": 7.0}


def reset_to_default(db: Session) -> None:
    """Vuelve a la distribución que se ve en el video de recorrido. Bloquea
    el cambio con el mismo mensaje que cualquier otro si dejaría prendas
    con existencias sin ubicación."""
    _replace_all(db, [dict(e) for e in DEFAULT_LAYOUT], room=dict(DEFAULT_ROOM))


def duplicate_element(db: Session, element_id: str) -> models.Element:
    el = db.get(models.Element, element_id)
    if not el:
        raise LayoutError("Ese elemento ya no existe.")
    d = _el_to_dict(el)
    offset = 1.0
    odd = d["rot"] % 2 == 1
    new_x = d["x"] + (0 if odd else offset)
    new_z = d["z"] + (offset if odd else 0)
    return add_element(db, d["type"], new_x, new_z, d["rot"], d.get("y0", 0))
