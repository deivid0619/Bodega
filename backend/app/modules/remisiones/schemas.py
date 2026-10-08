"""Lo que llega al registrar una remision y lo que entro hace poco."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.core.types import UtcDatetime


class RemisionLineIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)  # la remision trae la referencia, no el codigo
    size: str = Field(default="", max_length=20)
    sku: Optional[str] = Field(default=None, max_length=64)  # sin codigo: entra a la reserva
    qty: int = Field(ge=0, default=0)  # lo que llego y se conto
    pending: int = Field(ge=0, default=0)  # lo que el proveedor quedo debiendo
    # bodega: donde se guarda esta referencia; sin elegir, la de toda la remision
    # o, si tampoco, donde ya esta cada talla
    location_id: Optional[str] = Field(default=None, max_length=32)
    to_reserve: bool = False  # bodega: esta parte va a la reserva (repartir una talla entre las dos)


class RemisionIn(BaseModel):
    number: str = Field(default="", max_length=40)  # algunas no lo traen: se le pone uno automatico
    supplier: str = Field(default="", max_length=120)
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    # despacho: de paso, sale en unos dias; registro: solo se guarda el papel
    # (lo que llego ya se habia entrado), no se toca el inventario
    destination: Literal["bodega", "reserva", "despacho", "registro"] = "bodega"
    location_id: Optional[str] = None  # bodega: sin elegir, la ubicacion principal de cada talla
    notes: str = Field(default="", max_length=500)  # lo demas que diga el papel
    lines: list[RemisionLineIn] = Field(min_length=1)


class RecentEntryOut(BaseModel):
    """Lo que entro de un codigo escaneando (o a mano) en los ultimos dias."""
    sku: str
    qty: int
    last_at: UtcDatetime
