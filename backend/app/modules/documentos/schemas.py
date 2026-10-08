"""Datos comunes de los documentos (remision, factura, pedido, conteo)."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import UtcDatetime
from app.modules.inventario.schemas import ProductOut


# ---------- documentos (factura / remision) ----------
class DocumentLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)
    location_id: Optional[str] = None  # sin elegir: la principal y luego donde haya


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    number: str
    units: int
    pending: int = 0
    supplier: Optional[str] = None
    doc_date: Optional[str] = None
    notes: Optional[str] = None
    lines: list[dict[str, Any]]
    user_name: str
    created_at: UtcDatetime
    photo_count: int = 0  # fotos del papel guardadas (prueba)
    photos_until: Optional[UtcDatetime] = None  # hasta cuando se guardan
    mode: Optional[str] = None  # "registro": no movio el inventario
    status: Optional[str] = None  # "espera": pedido esperando su factura
    closed_at: Optional[UtcDatetime] = None  # cuando se le anexo la factura al pedido


class PhotoStoreOut(BaseModel):
    """Donde se guardan las fotos de remisiones y facturas, y si funciona."""
    ok: bool
    where: Literal["supabase", "local", "none"]
    days: int
    detail: str


class DocumentCountsOut(BaseModel):
    """Cuantas remisiones y facturas hay guardadas, para el Resumen."""
    remision: int = 0
    factura: int = 0
    espera: int = 0  # pedidos esperando su factura


class DocumentDayOut(BaseModel):
    """Un dia del calendario (hora de Colombia): lo que entro con remision y
    lo que salio con factura."""
    day: str  # AAAA-MM-DD
    remisiones: int = 0
    units_in: int = 0
    facturas: int = 0
    units_out: int = 0


class DocumentResult(BaseModel):
    document: DocumentOut
    products: list[ProductOut]
