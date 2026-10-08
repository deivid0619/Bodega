"""Los enlaces para ver sin editar (uno por persona): quien lo abre entra sin
contrasena con el nombre del enlace, ve todo y el servidor no le deja cambiar
nada. Se le cambia el nombre, y al quitarlo su sesion se cierra."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app import models
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_view_links_see_everything_and_change_nothing():
    with TestClient(app) as client:
        admin = _h(client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["access_token"])
        assert client.post("/api/products", headers=admin, json={"sku": "VER-1", "name": "PRUEBA SOLO VER", "size": "M",
                                                                 "location_id": "F-1-1", "qty": 2}).status_code == 201
        gab = client.post("/api/auth/view-links", headers=admin, json={"name": "  Gabriel "}).json()
        ana = client.post("/api/auth/view-links", headers=admin, json={"name": "Ana"}).json()
        links = {l["name"]: l for l in client.get("/api/auth/view-links", headers=admin).json()}
        assert {"Gabriel", "Ana"} <= set(links) and not links["Gabriel"]["used"]

        # cada uno entra sin contrasena, como "Solo ver", con su nombre
        r = client.post("/api/auth/view", json={"key": gab["key"]})
        assert r.status_code == 200 and r.json()["user"] == {**r.json()["user"], "role": "viewer", "name": "Gabriel"}
        g = _h(r.json()["access_token"])
        a = _h(client.post("/api/auth/view", json={"key": ana["key"]}).json()["access_token"])
        assert client.get("/api/products", headers=g).status_code == 200
        assert next(l for l in client.get("/api/auth/view-links", headers=admin).json() if l["id"] == gab["id"])["used"]
        # no cambia nada
        r = client.post("/api/movements", headers=g, json={"sku": "VER-1", "type": "out", "qty": 1})
        assert r.status_code == 403 and "solo para ver" in r.json()["detail"]
        assert client.delete("/api/products/VER-1", headers=a).status_code == 403
        assert client.post("/api/documents/pedido", headers=g, json={"lines": [{"sku": "VER-1", "qty": 1}]}).status_code == 403
        assert client.get("/api/auth/view-links", headers=g).status_code == 403
        assert client.get("/api/products/VER-1", headers=admin).json()["qty"] == 2

        # cambiarle el nombre: el mismo enlace, su cuenta se llama distinto
        r = client.patch(f"/api/auth/view-links/{gab['id']}", headers=admin, json={"name": "Gabriel Gómez"})
        assert r.status_code == 200 and r.json()["key"] == gab["key"]
        assert client.get("/api/auth/me", headers=g).json()["name"] == "Gabriel Gómez"

        # quitar el de Ana: ya no abre y ella sale; Gabriel sigue
        assert client.delete(f"/api/auth/view-links/{ana['id']}", headers=admin).status_code == 204
        assert client.get("/api/products", headers=a).status_code == 401
        assert client.post("/api/auth/view", json={"key": ana["key"]}).status_code == 401
        assert client.get("/api/products", headers=g).status_code == 200
        client.delete(f"/api/auth/view-links/{gab['id']}", headers=admin)


def test_the_old_single_link_keeps_working():
    with TestClient(app) as client:
        admin = _h(client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["access_token"])
        db = SessionLocal()
        db.add(models.AppSetting(key="view_link", value="llave-de-antes-123456"))
        db.add(models.AppSetting(key="view_link_name", value="Gabriel"))
        db.commit()
        db.close()
        r = client.post("/api/auth/view", json={"key": "llave-de-antes-123456"})
        assert r.status_code == 200 and r.json()["user"]["name"] == "Gabriel"
        old = next(l for l in client.get("/api/auth/view-links", headers=admin).json() if l["key"] == "llave-de-antes-123456")
        assert old["name"] == "Gabriel"
        client.delete(f"/api/auth/view-links/{old['id']}", headers=admin)
