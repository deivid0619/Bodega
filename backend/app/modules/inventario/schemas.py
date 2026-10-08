"""Datos de las prendas y los movimientos."""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.types import UtcDatetime


MovementType = Literal["in", "out", "set"]


# ---------- products ----------
class StockOut(BaseModel):
    location_id: str
    location_name: str
    qty: int


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sku: str
    name: str
    size: str
    location_id: str
    location_name: str
    qty: int
    min_qty: int
    image_url: Optional[str] = None
    demo: bool
    out_30d: int = 0
    stock: list[StockOut] = []  # cuanto hay en cada ubicacion (la principal primero)
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    size: str = ""
    location_id: str
    qty: int = Field(ge=0, default=0)
    min_qty: int = Field(ge=0, default=0)
    image_url: Optional[str] = None
    label_code: Optional[str] = Field(default=None, max_length=64)  # la etiqueta, si traia el codigo mal


class AliasIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)  # lo que dice la etiqueta
    sku: str = Field(min_length=1, max_length=64)  # el codigo bueno


class ProductUpdateIn(BaseModel):
    name: Optional[str] = None
    size: Optional[str] = None
    min_qty: Optional[int] = Field(default=None, ge=0)
    location_id: Optional[str] = None
    image_url: Optional[str] = None


# ---------- movements ----------
class MovementIn(BaseModel):
    sku: str
    type: MovementType
    qty: int = Field(ge=0)
    location_id: Optional[str] = None  # sin elegir: la ubicacion principal (o donde haya, en salidas)


class MoveIn(BaseModel):
    from_location: str
    to_location: str
    qty: int = Field(gt=0)


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sku: str
    type: str
    qty: int
    before: int
    after: int
    location_id: str
    location_name: str
    to_location_id: Optional[str] = None
    to_location_name: Optional[str] = None
    note: Optional[str] = None
    product_name: str
    product_size: str
    user_name: str
    demo: bool
    created_at: UtcDatetime


class MovementResult(BaseModel):
    product: ProductOut
    movement: MovementOut  # el ultimo; una salida repartida entre ubicaciones trae varios en "movements"
    movements: list[MovementOut] = []
