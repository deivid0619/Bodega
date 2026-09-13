"""Traduce los muebles (Element) a ubicaciones concretas (canastas, niveles,
barras de perchero...). Esta es la misma logica que usa el visor 3D del
frontend para nombrar cada ubicacion, para que backend y frontend nunca
queden desincronizados."""
from __future__ import annotations

import string
from typing import Any

TYPE_LABELS = {
    "shelf": "Estantería",
    "rack": "Perchero",
    "table": "Mesa",
    "ladder": "Escalera",
    "balloons": "Bombas",
}
STORAGE_TYPES = {"bins", "shelf", "rack", "boxes"}

PARAM_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "bins": {"cols": (1, 16), "rows": (1, 10)},
    "shelf": {"w": (0.8, 5), "levels": (1, 6)},
    "rack": {"w": (0.8, 6), "bars": (1, 4)},
    "boxes": {"count": (1, 8)},
    "table": {"w": (1, 4)},
    "ladder": {},
    "balloons": {},
}
DEFAULT_PARAMS: dict[str, dict[str, Any]] = {
    "bins": {"cols": 4, "rows": 6},
    "shelf": {"w": 2.4, "levels": 3},
    "rack": {"w": 3, "bars": 3},
    "boxes": {"count": 3},
    "table": {"w": 2.4},
    "ladder": {},
    "balloons": {},
}
# letras que se intentan primero para cada tipo, para que el codigo sugerido
# se sienta natural (una estanteria nunca se llama "A", por ejemplo)
CODE_HINTS = {
    "bins": "CGJLMQRSTUVWXYZ",
    "shelf": "HEFIKNOTUVWXYZ",
    "rack": "ABDFIKMNORSTUVWXYZ",
}


def el_name(el: dict) -> str:
    t, code = el["type"], el.get("code")
    if t == "bins":
        return f"Canastas {code}"
    if t == "shelf":
        return f"Estantería {code}"
    if t == "rack":
        return f"Perchero {code}"
    if t == "boxes":
        return "Cajas en el piso" if code == "CAJAS" else f"Cajas {code}"
    return TYPE_LABELS.get(t, t)


def locs_of_el(el: dict) -> list[dict]:
    """Ubicaciones concretas que contiene un mueble."""
    t, code, p = el["type"], el.get("code"), el.get("params") or {}
    out: list[dict] = []
    if t == "bins":
        for r in range(1, int(p.get("rows", 1)) + 1):
            for c in range(1, int(p.get("cols", 1)) + 1):
                out.append({"id": f"{code}-{r}-{c}", "kind": "bin", "name": f"Canasta {code}-{r}-{c}"})
    elif t == "shelf":
        for i in range(1, int(p.get("levels", 1)) + 1):
            suf = " (abajo)" if i == 1 else ""
            out.append({"id": f"{code}-N{i}", "kind": "shelf", "name": f"Estantería {code}, nivel {i}{suf}"})
    elif t == "rack":
        for i in range(1, int(p.get("bars", 1)) + 1):
            suf = " (arriba)" if i == 1 else ""
            out.append({"id": f"P-{code}{i}", "kind": "rod", "name": f"Perchero {code}, barra {i}{suf}"})
    elif t == "boxes":
        out.append({"id": code, "kind": "boxes", "name": el_name(el)})
    return out


def all_locations(elements: list[dict]) -> dict[str, dict]:
    locs: dict[str, dict] = {}
    for el in elements:
        for loc in locs_of_el(el):
            locs[loc["id"]] = loc
    return locs


def next_code(elements: list[dict], type_: str) -> str:
    used = {e["code"] for e in elements if e.get("code")}
    if type_ == "boxes":
        if "CAJAS" not in used:
            return "CAJAS"
        i = 1
        while f"K{i}" in used:
            i += 1
        return f"K{i}"
    for ch in CODE_HINTS.get(type_, "") + string.ascii_uppercase:
        if ch not in used:
            return ch
    i = 2
    while True:
        for ch in "ABCDEFGH":
            cand = f"{ch}{i}"
            if cand not in used:
                return cand
        i += 1


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def validate_params(type_: str, params: dict) -> dict:
    ranges = PARAM_RANGES.get(type_, {})
    out = dict(DEFAULT_PARAMS.get(type_, {}))
    out.update(params or {})
    for key, (lo, hi) in ranges.items():
        if key in out:
            val = out[key]
            val = round(clamp(float(val), lo, hi), 1)
            out[key] = int(val) if key != "w" else val
    return out
