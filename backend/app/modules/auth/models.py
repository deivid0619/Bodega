"""Usuarios y enlaces para ver sin editar."""
from sqlalchemy import Column, DateTime, Integer, JSON, String

from app.core.database import Base, now


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(120), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="operator")  # admin | operator | viewer (solo ver, del enlace)
    created_at = Column(DateTime(timezone=True), default=now)


class ViewLink(Base):
    """Un enlace para ver sin editar, uno por persona: quien lo abre entra sin
    contrasena como "Solo ver", con el nombre del enlace. Al quitarlo, su
    sesion se cierra."""
    __tablename__ = "view_links"

    id = Column(Integer, primary_key=True)
    key = Column(String(64), nullable=False, unique=True)
    name = Column(String(60), nullable=False, default="")
    # que avisos le van marcados de entrada: {"remision": bool, "entradas": bool, "salidas": bool}
    # (al registrar se puede cambiar; sin dato, marcados)
    notify = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now)
