"""Etiquetas con el codigo mal: la prenda se registra con el codigo bueno (el
de la tienda) y la etiqueta queda reconocida; y una prenda, una foto."""
import uuid

from fastapi.testclient import TestClient

from app.modules.catalogo import service as catalog
from app.core.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_a_wrong_label_is_recognised_after_correcting_it():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        good, label = f"P-OK{tag}0XL", f"P-OK{tag}00XL"
        r = client.post("/api/products", headers=h, json={"sku": good, "name": "GUANTES ALIAS PRUEBA", "size": "XL",
                                                           "location_id": "C-1-1", "qty": 1, "label_code": label})
        assert r.status_code == 201, r.text
        # la etiqueta mal: se encuentra la prenda del codigo bueno, y se mueve esa
        assert client.get(f"/api/products/{label}", headers=h).json()["sku"] == good
        r = client.post("/api/movements", headers=h, json={"sku": label, "type": "in", "qty": 2})
        assert r.status_code == 200 and r.json()["product"]["sku"] == good and r.json()["product"]["qty"] == 3
        # la bodega propone el codigo bueno para una etiqueta casi igual
        near = client.get(f"/api/catalog/near/{label}", headers=h).json()
        assert any(n["sku"] == good and n["in_bodega"] for n in near)
        # en la reserva tambien
        r = client.post("/api/reserve/scan", headers=h, json={"sku": label, "qty": 1}).json()
        assert r["item"]["sku"] == good
        client.delete(f"/api/reserve/{r['item']['id']}", headers=h)
        assert client.delete(f"/api/products/{good}", headers=h).status_code == 204


def test_one_garment_one_photo(monkeypatch):
    monkeypatch.setattr(catalog, "lookup", lambda code, fetch=True: None)
    monkeypatch.setattr(catalog, "near", lambda code, limit=3, fetch=True: [])
    with TestClient(app) as client:
        h = _h(client)
        sku = f"FOTO{uuid.uuid4().hex[:6].upper()}"
        photo = "https://cdn.example.com/una-foto.jpg"
        # primero en la reserva con foto; al registrarla en la bodega, la toma
        item = client.post("/api/reserve", headers=h, json={"sku": sku, "name": "CHAQUETA FOTO", "size": "M",
                                                             "qty": 2, "image_url": photo}).json()
        r = client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA FOTO", "size": "M",
                                                           "location_id": "C-1-1", "qty": 1})
        assert r.json()["product"]["image_url"] == photo
        client.delete(f"/api/reserve/{item['id']}", headers=h)
        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
