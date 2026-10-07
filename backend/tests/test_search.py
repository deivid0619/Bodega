"""El buscador del inventario: por palabras, en cualquier orden, sin
importar tildes, y con el nombre que la prenda tiene en la tienda (aunque se
haya guardado con otro) o una etiqueta corregida."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app import catalog
from app.config import settings
from app.main import app

STORE = {
    "BUSQ-GPV-M": {"sku": "BUSQ-GPV-M", "name": "CHAQUETA MOTO GENESIS PRO VERANO NEGRA HOMBRE", "size": "M",
                   "price": 1, "image": None, "product": "gpv"},
}


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_search_by_words_and_store_name(monkeypatch):
    monkeypatch.setattr(catalog, "items", lambda fetch=True: STORE)
    with TestClient(app) as client:
        h = _h(client)
        # se guardo a mano con otro nombre; en la tienda es la Genesis Pro Verano Negra
        r = client.post("/api/products", headers=h, json={"sku": "BUSQ-GPV-M", "name": "CHAQUETA GENESIS VERANO NEGRA H",
                                                          "size": "M", "location_id": "F-1-1", "qty": 2})
        assert r.status_code == 201, r.text
        r = client.post("/api/products", headers=h, json={"sku": "BUSQ-OTRA-M", "name": "CHAQUETA GENESIS INVIERNO",
                                                          "size": "M", "location_id": "F-1-1", "qty": 1})
        assert r.status_code == 201, r.text

        def found(q):
            return {p["sku"] for p in client.get("/api/products", headers=h, params={"search": q}).json()
                    if p["sku"].startswith("BUSQ-")}

        assert found("chaqueta moto genesis pro") == {"BUSQ-GPV-M"}  # por el nombre de la tienda
        assert found("negra genesis verano") == {"BUSQ-GPV-M"}  # en cualquier orden
        assert found("GÉNESIS") == {"BUSQ-GPV-M", "BUSQ-OTRA-M"}  # con tilde
        assert found("genesis invierno") == {"BUSQ-OTRA-M"}
        assert found("busq-otra") == {"BUSQ-OTRA-M"}  # por codigo
        # una etiqueta corregida tambien la encuentra
        assert client.post("/api/catalog/alias", headers=h, json={"code": "BUSQETIQUETAMAL", "sku": "BUSQ-GPV-M"}).status_code == 204
        assert found("busqetiquetamal") == {"BUSQ-GPV-M"}
        assert found("genesis zzz") == set()
