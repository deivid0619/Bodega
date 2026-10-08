"""Valores internos de la app (ej. las llaves con que se firman los avisos)."""
from sqlalchemy import Column, String, Text

from app.core.database import Base


class AppSetting(Base):
    """Valores internos de la app (ej. las llaves con que se firman los avisos)."""
    __tablename__ = "app_settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)
