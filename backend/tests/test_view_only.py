"""El enlace para ver sin editar: quien lo abre entra sin contrasena, ve todo
y el servidor no le deja cambiar nada. Al crear otro o desactivarlo, el
anterior y sus sesiones dejan de servir."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_view_link_sees_everything_and_changes_nothing():
    with TestClient(app) as client:
        admin = _h(client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["access_token"])
        assert client.post("/api/products", headers=admin, json={"sku": "VER-1", "name": "PRUEBA SOLO VER", "size": "M",
                                                                 "location_id": "F-1-1", "qty": 2}).status_code == 201
        key = client.post("/api/auth/view-link", headers=admin, json={"name": "  Gabriel "}).json()["key"]
        assert client.get("/api/auth/view-link", headers=admin).json() == {"active": True, "key": key, "name": "Gabriel"}

        # entra sin contrasena, como "Solo ver", con el nombre de quien lo usa
        r = client.post("/api/auth/view", json={"key": key})
        assert r.status_code == 200 and r.json()["user"]["role"] == "viewer" and r.json()["user"]["name"] == "Gabriel"
        viewer = _h(r.json()["access_token"])
        assert client.get("/api/products", headers=viewer).status_code == 200
        assert client.get("/api/documents/counts", headers=viewer).status_code == 200
        # no cambia nada: ni movimientos, ni prendas, ni documentos, ni el enlace
        r = client.post("/api/movements", headers=viewer, json={"sku": "VER-1", "type": "out", "qty": 1})
        assert r.status_code == 403 and "solo para ver" in r.json()["detail"]
        assert client.delete("/api/products/VER-1", headers=viewer).status_code == 403
        assert client.post("/api/documents/pedido", headers=viewer, json={"lines": [{"sku": "VER-1", "qty": 1}]}).status_code == 403
        assert client.get("/api/auth/view-link", headers=viewer).status_code == 403
        assert client.get("/api/products/VER-1", headers=admin).json()["qty"] == 2

        # un enlace nuevo (sin nombre): el anterior ya no abre y su sesion se cierra
        new = client.post("/api/auth/view-link", headers=admin).json()["key"]
        assert new != key
        assert client.get("/api/products", headers=viewer).status_code == 401
        assert client.post("/api/auth/view", json={"key": key}).status_code == 401
        r = client.post("/api/auth/view", json={"key": new})
        assert r.json()["user"]["name"] == "Solo ver"
        viewer = _h(r.json()["access_token"])
        assert client.get("/api/products", headers=viewer).status_code == 200

        # desactivado: no abre y quien estaba adentro sale
        assert client.delete("/api/auth/view-link", headers=admin).status_code == 204
        assert client.get("/api/products", headers=viewer).status_code == 401
        assert client.post("/api/auth/view", json={"key": new}).status_code == 401
        assert client.get("/api/auth/view-link", headers=admin).json() == {"active": False, "key": None, "name": None}
