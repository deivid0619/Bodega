"""Punto de entrada de la API. Crea las tablas, siembra los datos iniciales
y expone las rutas de cada modulo (app/modules) bajo /api."""
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app import models  # noqa: F401  (registra todas las tablas)
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.migrations import backfill_stock, ensure_columns, purge_old_photos, remove_sample_product, table_bins
from app.core.seed import seed
from app.modules.auth import router as auth
from app.modules.avisos import router as avisos, router_push as avisos_push
from app.modules.bodega import router as bodega
from app.modules.catalogo import router as catalogo
from app.modules.catalogo.service import warm as warm_catalog
from app.modules.conteo import router as conteo
from app.modules.despacho import router as despacho
from app.modules.documentos import router as documentos
from app.modules.facturas import router as facturas
from app.modules.inventario import router_movements as movimientos, router_products as productos
from app.modules.remisiones import router as remisiones
from app.modules.reportes import router as reportes
from app.modules.reserva import router as reserva

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
    ensure_columns(engine)
    db = SessionLocal()
    try:
        seed(db)
        backfill_stock(db)
        table_bins(db)
        remove_sample_product(db)
        try:
            purge_old_photos(db)  # las fotos de mas de un mes
        except Exception:
            pass
    finally:
        db.close()
    warm_catalog()
    yield


app = FastAPI(title="Bodega API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# cada modulo trae sus rutas (ver app/modules/README.md)
for module in (auth, bodega, productos, movimientos, reportes, reserva, documentos, remisiones, facturas, conteo,
               despacho, catalogo, avisos_push, avisos):
    app.include_router(module.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
