"""Datos de los reportes."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import UtcDatetime
from app.modules.inventario.schemas import ProductOut


# ---------- reportes ----------
class NeedOut(BaseModel):
    product: ProductOut
    order_qty: int  # cuanto pedir al proveedor (0: lo cubre la reserva)
    in_reserve: int = 0  # cuanto hay guardado en la reserva


class WeekFlowOut(BaseModel):
    week: str  # lunes de la semana, AAAA-MM-DD
    in_: int = Field(alias="in", serialization_alias="in")
    out: int

    model_config = ConfigDict(populate_by_name=True)


class DeadOut(BaseModel):
    product: ProductOut
    last_out: Optional[UtcDatetime] = None  # None: nunca ha salido


class ValueOut(BaseModel):
    available: bool  # se pudo leer la tienda
    value: int  # bodega: prendas x precio de la tienda
    units_priced: int
    units_total: int
    reserve_value: int
    reserve_units_priced: int
    reserve_units_total: int


class TopOut(BaseModel):
    sku: str
    name: str
    size: str
    qty_out: int
