"""Datos con los que arranca una bodega nueva: el usuario administrador y
la distribución que se ve en el video de recorrido (definida en
layout_service.DEFAULT_LAYOUT, la misma que usa "restaurar distribución"),
más la prenda de la etiqueta de ejemplo."""
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
    if not db.get(models.Product, "P-WPM210200L"):
        db.add(models.Product(
            sku="P-WPM210200L", name="CORTAV. REXA IMP-100% NEGRO", size="L",
            location_id="C-1-1", qty=0, min_qty=0,
        ))
    db.commit()
