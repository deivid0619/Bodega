"""Motor de base de datos. Usa SQLite por defecto para desarrollo y pruebas;
en produccion se apunta DATABASE_URL a Postgres (por ejemplo, Supabase)."""
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
# pre_ping: si el pooler de Supabase cerro una conexion inactiva, se descarta
# antes de usarla en vez de fallar la peticion del usuario
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True, pool_recycle=300)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def now():
    """La hora actual en UTC (asi se guarda todo en la base)."""
    return datetime.now(timezone.utc)
