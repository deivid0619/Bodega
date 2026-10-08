"""Remisiones, facturas, pedidos y conteos ya aplicados (con sus fotos)."""
from datetime import timedelta, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint

from app.core.database import Base, now


class Document(Base):
    """Factura, remision o conteo ya aplicado al inventario. La llave unica
    (tipo, numero) impide aplicar dos veces el mismo documento."""
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("kind", "number", name="uq_document_kind_number"),)

    id = Column(Integer, primary_key=True)
    kind = Column(String(20), nullable=False)  # factura | remision | conteo
    # remision: otra entrega de la misma orden lleva "#2", "#3"... (OPR123#2)
    number = Column(String(40), nullable=False)
    lines = Column(JSON, nullable=False, default=list)  # [{sku, qty, location_id}] (remision: + name, size, pending, dest)
    units = Column(Integer, nullable=False, default=0)
    pending = Column(Integer, nullable=False, default=0)  # remision: unidades que el proveedor quedo debiendo
    supplier = Column(String(120), nullable=True)  # remision: quien la entrega
    doc_date = Column(String(10), nullable=True)  # fecha escrita en el papel (AAAA-MM-DD)
    notes = Column(String(500), nullable=True)  # lo demas que diga el papel (completa/parcial, observaciones)
    # fotos del papel como prueba ([{path, type, size}]); se borran solas al
    # mes (photo_store) y aqui queda en NULL
    photos = Column(JSON(none_as_null=True), nullable=True)
    # "registro": solo se guardo el papel y lo que dice, sin mover el
    # inventario (ya se habia entrado o descontado por otro lado)
    mode = Column(String(12), nullable=True)
    # factura: "espera" = un pedido ya empacado y descontado que espera el
    # numero y la foto de su factura (mientras tanto su numero es PED-...)
    status = Column(String(12), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)  # cuando se le anexo la factura al pedido
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String(120), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), default=now, index=True)


def _photos_until(doc: "Document"):
    from app.core.config import settings
    if not doc.photos or not doc.created_at:
        return None
    created = doc.created_at if doc.created_at.tzinfo else doc.created_at.replace(tzinfo=timezone.utc)
    return created + timedelta(days=settings.photo_days)

Document.photo_count = property(lambda self: len(self.photos or []))
Document.photos_until = property(_photos_until)
