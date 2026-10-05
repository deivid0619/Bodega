"""Configuracion comun de las pruebas: base de datos propia y sin catalogo
de la tienda (nada sale a internet)."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")
os.environ["CATALOG_URL"] = ""
