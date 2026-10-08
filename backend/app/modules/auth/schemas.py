"""Datos de la sesion, los usuarios y los enlaces para ver."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.types import UtcDatetime


# ---------- auth ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=120)
    invite_code: str


class ViewKeyIn(BaseModel):
    key: str = Field(min_length=1, max_length=200)  # una llave mal pegada da "Este enlace ya no funciona"


class ViewLinkIn(BaseModel):
    name: str = Field(default="", max_length=60)  # para quien es (su cuenta se llama asi)


class ViewLinkOut(BaseModel):
    """Un enlace para ver sin editar: su llave (va en el enlace), para quien es,
    si ya lo abrio y que avisos le van marcados de entrada."""
    id: int
    key: str
    name: str
    used: bool = False
    notify: dict[str, bool] = {}
    created_at: Optional[UtcDatetime] = None


class ViewLinkNotifyIn(BaseModel):
    remision: bool = True
    entradas: bool = True
    salidas: bool = True


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
