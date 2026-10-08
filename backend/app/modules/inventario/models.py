"""Las prendas (un codigo por talla), cuanto hay en cada ubicacion, el historial y los codigos de etiqueta mal impresos."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.core.database import Base, now


class Product(Base):
    __tablename__ = "products"

    sku = Column(String(64), primary_key=True)
    name = Column(String(200), nullable=False)
    size = Column(String(20), nullable=False, default="")
    # ubicacion principal: donde entra lo que se escanea si no se elige otra
    location_id = Column(String(32), nullable=False, index=True)
    # total en toda la bodega = suma de Stock; se actualiza en la misma
    # transaccion de cada movimiento
    qty = Column(Integer, nullable=False, default=0)
    min_qty = Column(Integer, nullable=False, default=0)
    image_url = Column(String(500), nullable=True)
    demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)

    movements = relationship("Movement", back_populates="product", cascade="all, delete-orphan")
    stock = relationship("Stock", cascade="all, delete-orphan")


class Stock(Base):
    """Unidades de un codigo en una ubicacion. Un mismo codigo puede estar
    en varias (la Fenix S en el perchero D y en una canasta a la vez)."""
    __tablename__ = "stock"
    __table_args__ = (UniqueConstraint("sku", "location_id", name="uq_stock_sku_location"),)

    id = Column(Integer, primary_key=True)
    sku = Column(String(64), ForeignKey("products.sku", ondelete="CASCADE"), nullable=False, index=True)
    location_id = Column(String(32), nullable=False, index=True)
    qty = Column(Integer, nullable=False, default=0)


class Movement(Base):
    __tablename__ = "movements"

    id = Column(Integer, primary_key=True)
    sku = Column(String(64), ForeignKey("products.sku", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(10), nullable=False)  # in | out | set | new | move
    qty = Column(Integer, nullable=False)
    before = Column(Integer, nullable=False)  # total del codigo antes
    after = Column(Integer, nullable=False)   # total del codigo despues
    location_id = Column(String(32), nullable=False)  # ubicacion afectada (en "move", el origen)
    to_location_id = Column(String(32), nullable=True)  # solo "move": el destino
    note = Column(String(80), nullable=True)  # ej. "Factura FEV21830"
    product_name = Column(String(200), nullable=False)
    product_size = Column(String(20), nullable=False, default="")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(120), nullable=False, default="")
    demo = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=now, index=True)

    product = relationship("Product", back_populates="movements")


class CodeAlias(Base):
    """Un codigo de etiqueta mal impreso que apunta al bueno (el de la tienda):
    al escanear esa etiqueta se usa el codigo bueno."""
    __tablename__ = "code_aliases"

    code = Column(String(64), primary_key=True)
    sku = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=now)
