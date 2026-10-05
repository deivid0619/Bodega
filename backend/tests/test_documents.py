"""Factura: descuenta todas sus lineas juntas o ninguna, y no deja aplicar
dos veces el mismo numero."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _qty(client, h, sku):
    return client.get(f"/api/products/{sku}", headers=h).json()["qty"]


def test_factura_is_all_or_nothing_and_once():
    with TestClient(app) as client:
        h = _h(client)
        for sku, loc, qty in [("DOC-A-S", "F-1-1", 5), ("DOC-B-M", "F-2-1", 2)]:
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": "Doc", "size": "S", "location_id": loc, "qty": qty})
            assert r.status_code == 201, r.text

        # una linea pide mas de lo que hay: no se descuenta NADA
        r = client.post("/api/documents/factura", headers=h, json={"number": "FEV 9001", "lines": [
            {"sku": "DOC-A-S", "qty": 2}, {"sku": "DOC-B-M", "qty": 5}]})
        assert r.status_code == 400
        assert (_qty(client, h, "DOC-A-S"), _qty(client, h, "DOC-B-M")) == (5, 2)

        # codigo inexistente: tampoco
        r = client.post("/api/documents/factura", headers=h, json={"number": "FEV9001", "lines": [
            {"sku": "DOC-A-S", "qty": 1}, {"sku": "NO-EXISTE", "qty": 1}]})
        assert r.status_code == 400
        assert _qty(client, h, "DOC-A-S") == 5

        # lineas repetidas se suman; todo sale junto y queda la nota en el historial
        r = client.post("/api/documents/factura", headers=h, json={"number": "fev 9001", "lines": [
            {"sku": "DOC-A-S", "qty": 2}, {"sku": "doc-a-s", "qty": 1}, {"sku": "DOC-B-M", "qty": 2}]})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["document"]["number"] == "FEV9001" and body["document"]["units"] == 5
        assert (_qty(client, h, "DOC-A-S"), _qty(client, h, "DOC-B-M")) == (2, 0)
        moves = client.get("/api/movements?limit=5", headers=h).json()
        assert {m["note"] for m in moves[:2]} == {"Factura FEV9001"}

        # la misma factura otra vez: rechazada, sin tocar existencias
        client.post("/api/movements", headers=h, json={"sku": "DOC-B-M", "type": "in", "qty": 3})
        r = client.post("/api/documents/factura", headers=h, json={"number": "FEV9001", "lines": [{"sku": "DOC-B-M", "qty": 1}]})
        assert r.status_code == 409
        assert "ya se descontó" in r.json()["detail"]
        assert _qty(client, h, "DOC-B-M") == 3

        listed = client.get("/api/documents?kind=factura&number=FEV9001", headers=h).json()
        assert len(listed) == 1

        # las fechas salen marcadas como UTC: el navegador las pasa bien a la hora de Colombia
        assert listed[0]["created_at"].endswith(("Z", "+00:00"))
        assert moves[0]["created_at"].endswith(("Z", "+00:00"))

        # el historial en CSV dice de que factura salio cada prenda
        assert "Factura FEV9001" in client.get("/api/reports/movements.csv", headers=h).text
