"""Datos de los avisos para los enlaces "solo ver"."""
from typing import Optional

from pydantic import BaseModel, Field

from app.core.types import UtcDatetime


class RecipientOut(BaseModel):
    """A quien se le puede avisar (una persona de un enlace) y si va marcada
    de entrada para cada tipo de aviso."""
    id: int
    name: str
    remision: bool
    entradas: bool
    salidas: bool


class NoticeIn(BaseModel):
    kind: str = Field(pattern="^(remision|in|out)$")
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(default="", max_length=1000)
    url: str = Field(default="/summary", max_length=200, pattern="^/")
    links: list[int] = Field(min_length=1, max_length=50)


class NoticeOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    url: str
    user_name: str
    to: list[str] = []  # a quienes se mando (solo lo ve el equipo)
    created_at: Optional[UtcDatetime] = None
