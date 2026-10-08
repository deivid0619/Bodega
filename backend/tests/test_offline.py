"""Sin señal: la app reintenta los cambios con la misma llave (X-Request-Id).
El servidor los aplica una sola vez y responde lo mismo de la primera vez;
lo que fallo no queda guardado y se puede volver a intentar."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def _h(client, key=None):
    tok = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}", **({"X-Request-Id": key} if key else {})}


def test_same_change_twice_counts_once():
    with TestClient(app) as client:
        h = _h(client)
        sku = f"SIN-{uuid.uuid4().hex[:6].upper()}"
        assert client.post("/api/products", headers=h, json={"sku": sku, "name": "PRUEBA SIN SEÑAL", "size": "M",
                                                             "location_id": "F-1-1", "qty": 2}).status_code == 201
        key = uuid.uuid4().hex
        first = client.post("/api/movements", headers=_h(client, key), json={"sku": sku, "type": "in", "qty": 3})
        assert first.status_code in (200, 201)
        again = client.post("/api/movements", headers=_h(client, key), json={"sku": sku, "type": "in", "qty": 3})
        assert again.status_code == first.status_code and again.json() == first.json()
        assert again.headers.get("x-repeated") == "1"
        assert client.get(f"/api/products/{sku}", headers=h).json()["qty"] == 5  # 2 + 3, una sola vez

        # otra llave: es otro cambio
        client.post("/api/movements", headers=_h(client, uuid.uuid4().hex), json={"sku": sku, "type": "in", "qty": 1})
        assert client.get(f"/api/products/{sku}", headers=h).json()["qty"] == 6

        # lo que falla no se guarda: con la misma llave se puede intentar de nuevo
        k2 = uuid.uuid4().hex
        assert client.post("/api/movements", headers=_h(client, k2), json={"sku": sku, "type": "out", "qty": 99}).status_code == 400
        ok = client.post("/api/movements", headers=_h(client, k2), json={"sku": sku, "type": "out", "qty": 1})
        assert ok.status_code in (200, 201) and "x-repeated" not in ok.headers
        assert client.get(f"/api/products/{sku}", headers=h).json()["qty"] == 5
