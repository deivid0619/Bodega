"""Aplica cambios a la distribucion (agregar, mover, redimensionar, borrar
muebles, cambiar canastas por cajas) protegiendo el inventario: nunca deja
una prenda con existencias sin una ubicacion valida."""
from __future__ import annotations

import uuid

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.modules.bodega.logic import DISPATCH, DEFAULT_PARAMS, all_locations, clamp, el_name, locs_of_el, next_code, validate_params


# un mueble de canastas puede volverse cajas y al reves: es el mismo lugar
SWAPPABLE = {"bins", "boxes"}


class LayoutError(Exception):
    """Un cambio de distribucion no se puede aplicar (choque de codigos o
    prendas que quedarian sin ubicacion)."""


class CodeTaken(LayoutError):
    """La letra ya la tiene otro mueble: se puede intercambiar (swap)."""


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


def _replace_all(db: Session, new_elements: list[dict], room: dict | None = None,
                 moves: dict[str, str] | None = None) -> None:
    """Nucleo del editor: recibe la lista completa de muebles ya validada
    (codigos, parametros) y la aplica, remapeando las prendas cuyo mueble
    cambio de tamano o de codigo, y bloqueando el cambio si alguna prenda
    con existencias quedaria sin ubicacion. `moves` fuerza a donde pasa cada
    ubicacion vieja (al cambiar canastas por cajas, todas a la misma)."""
    rows = {e.id: e for e in db.query(models.Element).all()}
    old_by_id = {i: _el_to_dict(e) for i, e in rows.items()}

    seen: dict[str, str] = {}
    for ne in new_elements:
        for loc in locs_of_el(ne):
            if loc["id"] in seen:
                raise LayoutError(f"El código {loc['id']} quedaría repetido. Usa otro código.")
            seen[loc["id"]] = ne["id"]
    new_ids = set(seen.keys()) | {DISPATCH}  # Despacho no es un mueble: nunca se pierde

    # cada ubicacion sigue siendo la del mismo lugar del mueble (fila y
    # columna, nivel...): quitar o agregar una columna no corre las demas
    # (antes C-2-2 pasaba a C-2-1); solo cambia el nombre si cambia el codigo
    rename: dict[str, str] = {}
    for ne in new_elements:
        old = old_by_id.get(ne["id"])
        if not old:
            continue
        same_place = {l["slot"]: l["id"] for l in locs_of_el(ne)}
        for ol in locs_of_el(old):
            new_id = same_place.get(ol["slot"])
            if new_id and new_id != ol["id"]:
                rename[ol["id"]] = new_id
    rename.update({a: b for a, b in (moves or {}).items() if a != b})

    # solo se miran las existencias que quedarian por fuera (no toda la tabla)
    lost = sorted({loc for (loc,) in db.query(models.Stock.location_id).filter(
        models.Stock.qty > 0, models.Stock.location_id.notin_(new_ids | set(rename))).distinct()})
    if lost:
        one = len(lost) == 1
        shown = ", ".join(lost[:4]) + ("…" if len(lost) > 4 else "")
        raise LayoutError(f"{shown} {'tiene prendas y quedaría' if one else 'tienen prendas y quedarían'} sin ubicación. "
                          "Muévelas a otro lugar primero.")

    if rename:
        # se reescriben las filas (borrar y volver a crear) para que un
        # corrimiento C-2-1 -> C-2-2 -> C-2-3 no choque con la llave unica
        moved: dict[tuple[str, str], int] = {}
        for r in db.query(models.Stock).filter(models.Stock.location_id.in_(rename.keys())).all():
            key = (r.sku, rename[r.location_id])
            moved[key] = moved.get(key, 0) + r.qty
            db.delete(r)
        db.flush()
        for (sku, loc), qty in moved.items():
            row = db.query(models.Stock).filter_by(sku=sku, location_id=loc).first()
            if row:
                row.qty += qty
            else:
                db.add(models.Stock(sku=sku, location_id=loc, qty=qty))
        for p in db.query(models.Product).filter(models.Product.location_id.in_(rename.keys())).all():
            p.location_id = rename[p.location_id]
        db.flush()

    # lo anotado de paso sigue a su ubicacion; si la ubicacion desaparece,
    # pasa a Despacho (no es inventario: nunca bloquea un cambio)
    for parcel in db.query(models.Parcel).filter(
            models.Parcel.done_at.is_(None),
            or_(models.Parcel.location_id.in_(list(rename)), models.Parcel.location_id.notin_(new_ids))).all():
        loc = rename.get(parcel.location_id, parcel.location_id)
        parcel.location_id = loc if loc in new_ids else DISPATCH

    # si la ubicacion principal de un codigo desaparece pero tiene prendas en
    # otra, la principal pasa a donde tenga mas
    orphans = db.query(models.Product).filter(models.Product.location_id.notin_(new_ids)).all()
    if orphans:
        by_sku: dict[str, list[models.Stock]] = {}
        for r in db.query(models.Stock).filter(models.Stock.qty > 0,
                                               models.Stock.sku.in_([p.sku for p in orphans])).all():
            by_sku.setdefault(r.sku, []).append(r)
        for p in orphans:
            if by_sku.get(p.sku):
                p.location_id = max(by_sku[p.sku], key=lambda r: r.qty).location_id

    # los muebles se actualizan en su sitio (antes se borraban y se volvian a
    # crear todos): menos escrituras en cada cambio del editor
    keep = set()
    for ne in new_elements:
        keep.add(ne["id"])
        fields = {"type": ne["type"], "code": ne.get("code"), "x": ne["x"], "z": ne["z"],
                  "rot": ne.get("rot", 0), "y0": ne.get("y0", 0), "params": ne.get("params", {})}
        row = rows.get(ne["id"])
        if row is None:
            db.add(models.Element(id=ne["id"], **fields))
            continue
        for k, v in fields.items():
            if getattr(row, k) != v:
                setattr(row, k, v)
    for i, row in rows.items():
        if i not in keep:
            db.delete(row)
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
    if type_ in ("bins", "shelf", "rack", "boxes", "table"):
        new_el["code"] = next_code(elements, type_)
    _replace_all(db, elements + [new_el])
    return db.get(models.Element, new_el["id"])


