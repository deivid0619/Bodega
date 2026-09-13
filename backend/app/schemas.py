"""Esquemas Pydantic: forma de los datos que entran y salen de la API."""
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

ElementType = Literal["bins", "shelf", "rack", "boxes", "table", "ladder", "balloons"]
MovementType = Literal["in", "out", "set"]


# ---------- auth ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: str


class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: str
    invite_code: str


class LoginIn(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- layout ----------
class RoomOut(BaseModel):
    width: float
    depth: float


class RoomIn(BaseModel):
    width: float = Field(ge=4, le=24)
    depth: float = Field(ge=4, le=24)


class LocationOut(BaseModel):
    id: str
    kind: str
    name: str


class ElementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: ElementType
    code: Optional[str] = None
    x: float
    z: float
    rot: int
    params: dict[str, Any]
    locations: list[LocationOut] = []
    name: str


class ElementCreateIn(BaseModel):
    type: ElementType
    x: float = 0
    z: float = 0
    rot: int = 0


class ElementUpdateIn(BaseModel):
    code: Optional[str] = None
    x: Optional[float] = None
    z: Optional[float] = None
    rot: Optional[int] = None
    params: Optional[dict[str, Any]] = None


class LayoutOut(BaseModel):
    room: RoomOut
    elements: list[ElementOut]


# ---------- products ----------
class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sku: str
    name: str
    size: str
    location_id: str
    location_name: str
    qty: int
    min_qty: int
    demo: bool
    out_30d: int = 0
    created_at: datetime
    updated_at: datetime


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    size: str = ""
    location_id: str
    qty: int = Field(ge=0, default=0)
    min_qty: int = Field(ge=0, default=0)


class ProductUpdateIn(BaseModel):
    name: Optional[str] = None
    size: Optional[str] = None
    min_qty: Optional[int] = Field(default=None, ge=0)
    location_id: Optional[str] = None


# ---------- movements ----------
class MovementIn(BaseModel):
    sku: str
    type: MovementType
    qty: int = Field(ge=0)


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
    product_name: str
    product_size: str
    user_name: str
    demo: bool
    created_at: datetime


class MovementResult(BaseModel):
    product: ProductOut
    movement: MovementOut


# ---------- reportes ----------
class NeedOut(BaseModel):
    product: ProductOut
    order_qty: int


class TopOut(BaseModel):
    sku: str
    name: str
    size: str
    qty_out: int
