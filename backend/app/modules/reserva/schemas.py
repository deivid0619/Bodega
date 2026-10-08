"""Datos de la bodega de reserva."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import UtcDatetime
from app.modules.inventario.schemas import MovementOut, ProductOut


# ---------- bodega de reserva ----------
class ReserveItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sku: Optional[str] = None
    name: str
    size: str
    qty: int
    image_url: Optional[str] = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ReserveItemCreateIn(BaseModel):
    sku: Optional[str] = None
    name: str = Field(min_length=1, max_length=200)
    size: str = ""
    qty: int = Field(ge=0, default=0)
    image_url: Optional[str] = Field(default=None, max_length=500)


class ReserveScanIn(BaseModel):
    """Una etiqueta escaneada para la reserva: se identifica sola."""
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0, le=9999, default=1)


class ReserveIdentifyOut(BaseModel):
    sku: str
    name: str
    size: str
    image: Optional[str] = None
    source: Literal["bodega", "tienda", "reserva"]  # de donde salio el nombre
    in_reserve: int = 0  # cuantas hay ya guardadas de ese codigo


class ReserveScanOut(BaseModel):
    item: ReserveItemOut
    added: int
    created: bool  # el codigo no estaba en la reserva
    source: Literal["bodega", "tienda", "reserva"]


class ReserveItemUpdateIn(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    size: Optional[str] = None
    qty: Optional[int] = Field(default=None, ge=0)


class ReserveReturnIn(BaseModel):
    """Devolver a la reserva lo que esta en la bodega (o en Despacho)."""
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)
    location_id: str = "DESPACHO"  # de donde sale


class ReserveDispatchIn(BaseModel):
    """Despachar desde la reserva: sale empacado sin pasar por la bodega."""
    qty: int = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=60)  # pedido, cliente, guia...
    sku: Optional[str] = None  # solo si la referencia todavia no tiene codigo


class ReserveTransferIn(BaseModel):
    qty: int = Field(gt=0)
    location_id: str
    sku: Optional[str] = None  # obligatorio solo si el item de reserva todavia no tiene sku


class ReserveTransferResult(BaseModel):
    reserve: ReserveItemOut  # con qty 0 si se acabo (y ya no esta en la reserva)
    product: ProductOut
    movement: Optional[MovementOut] = None  # la entrada a la bodega, como en un escaneo
    movements: list[MovementOut] = []


class RestockOut(BaseModel):
    reserve: ReserveItemOut
    product: ProductOut
    suggest: int  # cuantas llevar a la bodega
