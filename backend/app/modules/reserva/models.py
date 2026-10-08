"""La bodega de reserva: mercancia guardada aparte."""
from sqlalchemy import Column, DateTime, Integer, String

from app.core.database import Base, now


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
    image_url = Column(String(500), nullable=True)  # la foto de la tienda (o de la bodega)
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now)
