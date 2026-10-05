"""Avisos al celular (Web Push): llegan aunque la app este cerrada. Cada
persona elige cuales quiere y nunca le llega aviso de lo que hizo ella.

Las llaves con que se firman los avisos se crean solas la primera vez y se
guardan en la base de datos: no hay nada que configurar en el servidor."""
from __future__ import annotations

import base64
import json
import logging
import threading

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import SessionLocal

log = logging.getLogger("uvicorn.error")

# entradas, salidas, conteos, bajo minimo, facturas y remisiones
KINDS = ("in", "out", "set", "low", "docs")
DEFAULTS = {"in": True, "out": True, "set": False, "low": True, "docs": True}

_vapid: Vapid02 | None = None
_lock = threading.Lock()


def clean_prefs(prefs: dict | None) -> dict:
    return {k: bool((prefs or {}).get(k, DEFAULTS[k])) for k in KINDS}


def _keys(db: Session) -> Vapid02:
    global _vapid
    if _vapid is not None:
        return _vapid
    with _lock:
        if _vapid is not None:
            return _vapid
        row = db.get(models.AppSetting, "vapid_private_pem")
        if row is None:
            fresh = Vapid02()
            fresh.generate_keys()
            db.add(models.AppSetting(key="vapid_private_pem", value=fresh.private_pem().decode()))
            try:
                db.commit()
                _vapid = fresh
                return _vapid
            except IntegrityError:  # otro proceso la creo al mismo tiempo
                db.rollback()
                row = db.get(models.AppSetting, "vapid_private_pem")
        _vapid = Vapid02.from_pem(row.value.encode())
        return _vapid


def public_key(db: Session) -> str:
    raw = _keys(db).public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def send(sub: models.PushSubscription, payload: dict, vapid: Vapid02) -> bool:
    """Manda un aviso. False si ese celular ya no existe (hay que olvidarlo)."""
    try:
        webpush({"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=json.dumps(payload), vapid_private_key=vapid,
                vapid_claims={"sub": settings.vapid_subject}, timeout=10, ttl=6 * 3600)
        return True
    except WebPushException as e:
        if getattr(e.response, "status_code", None) in (404, 410):
            return False
        log.warning("Aviso no enviado: %s", e)
    except Exception as e:  # sin internet: el aviso se pierde, el resto sigue
        log.warning("Aviso no enviado: %s", e)
    return True


def notify(kind: str, title: str, body: str, url: str = "/summary", tag: str | None = None,
           exclude_user_id: int | None = None) -> None:
    """Avisa a todos los que quieren este tipo de aviso, menos a quien lo hizo.
    Corre en segundo plano, despues de responder."""
    if kind not in KINDS:
        return
    with SessionLocal() as db:
        targets = [s for s in db.query(models.PushSubscription).all()
                   if s.user_id != exclude_user_id and clean_prefs(s.prefs)[kind]]
        if not targets:
            return
        vapid = _keys(db)
        # el mismo tag reemplaza el aviso anterior en el celular en vez de apilarlos
        payload = {"title": title, "body": body, "url": url, "tag": tag or kind}
        gone = [s for s in targets if not send(s, payload, vapid)]
        for s in gone:
            db.delete(s)
        if gone:
            db.commit()


def label(name: str, size: str) -> str:
    return f"{name.title()}{f' {size}' if size else ''}"


def movement_events(product: models.Product, type_: str, movs: list[models.Movement], user: models.User) -> list[tuple]:
    """Los avisos de un movimiento: (tipo, titulo, texto, url, tag, a quien no).
    Si con una salida la talla quedo en su minimo, tambien el de bajo minimo
    (ese le llega a todos, porque hay que reponer)."""
    kind = {"in": "in", "new": "in", "out": "out", "set": "set"}.get(type_)
    if not kind or not movs:
        return []
    qty = sum(m.qty for m in movs)
    where = ", ".join(dict.fromkeys(m.location_id for m in movs))
    name = label(product.name, product.size)
    if kind == "set":
        title, body = f"Conteo · {name}", f"Quedaron {product.qty} en total · {where} · {user.name}"
    else:
        verb = "Entraron" if kind == "in" else "Salieron"
        title, body = f"{verb} {qty} · {name}", f"{where} · quedan {product.qty} · {user.name}"
    events = [(kind, title, body, "/summary", f"{kind}-{product.sku}", user.id)]
    if kind == "out" and product.min_qty > 0 and movs[0].before > product.min_qty >= product.qty:
        events.append(("low", f"Bajo mínimo · {name}",
                       f"Quedan {product.qty} (mínimo {product.min_qty}). Revisa la reserva o haz el pedido.",
                       "/summary", f"low-{product.sku}", None))
    return events
