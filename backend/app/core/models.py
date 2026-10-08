"""Tablas internas: valores de la app y las llaves de los cambios ya guardados."""
from sqlalchemy import Column, DateTime, Integer, LargeBinary, String, Text

from app.core.database import Base, now


class AppSetting(Base):
    """Valores internos de la app (ej. las llaves con que se firman los avisos)."""
    __tablename__ = "app_settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)


class RequestKey(Base):
    """Un cambio ya guardado, por su llave (X-Request-Id): si llega otra vez
    se responde lo mismo sin aplicarlo de nuevo (ver idempotency.py). Se
    borran a los 7 dias."""
    __tablename__ = "request_keys"

    key = Column(String(64), primary_key=True)
    path = Column(String(200), nullable=False, default="")
    status = Column(Integer, nullable=False, default=200)
    media_type = Column(String(80), nullable=True)
    body = Column(LargeBinary, nullable=False, default=b"")
    created_at = Column(DateTime(timezone=True), default=now, index=True)
