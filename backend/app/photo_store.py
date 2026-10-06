"""Fotos de remisiones y facturas: la prueba de lo que llego y lo que salio.

Se guardan en Supabase Storage (un bucket privado) si hay SUPABASE_URL y
SUPABASE_SERVICE_KEY; si no (en el computador), en una carpeta local. Se
borran solas a los PHOTO_DAYS dias: el documento (que prendas, cuantas,
quien, cuando) se queda para siempre, porque es texto y casi no ocupa.
Las fotos nunca son publicas: se ven y se descargan desde la app."""
from __future__ import annotations

import pathlib

import httpx

from .config import settings

MAX_BYTES = 5 * 1024 * 1024  # la app las achica a unos 200 KB antes de subirlas
MAX_PER_DOC = 4
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

_bucket_ready = False


def remote() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_key)


def _api() -> str:
    return settings.supabase_url.rstrip("/") + "/storage/v1"


def _headers(extra: dict | None = None) -> dict:
    key = settings.supabase_service_key
    return {"Authorization": f"Bearer {key}", "apikey": key, **(extra or {})}


def _local(path: str) -> pathlib.Path:
    base = pathlib.Path(settings.photos_dir).resolve()
    f = (base / path).resolve()
    if base not in f.parents:  # nunca fuera de la carpeta de fotos
        raise ValueError("ruta invalida")
    return f


def _ensure_bucket(client: httpx.Client) -> None:
    """El bucket privado se crea solo la primera vez (si ya existe, nada)."""
    global _bucket_ready
    if _bucket_ready:
        return
    client.post(f"{_api()}/bucket", headers=_headers(),
                json={"id": settings.photos_bucket, "name": settings.photos_bucket, "public": False})
    _bucket_ready = True


def put(path: str, data: bytes, content_type: str) -> None:
    if remote():
        with httpx.Client(timeout=30) as client:
            _ensure_bucket(client)
            r = client.post(f"{_api()}/object/{settings.photos_bucket}/{path}", content=data,
                            headers=_headers({"Content-Type": content_type, "x-upsert": "true"}))
            r.raise_for_status()
        return
    f = _local(path)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(data)


def get(path: str) -> bytes | None:
    if remote():
        with httpx.Client(timeout=30) as client:
            r = client.get(f"{_api()}/object/authenticated/{settings.photos_bucket}/{path}", headers=_headers())
            if r.status_code in (400, 404):
                return None
            r.raise_for_status()
            return r.content
    f = _local(path)
    return f.read_bytes() if f.exists() else None


def delete(paths: list[str]) -> None:
    if not paths:
        return
    if remote():
        with httpx.Client(timeout=30) as client:
            client.request("DELETE", f"{_api()}/object/{settings.photos_bucket}", headers=_headers(),
                           json={"prefixes": paths}).raise_for_status()
        return
    for p in paths:
        try:
            _local(p).unlink(missing_ok=True)
        except ValueError:
            pass
