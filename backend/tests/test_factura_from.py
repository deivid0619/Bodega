"""Factura: si se elige de que canasta sale una linea, esa sale primero; lo
de "donde haya" va despues y no se lleva lo de la canasta elegida."""
import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_chosen_location_goes_before_the_automatic_part():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:6].upper()
        sku = f"FAC-{tag}"
        # 1 en la principal, 2 en C-2-4 y 1 en C-3-3
        r = client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA FACTURA PRUEBA", "size": "M",
                                                           "location_id": "C-1-1", "qty": 1})
        assert r.status_code == 201, r.text
        for loc, qty in (("C-2-4", 2), ("C-3-3", 1)):
            assert client.post("/api/movements", headers=h, json={"sku": sku, "type": "in", "qty": qty,
                                                                   "location_id": loc}).status_code == 200

        # aunque llegue primero lo de "donde haya", sale primero lo de C-2-4
        r = client.post("/api/documents/factura", headers=h, json={"number": f"PRUEBA{tag}", "lines": [
            {"sku": sku, "qty": 2},
            {"sku": sku, "qty": 2, "location_id": "C-2-4"},
        ]})
        assert r.status_code == 201, r.text
        stock = {s["location_id"]: s["qty"] for s in client.get(f"/api/products/{sku}", headers=h).json()["stock"]}
        assert sum(stock.values()) == 0

        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
