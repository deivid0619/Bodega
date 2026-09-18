"""Modelos de la base de datos."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String
)
from sqlalchemy.orm import relationship

from .database import Base


def now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(120), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="operator")  # admin | operator
    created_at = Column(DateTime(timezone=True), default=now)


class RoomConfig(Base):
    """Fila unica con las dimensiones del cuarto."""
    __tablename__ = "room_config"

    id = Column(Integer, primary_key=True, default=1)
    width = Column(Float, nullable=False, default=8.4)
    depth = Column(Float, nullable=False, default=7.0)


class Element(Base):
    """Un mueble de la bodega: pared de canastas, estanteria, perchero, cajas..."""
    __tablename__ = "elements"

    id = Column(String(16), primary_key=True)
    type = Column(String(20), nullable=False)  # bins | shelf | rack | boxes | table | ladder | balloons
    code = Column(String(6), nullable=True, index=True)
    x = Column(Float, nullable=False, default=0)
    z = Column(Float, nullable=False, default=0)
    rot = Column(Integer, nullable=False, default=0)  # 0-3, giros de 90°
    y0 = Column(Float, nullable=False, default=0)  # altura del piso a la base (para apilar muebles, ej. canastas G/H/I)
    params = Column(JSON, nullable=False, default=dict)  # {cols,rows} | {levels,w} | {bars,w} | {count} | {w}


class Product(Base):
    __tablename__ = "products"

    sku = Column(String(64), primary_key=True)
    name = Column(String(200), nullable=False)
    size = Column(String(20), nullable=False, default="")
    location_id = Column(String(32), nullable=False, index=True)
    qty = Column(Integer, nullable=False, default=0)
    min_qty = Column(Integer, nullable=False, default=0)
    image_url = Column(String(500), nullable=True)
    demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)

    movements = relationship("Movement", back_populates="product", cascade="all, delete-orphan")


class Movement(Base):
    __tablename__ = "movements"

    id = Column(Integer, primary_key=True)
    sku = Column(String(64), ForeignKey("products.sku", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(10), nullable=False)  # in | out | set | new
    qty = Column(Integer, nullable=False)
    before = Column(Integer, nullable=False)
    after = Column(Integer, nullable=False)
    location_id = Column(String(32), nullable=False)
    product_name = Column(String(200), nullable=False)
    product_size = Column(String(20), nullable=False, default="")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(120), nullable=False, default="")
    demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=now, index=True)

    product = relationship("Product", back_populates="movements")


class ReserveItem(Base):
    """Bodega de reserva: mercancia que todavia no esta en ningun perchero
    ni canasta, guardada aparte hasta que se necesite reponer la bodega
    principal. No tiene location_id porque no esta ubicada fisicamente."""
    __tablename__ = "reserve_items"

    id = Column(Integer, primary_key=True)
    sku = Column(String(64), nullable=True, index=True)  # opcional: se completa cuando se conoce el codigo real
    name = Column(String(200), nullable=False)
    size = Column(String(20), nullable=False, default="")
    qty = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
