"""Datos del cuarto, los muebles y sus ubicaciones."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


ElementType = Literal["bins", "shelf", "rack", "boxes", "table", "ladder", "balloons"]


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
    # canastas de la mesa: nivel (1 = arriba) y pila, para que el 3D las dibuje
    level: Optional[int] = None
    pile: Optional[int] = None
    outlet: bool = False  # lo que hay aqui no cuenta en el inventario


class ElementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: ElementType
    code: Optional[str] = None
    x: float
    z: float
    rot: int
    y0: float = 0
    params: dict[str, Any]
    locations: list[LocationOut] = []
    name: str


class ElementCreateIn(BaseModel):
    type: ElementType
    x: float = 0
    z: float = 0
    rot: int = 0


class ElementUpdateIn(BaseModel):
    type: Optional[Literal["bins", "boxes"]] = None  # canastas <-> cajas
    code: Optional[str] = None
    swap: bool = False  # si la letra ya la tiene otro mueble, intercambiarlas
    x: Optional[float] = None
    z: Optional[float] = None
    rot: Optional[int] = None
    y0: Optional[float] = None
    params: Optional[dict[str, Any]] = None


class LocationOutletIn(BaseModel):
    outlet: bool  # una sola canasta, nivel o barra: lo que hay ahi no cuenta


class LayoutOut(BaseModel):
    room: RoomOut
    elements: list[ElementOut]
