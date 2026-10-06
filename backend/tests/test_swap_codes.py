"""Intercambiar las letras de dos muebles: cada uno se queda con sus prendas,
solo cambia el nombre de sus ubicaciones."""
import uuid

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_swapping_two_letters_keeps_each_garment_in_its_furniture():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:4].upper()
        a = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()
        b = client.post("/api/layout/elements", headers=h, json={"type": "shelf", "x": 1, "z": 0}).json()
        ca, cb = a["code"], b["code"]
        # una prenda en cada mueble
        for sku, loc in ((f"SWA-{tag}", f"{ca}-1-2"), (f"SWB-{tag}", f"{cb}-N2")):
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": "PRUEBA LETRAS", "size": "M", "location_id": loc, "qty": 2})
            assert r.status_code == 201, r.text

        # sin pedir intercambio: avisa que la letra ya esta (para ofrecerlo)
        r = client.patch(f"/api/layout/elements/{a['id']}", headers=h, json={"code": cb})
        assert r.status_code == 409 and cb in r.json()["detail"]

        r = client.patch(f"/api/layout/elements/{a['id']}", headers=h, json={"code": cb, "swap": True})
        assert r.status_code == 200, r.text
        codes = {e["id"]: e["code"] for e in client.get("/api/layout", headers=h).json()["elements"]}
        assert codes[a["id"]] == cb and codes[b["id"]] == ca
        # las prendas no se movieron de mueble: sus ubicaciones cambiaron de nombre
        pa = client.get(f"/api/products/SWA-{tag}", headers=h).json()
        pb = client.get(f"/api/products/SWB-{tag}", headers=h).json()
        assert pa["location_id"] == f"{cb}-1-2" and [s["location_id"] for s in pa["stock"]] == [f"{cb}-1-2"]
        assert pb["location_id"] == f"{ca}-N2" and [s["location_id"] for s in pb["stock"]] == [f"{ca}-N2"]

        for sku in (f"SWA-{tag}", f"SWB-{tag}"):
            client.delete(f"/api/products/{sku}", headers=h)
        for el in (a, b):
            client.delete(f"/api/layout/elements/{el['id']}", headers=h)
