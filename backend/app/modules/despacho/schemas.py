"""Datos de lo que esta de paso y del despacho."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.modules.bodega.logic import DISPATCH
from app.core.types import UtcDatetime
from app.modules.inventario.schemas import ProductOut


class DispatchLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)


class DispatchSendIn(BaseModel):
    """Lo de paso que ya salio empacado: se descuenta de Despacho."""
    lines: list[DispatchLineIn] = Field(min_length=1)
    note: Optional[str] = Field(default=None, max_length=60)  # pedido, cliente, guia...


class DispatchSendOut(BaseModel):
    units: int
    lines: int


class DispatchOut(BaseModel):
    product: ProductOut
    qty: int  # cuantas hay de paso
    since: Optional[UtcDatetime] = None  # cuando llego la ultima
    # la remision con que llego la ultima, y lo que se anoto en ella
    doc_number: Optional[str] = None
    doc_supplier: Optional[str] = None
    doc_notes: Optional[str] = None


# ---------- de paso sin ser inventario (cajas sueltas, canastas...) ----------
ParcelKind = Literal["caja", "canasta", "bolsa", "otro"]


class ParcelIn(BaseModel):
    kind: ParcelKind = "caja"
    label: str = Field(default="", max_length=60)  # "otro": que es
    qty: int = Field(default=1, ge=1, le=999)
    owner: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=500)
    location_id: str = Field(default=DISPATCH, min_length=1, max_length=32)


class ParcelUpdateIn(BaseModel):
    kind: Optional[ParcelKind] = None
    label: Optional[str] = Field(default=None, max_length=60)
    qty: Optional[int] = Field(default=None, ge=1, le=999)
    owner: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)
    location_id: Optional[str] = Field(default=None, min_length=1, max_length=32)


class ParcelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    label: Optional[str] = None
    qty: int
    owner: Optional[str] = None
    notes: Optional[str] = None
    location_id: str
    location_name: str = ""
    user_id: Optional[int] = None
    user_name: str
    created_at: UtcDatetime
    done_at: Optional[UtcDatetime] = None
    done_by: Optional[str] = None
