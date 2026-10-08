"""Lo comun a los documentos (remisiones, facturas, pedidos y conteos):
el numero normalizado, si ya existe, la medianoche de Colombia, buscar sin
tildes y borrar las fotos viejas en segundo plano."""
import threading
import unicodedata
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.core.database import SessionLocal
from app.core.migrations import purge_old_photos
from app.modules.inventario import serializers as ser


def norm_number(number: str) -> str:
    return "".join(number.upper().split())


def already(db: Session, kind: str, number: str) -> Optional[models.Document]:
    return db.query(models.Document).filter_by(kind=kind, number=number).first()


# ---- fotos del papel: la prueba de lo que llego y lo que salio ----
def purge_in_background() -> None:
    def run():
        db = SessionLocal()
        try:
            purge_old_photos(db)
        finally:
            db.close()
    threading.Thread(target=run, daemon=True).start()


def local_midnight(y: int, m: int, d: int = 1) -> datetime:
    """Las 12 de la noche en Colombia, en UTC (como esta en la base)."""
    return datetime(y, m, d, tzinfo=ser.BOGOTA).astimezone(timezone.utc)


def fold(s: str) -> str:
    """Para buscar sin importar mayusculas ni tildes: 'Ñandú' -> 'nandu'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c))
