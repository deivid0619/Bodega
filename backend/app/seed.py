"""Datos con los que arranca una bodega nueva: el usuario administrador y
la distribución que se ve en el video de recorrido (definida en
layout_service.DEFAULT_LAYOUT, la misma que usa "restaurar distribución").
Ninguna prenda: el inventario empieza vacío."""
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .layout_service import DEFAULT_LAYOUT, DEFAULT_ROOM
from .security import hash_password


def seed(db: Session) -> None:
    if not db.query(models.RoomConfig).first():
        db.add(models.RoomConfig(id=1, **DEFAULT_ROOM))
    if db.query(models.Element).count() == 0:
        for el in DEFAULT_LAYOUT:
            db.add(models.Element(**el))
    if not db.query(models.User).filter(models.User.email == settings.admin_email).first():
        db.add(models.User(
            email=settings.admin_email, name=settings.admin_name,
            password_hash=hash_password(settings.admin_password), role="admin",
        ))
    db.commit()
