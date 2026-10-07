"""Catalogo de la tienda (pigmalionmoto.com, Shopify): nombre, talla, foto y
precio de cada codigo. El codigo de cada variante de la tienda es el mismo
de la etiqueta, asi que al escanear un codigo nuevo se puede llenar solo.

Se lee del listado publico de la tienda y queda en memoria unas horas; nada
se guarda en el repositorio. Si la tienda no responde, la app sigue igual,
solo que sin sugerencias."""
from __future__ import annotations

import re
import threading
import time

import httpx

from .config import settings

TTL = 6 * 3600  # cada cuanto se vuelve a leer la tienda
RETRY = 90  # si fallo, reintentar en minuto y medio (mientras tanto, lo ultimo que se leyo)
MAX_PAGES = 40  # 250 productos por pagina: hasta 10.000 productos
SIZE_OPTIONS = {"TALLA", "SIZE", "TAMAÑO", "TAMANO"}

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "items": {}, "error": None, "ok_at": None}


def _thumb(url: str | None, width: int = 400) -> str | None:
    if not url:
        return None
    return f"{url}{'&' if '?' in url else '?'}width={width}"


def parse(products: list[dict]) -> dict[str, dict]:
    """Del JSON de Shopify a {codigo: {sku, name, size, price, image, product}}."""
    items: dict[str, dict] = {}
    for p in products:
        name = " ".join(str(p.get("title") or "").split()).upper()
        images = p.get("images") or []
        cover = images[0].get("src") if images else None
        size_at = next((i for i, o in enumerate(p.get("options") or [])
                        if str(o.get("name") or "").strip().upper() in SIZE_OPTIONS), None)
        for v in p.get("variants") or []:
            sku = str(v.get("sku") or "").strip().upper()
            if not sku:
                continue
            size = ""
            if size_at is not None:
                size = str(v.get(f"option{size_at + 1}") or "").strip().upper()
            if size == "DEFAULT TITLE":
                size = ""
            try:
                price = round(float(v.get("price") or 0))
            except (TypeError, ValueError):
                price = 0
            image = (v.get("featured_image") or {}).get("src") or cover
            items[sku] = {"sku": sku, "name": name, "size": size, "price": price,
                          "image": _thumb(image), "product": p.get("handle") or name}
    return items


def _fetch() -> list[dict]:
    out: list[dict] = []
    with httpx.Client(timeout=8, headers={"User-Agent": "Bodega-Pigmalion/1.0"}, follow_redirects=True) as client:
        for page in range(1, MAX_PAGES + 1):
            r = client.get(settings.catalog_url, params={"limit": 250, "page": page})
            r.raise_for_status()
            batch = r.json().get("products") or []
            out.extend(batch)
            if len(batch) < 250:
                break
    return out


def items(fetch: bool = True) -> dict[str, dict]:
    """El catalogo por codigo. Con fetch=False no sale a internet: devuelve lo
    que ya este en memoria (para usarlo dentro de una transaccion)."""
    if not settings.catalog_url:
        return {}
    if not fetch or time.time() < _cache["at"]:
        return _cache["items"]
    with _lock:
        if time.time() < _cache["at"]:
            return _cache["items"]
        try:
            _cache["items"] = parse(_fetch())
            _cache["error"] = None
            _cache["at"] = time.time() + TTL
            _cache["ok_at"] = time.time()
        except Exception as e:  # sin internet o la tienda cambio: se sigue con lo que habia
            _cache["error"] = str(e)[:200]
            _cache["at"] = time.time() + RETRY
    return _cache["items"]


def version() -> float:
    """Cambia cada vez que se vuelve a traer el catalogo."""
    return _cache["at"]


def lookup(sku: str, fetch: bool = True) -> dict | None:
    return items(fetch).get(str(sku or "").strip().upper())


def close_codes(a: str, b: str) -> bool:
    """Distintos en una sola letra: una de mas, una de menos o una cambiada."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    return a[i + 1:] == b[i + 1:] if len(a) == len(b) else a[i:] == b[i + 1:]


def _distance(a: str, b: str) -> int:
    """Cuantas letras hay que cambiar, poner o quitar para pasar de a a b."""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def similar(store: str, code: str) -> int | None:
    """Que tan parecido es un codigo de la tienda al de una etiqueta (None si
    no se parece). El final (la talla) tiene que ser el mismo, para no
    confundir una talla con otra.
    - Una letra distinta: P-PRM001800XL en la etiqueta, P-PRM00180XL en la tienda.
    - Hasta tres, si trae el mismo numero de referencia: PGPRBI072CMM en la
      etiqueta, PGPRGP072VCMM en la tienda."""
    if store == code or len(code) < 6 or store[-2:] != code[-2:]:
        return None
    if close_codes(store, code):
        return 1
    nums = re.findall(r"\d{3,}", code)
    if len(code) < 8 or not nums or not any(n in store for n in nums):
        return None
    d = _distance(store, code)
    return d if d <= 3 else None


def near(sku: str, limit: int = 3, fetch: bool = True) -> list[dict]:
    """Codigos de la tienda casi iguales al de una etiqueta, del mas parecido
    al menos (ver similar)."""
    code = "".join(str(sku or "").upper().split())
    found = [(d, it) for k, it in items(fetch).items() if (d := similar(k, code)) is not None]
    return [it for _, it in sorted(found, key=lambda x: x[0])][:limit]


def search(q: str, limit: int = 8) -> list[dict]:
    """Productos de la tienda cuyo nombre tiene todas las palabras buscadas (o
    con un codigo que empieza asi), con sus tallas."""
    words = str(q or "").upper().split()
    code = "".join(words)
    if not words:
        return []
    groups: dict[str, dict] = {}
    for it in items().values():
        if not (all(w in it["name"] for w in words) or it["sku"].startswith(code)):
            continue
        g = groups.setdefault(it["product"], {"name": it["name"], "image": it["image"], "sizes": []})
        g["sizes"].append({"size": it["size"], "sku": it["sku"], "price": it["price"]})
    return list(groups.values())[:limit]


def status() -> dict:
    """Como esta la conexion con la tienda (para mostrarlo en la app)."""
    return {"enabled": bool(settings.catalog_url), "codes": len(_cache["items"]), "error": _cache["error"],
            "ok_at": _cache["ok_at"]}


def refresh() -> dict:
    """Leer la tienda ya (boton "Actualizar")."""
    with _lock:
        _cache["at"] = 0.0
    items()
    return status()


def warm() -> None:
    """Al arrancar el servidor (en Render se duerme y se despierta), la tienda
    se lee de una vez en segundo plano: el primer escaneo ya la encuentra."""
    if settings.catalog_url:
        threading.Thread(target=items, daemon=True).start()
