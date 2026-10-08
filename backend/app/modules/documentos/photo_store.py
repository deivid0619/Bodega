"""Fotos de remisiones y facturas: la prueba de lo que llego y lo que salio.

Se guardan en Supabase Storage (un bucket privado) si esta la llave secreta
SUPABASE_SERVICE_KEY; la URL del proyecto se saca sola de DATABASE_URL (o de
SUPABASE_URL si se pone). Sin llave, en el computador (SQLite) van a una
carpeta local; en produccion no se guardan, porque el disco de Render se
borra cada vez que el servidor se reinicia. Se borran solas a los PHOTO_DAYS
dias: el documento (que prendas, cuantas, quien, cuando) se queda para
siempre. Las fotos nunca son publicas: se ven y se descargan desde la app."""
from __future__ import annotations

import pathlib
import re

import httpx

from app.core.config import settings

MAX_BYTES = 5 * 1024 * 1024  # la app las achica a unos 200 KB antes de subirlas
MAX_PER_DOC = 4
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
NOT_READY = ("Las fotos todavía no se pueden guardar: falta poner la llave de Supabase "
             "(SUPABASE_SERVICE_KEY) en Render.")

_bucket_ready = False


def project_url() -> str:
    """https://<proyecto>.supabase.co: la de SUPABASE_URL o, si no se puso, la
    que se lee en DATABASE_URL (postgres.<proyecto>@... o db.<proyecto>.supabase.co)."""
    if settings.supabase_url:
        return settings.supabase_url.strip().rstrip("/")
    db = settings.database_url or ""
    m = re.search(r"postgres\.([a-z0-9]{15,40})[:@]", db) or re.search(r"@db\.([a-z0-9]{15,40})\.supabase\.co", db)
    return f"https://{m.group(1)}.supabase.co" if m else ""


def remote() -> bool:
    return bool(settings.supabase_service_key.strip() and project_url())


def local_ok() -> bool:
    """Sin Supabase solo se guardan en el computador (con SQLite): en Render el
    disco se borra al reiniciar y las fotos se perderian sin aviso."""
    return (settings.database_url or "").startswith("sqlite")


def usable() -> bool:
    return remote() or local_ok()


def _api() -> str:
    return project_url() + "/storage/v1"


def _headers(extra: dict | None = None) -> dict:
    key = settings.supabase_service_key.strip()
    # las llaves nuevas (sb_secret_...) no son JWT: van solo en "apikey". La
    # de antes (service_role, un JWT) va tambien como Bearer
    h = {"apikey": key} if key.startswith("sb_") else {"apikey": key, "Authorization": f"Bearer {key}"}
    return {**h, **(extra or {})}


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
    r = client.get(f"{_api()}/bucket/{settings.photos_bucket}", headers=_headers())
    if r.status_code != 200:
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
    if not local_ok():
        raise RuntimeError(NOT_READY)
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


def status() -> dict:
    """Donde se guardan las fotos y si funciona, para verlo en el Resumen."""
    days = settings.photo_days
    if not remote():
        if local_ok():
            return {"ok": True, "where": "local", "days": days,
                    "detail": "Son pruebas: en la app publicada se guardan en Supabase."}
        return {"ok": False, "where": "none", "days": days, "detail": NOT_READY}
    try:
        with httpx.Client(timeout=10) as client:
            r = client.get(f"{_api()}/bucket/{settings.photos_bucket}", headers=_headers())
            if r.status_code != 200:
                client.post(f"{_api()}/bucket", headers=_headers(),
                            json={"id": settings.photos_bucket, "name": settings.photos_bucket, "public": False})
                r = client.get(f"{_api()}/bucket/{settings.photos_bucket}", headers=_headers())
    except httpx.HTTPError:
        return {"ok": False, "where": "supabase", "days": days, "detail": "Supabase no responde. Intenta en un rato."}
    if r.status_code == 200:
        return {"ok": True, "where": "supabase", "days": days, "detail": "Se guardan en Supabase (privadas)."}
    if r.status_code in (401, 403):
        return {"ok": False, "where": "supabase", "days": days,
                "detail": "Supabase no acepta la llave: revisa SUPABASE_SERVICE_KEY en Render (la secreta, sb_secret_…)."}
    return {"ok": False, "where": "supabase", "days": days, "detail": f"Supabase respondió {r.status_code}."}