def update_element(db: Session, element_id: str, changes: dict) -> models.Element:
    elements = [_el_to_dict(e) for e in db.query(models.Element).all()]
    target = next((e for e in elements if e["id"] == element_id), None)
    if not target:
        raise LayoutError("Ese elemento ya no existe.")
    room = get_room(db)

    moves: dict[str, str] = {}
    new_type = changes.get("type")
    if new_type and new_type != target["type"]:
        if target["type"] not in SWAPPABLE or new_type not in SWAPPABLE:
            raise LayoutError("Solo se puede cambiar entre canastas y cajas.")
        old_locs = locs_of_el(target)
        code = target.get("code") or ""
        if new_type == "bins" and (code == "CAJAS" or (code[:1] == "K" and code[1:].isdigit())):
            # el codigo automatico de unas cajas no sirve para canastas (CAJAS-1-1)
            target["code"] = next_code([e for e in elements if e["id"] != element_id], "bins")
        # del mismo tamano: tantas cajas como canastas, de a tantas una encima
        # de otra como filas tenia (y al reves). Se queda a su misma altura
        p = target["params"]
        if new_type == "boxes":
            params = {"count": int(p.get("cols", 1)) * int(p.get("rows", 1)), "levels": int(p.get("rows", 1))}
        else:
            count, levels = int(p.get("count", 3)), int(p.get("levels", 2))
            levels = max(1, min(levels, count))
            params = {"cols": -(-count // levels), "rows": levels}
        if p.get("outlet"):
            params["outlet"] = True  # si todo era outlet, lo sigue siendo
        target["type"] = new_type
        target["params"] = validate_params(new_type, params)
        new_locs = locs_of_el(target)
        # lo que tenia pasa al mueble nuevo: a la ubicacion en la misma posicion
        # o, si ya no hay tantas (canastas -> cajas), a la ultima que haya
        moves = {ol["id"]: new_locs[min(i, len(new_locs) - 1)]["id"] for i, ol in enumerate(old_locs)} if new_locs else {}

    if "code" in changes and changes["code"] is not None:
        code = str(changes["code"]).upper().strip()
        code = "".join(ch for ch in code if ch.isalnum())[:6]
        if not code:
            raise LayoutError("El código no puede quedar vacío.")
        other = next((e for e in elements if e["id"] != element_id and e.get("code") == code), None)
        if other:
            # intercambiar las letras: cada mueble se queda con sus prendas
            # (solo cambia el nombre de sus ubicaciones), sin pasar por una
            # letra que no este para dejar la otra libre
            if not changes.get("swap"):
                raise CodeTaken(f"La letra {code} ya la tiene {el_name(other)}.")
            if not target.get("code"):
                raise LayoutError("Este mueble no tiene letra para darle al otro.")
            other["code"] = target["code"]
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

    if set(changes) <= {"x", "z", "rot", "y0"}:
        # moverlo, girarlo o subirlo no cambia sus ubicaciones: solo se guarda esa fila
        row = db.get(models.Element, element_id)
        row.x, row.z, row.rot, row.y0 = target["x"], target["z"], target["rot"], target.get("y0", 0)
        db.commit()
        return row
    _replace_all(db, elements, moves=moves)
    return db.get(models.Element, element_id)


def set_location_outlet(db: Session, location_id: str, outlet: bool) -> models.Element:
    """Marca o desmarca como outlet una sola ubicacion (una canasta, un nivel,
    una barra). Sus ubicaciones no cambian: solo se guarda ese mueble."""
    for row in db.query(models.Element).all():
        d = _el_to_dict(row)
        locs = locs_of_el(d)
        loc = next((l for l in locs if l["id"] == location_id), None)
        if not loc:
            continue
        p = dict(d["params"])
        marked = {l["slot"] for l in locs if l.get("outlet")}
        (marked.add if outlet else marked.discard)(loc["slot"])
        p.pop("outlet", None)
        p["outlet_slots"] = sorted(marked)
        row.params = validate_params(d["type"], p)
        db.commit()
        return row
    raise LayoutError("Esa ubicación ya no existe.")


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
    # debajo de la mesa blanca: 18 canastas, 6 pilas de 3 en dos filas de 3
    # (esquinas compartidas). Girada: los lados de 3 pilas miran a D-E (M-x-1 a
    # M-x-3) y a A-B (M-x-4 a M-x-6); los de 2, a C y a G-H-I
    {"id": "e10", "type": "table", "code": "M", "x": 0, "z": 0, "rot": 3, "y0": 0, "params": {"w": 1.3, "bins": 18}},
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
