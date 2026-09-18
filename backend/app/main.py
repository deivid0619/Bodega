"""Punto de entrada de la API. Crea las tablas, siembra los datos iniciales
y expone los routers bajo /api."""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from . import models
from .config import settings
from .database import Base, SessionLocal, engine
from .routers import auth, layout, movements, products, reports, reserve
from .seed import seed

logger = logging.getLogger("uvicorn.error")


def wait_for_db(max_seconds: int = 60, interval: float = 2.0) -> None:
    """Reintenta la conexión inicial en vez de morir al primer intento.
    En Docker, "db" puede tardar unos segundos en quedar resoluble o en
    aceptar conexiones aunque su propio healthcheck ya diga "healthy"."""
    deadline = time.monotonic() + max_seconds
    attempt = 0
    while True:
        attempt += 1
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError as e:
            if time.monotonic() >= deadline:
                logger.error("No se pudo conectar a la base de datos tras %s intentos: %s", attempt, e)
                raise
            logger.warning("Base de datos no disponible todavía (intento %s), reintentando en %ss…", attempt, interval)
            time.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    yield


app = FastAPI(title="Bodega API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(layout.router)
app.include_router(products.router)
app.include_router(movements.router)
app.include_router(reports.router)
app.include_router(reserve.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
