"""Avisos al celular y avisos para los enlaces "solo ver"."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String

from app.core.database import Base, now


class PushSubscription(Base):
    """Un celular (o navegador) que recibe avisos, de quien es y cuales
    quiere: in, out, set, low (bajo minimo), docs (facturas y remisiones)."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String(1000), unique=True, nullable=False)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    prefs = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=now)


class Notice(Base):
    """Un aviso para las personas de los enlaces "solo ver": quien registra
    una remision o unas entradas elige a quien se lo manda. Lo ven en su
    apartado de Avisos y les llega al celular si lo activaron."""
    __tablename__ = "notices"

    id = Column(Integer, primary_key=True)
    kind = Column(String(12), nullable=False)  # remision | in | out
    title = Column(String(140), nullable=False)
    body = Column(String(1000), nullable=False, default="")
    url = Column(String(200), nullable=False, default="/summary")
    links = Column(JSON, nullable=False, default=list)  # a que enlaces se mando (ids)
    user_name = Column(String(80), nullable=False, default="")  # quien lo mando
    created_at = Column(DateTime(timezone=True), default=now, index=True)
