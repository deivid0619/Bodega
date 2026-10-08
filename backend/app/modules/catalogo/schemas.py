"""Datos de la tienda en linea."""
from typing import Optional

from pydantic import BaseModel


class CatalogItemOut(BaseModel):
    sku: str
    name: str
    size: str
    price: int
    image: Optional[str] = None


class CatalogStatusOut(BaseModel):
    enabled: bool
    codes: int  # cuantos codigos de la tienda hay en memoria
    error: Optional[str] = None  # por que fallo la ultima vez (si fallo)
    ok_at: Optional[float] = None  # cuando se leyo bien por ultima vez (segundos epoch)


class CatalogNearOut(CatalogItemOut):
    in_bodega: bool = False  # ese codigo bueno ya esta registrado en la bodega


class CatalogSizeOut(BaseModel):
    size: str
    sku: str
    price: int


class CatalogProductOut(BaseModel):
    name: str
    image: Optional[str] = None
    sizes: list[CatalogSizeOut]
