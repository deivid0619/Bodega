"""El cuarto y sus muebles (la bodega 3D)."""
from sqlalchemy import Column, Float, Integer, JSON, String

from app.core.database import Base


class RoomConfig(Base):
    """Fila unica con las dimensiones del cuarto."""
    __tablename__ = "room_config"

    id = Column(Integer, primary_key=True, default=1)
    width = Column(Float, nullable=False, default=8.4)
    depth = Column(Float, nullable=False, default=7.0)


class Element(Base):
    """Un mueble de la bodega: pared de canastas, estanteria, perchero, cajas..."""
    __tablename__ = "elements"

    id = Column(String(16), primary_key=True)
    type = Column(String(20), nullable=False)  # bins | shelf | rack | boxes | table | ladder | balloons
    code = Column(String(6), nullable=True, index=True)
    x = Column(Float, nullable=False, default=0)
    z = Column(Float, nullable=False, default=0)
    rot = Column(Integer, nullable=False, default=0)  # 0-3, giros de 90°
    y0 = Column(Float, nullable=False, default=0)  # altura del piso a la base (para apilar muebles, ej. canastas G/H/I)
    params = Column(JSON, nullable=False, default=dict)  # {cols,rows} | {levels,w} | {bars,w} | {count} | {w}
