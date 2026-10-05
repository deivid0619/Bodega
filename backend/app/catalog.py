"""Catalogo de la tienda (pigmalionmoto.com, Shopify): nombre, talla, foto y
precio de cada codigo. El codigo de cada variante de la tienda es el mismo
de la etiqueta, asi que al escanear un codigo nuevo se puede llenar solo.

Se lee del listado publico de la tienda y queda en memoria unas horas; nada
se guarda en el repositorio. Si la tienda no responde, la app sigue igual,
solo que sin sugerencias."""
from __future__ import annotations

import threading
import time

import httpx

from .config import settings

TTL = 6 * 3600  # cada cuanto se vuelve a leer la tienda
RETRY = 300  # si fallo, reintentar en 5 minutos
SIZE_OPTIONS = {"TALLA", "SIZE", "TAMAÑO", "TAMANO"}

_lock = threading.Lock()
_cache: dict = {"at": 0.0, "items": {}, "error": None}


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
        for page in range(1, 6):
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
        except Exception as e:  # sin internet o la tienda cambio: se sigue con lo que habia
            _cache["error"] = str(e)[:200]
            _cache["at"] = time.time() + RETRY
    return _cache["items"]


def lookup(sku: str, fetch: bool = True) -> dict | None:
    return items(fetch).get(str(sku or "").strip().upper())


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
    return {"enabled": bool(settings.catalog_url), "codes": len(_cache["items"]), "error": _cache["error"]}
