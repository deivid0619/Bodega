"""Lo que llega al guardar el conteo de una ubicacion."""
from pydantic import BaseModel, Field


class CountLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(ge=0)  # lo que se conto en la ubicacion


class CountIn(BaseModel):
    location_id: str = Field(min_length=1, max_length=32)
    lines: list[CountLineIn] = Field(min_length=1)
