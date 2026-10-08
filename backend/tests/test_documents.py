"""Factura: descuenta todas sus lineas juntas o ninguna, y no deja aplicar
dos veces el mismo numero."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app.core.config import settings
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


def _reserve(client, h, name, size):
    return [i for i in client.get("/api/reserve", headers=h).json() if i["name"] == name and i["size"] == size]


def test_remision_enters_counted_stock_once():
    with TestClient(app) as client:
        h = _h(client)
        ref = "CHAQUETA REMI PRUEBA"
        for sku, size, qty in [("REM-S", "S", 1), ("REM-M", "M", 0)]:
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": ref, "size": size, "location_id": "F-3-1", "qty": qty})
            assert r.status_code == 201, r.text

        body = {"number": "opr 77", "supplier": "Taller Prueba", "date": "2026-10-04", "destination": "bodega", "lines": [
            {"name": ref, "size": "S", "sku": "REM-S", "qty": 3, "pending": 1},
            {"name": ref, "size": "M", "sku": "REM-M", "qty": 2},
            {"name": ref, "size": "L", "qty": 4, "pending": 2},          # sin codigo: a la reserva
            {"name": ref, "size": "XL", "sku": "REM-XL", "qty": 1},     # codigo nuevo: junto a sus tallas
        ]}
        r = client.post("/api/documents/remision", headers=h, json=body)
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert (doc["number"], doc["units"], doc["pending"], doc["supplier"]) == ("OPR77", 10, 3, "Taller Prueba")
        assert {l["size"]: l["dest"] for l in doc["lines"]} == {"S": "bodega", "M": "bodega", "L": "reserva", "XL": "bodega"}
        assert (_qty(client, h, "REM-S"), _qty(client, h, "REM-M"), _qty(client, h, "REM-XL")) == (4, 2, 1)
        assert client.get("/api/products/REM-XL", headers=h).json()["location_id"] == "F-3-1"
        assert _reserve(client, h, ref, "L")[0]["qty"] == 4
        notes = {m["note"] for m in client.get("/api/movements?limit=3", headers=h).json()}
        assert notes == {"Remisión OPR77"}

        # la misma remision otra vez: rechazada; otra entrega de la misma orden: entra
        assert client.post("/api/documents/remision", headers=h, json=body).status_code == 409
        r = client.post("/api/documents/remision", headers=h, json={"number": "OPR77#2", "lines": [
            {"name": ref, "size": "S", "sku": "REM-S", "qty": 1}]})
        assert r.status_code == 201, r.text
        assert [d["number"] for d in client.get("/api/documents?kind=remision&base=OPR77", headers=h).json()] == ["OPR77#2", "OPR77"]
        assert _qty(client, h, "REM-S") == 5

        # a la reserva: la bodega no cambia y la talla sin codigo recibe el codigo
        r = client.post("/api/documents/remision", headers=h, json={"number": "OPR78", "destination": "reserva", "lines": [
            {"name": ref, "size": "S", "sku": "REM-S", "qty": 2}, {"name": ref, "size": "L", "sku": "REM-L", "qty": 1}]})
        assert r.status_code == 201, r.text
        assert _qty(client, h, "REM-S") == 5
        assert _reserve(client, h, ref, "S")[0]["qty"] == 2
        lres = _reserve(client, h, ref, "L")
        assert len(lres) == 1 and lres[0]["qty"] == 5 and lres[0]["sku"] == "REM-L"

        # sin numero ni proveedor (hay remisiones que no los traen): entra igual
        r = client.post("/api/documents/remision", headers=h, json={"notes": "  Parcial,   falta color negro ", "lines": [
            {"name": ref, "size": "S", "sku": "REM-S", "qty": 1}]})
        assert r.status_code == 201, r.text
        assert r.json()["document"]["number"].startswith("SN-") and r.json()["document"]["supplier"] is None
        assert r.json()["document"]["notes"] == "Parcial, falta color negro"
        assert _qty(client, h, "REM-S") == 6

        # si una talla no se puede guardar, no entra nada
        r = client.post("/api/documents/remision", headers=h, json={"number": "OPR79", "lines": [
            {"name": ref, "size": "S", "sku": "REM-S", "qty": 5},
            {"name": "REFERENCIA NUEVA SIN UBICACION", "size": "M", "sku": "REM-NUEVA", "qty": 1}]})
        assert r.status_code == 400
        assert "No entró nada" in r.json()["detail"]
        assert _qty(client, h, "REM-S") == 6
        assert client.get("/api/products/REM-NUEVA", headers=h).status_code == 404
