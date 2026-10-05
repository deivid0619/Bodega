"""Mercancia de paso: se cuenta en Despacho, no se mezcla con la bodega
(ni con lo que hay que pedir) y es lo primero que sale."""
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    p = client.get(f"/api/products/{sku}", headers=h).json()
    return {s["location_id"]: s["qty"] for s in p["stock"]}


def test_passing_goods_stay_apart_and_ship_first():
    with TestClient(app) as client:
        h = _h(client)
        ref = "CHAQUETA DE PASO"
        r = client.post("/api/products", headers=h, json={"sku": "PASO-M", "name": ref, "size": "M",
                                                           "location_id": "F-2-1", "qty": 2, "min_qty": 2})
        assert r.status_code == 201, r.text
        assert any(n["product"]["sku"] == "PASO-M" for n in client.get("/api/reports/needs", headers=h).json())

        # llegan 10 M (ya registrada) y 4 L (codigo nuevo) solo para despachar
        r = client.post("/api/documents/remision", headers=h, json={"number": "PASO 1", "destination": "despacho", "lines": [
            {"name": ref, "size": "M", "sku": "PASO-M", "qty": 10}, {"name": ref, "size": "L", "sku": "PASO-L", "qty": 4}]})
        assert r.status_code == 201, r.text
        assert {l["size"]: l["dest"] for l in r.json()["document"]["lines"]} == {"M": "despacho", "L": "despacho"}
        assert _stock(client, h, "PASO-M") == {"F-2-1": 2, "DESPACHO": 10}
        assert _stock(client, h, "PASO-L") == {"DESPACHO": 4}

        # lo de paso no tapa lo que hay que pedir, y aparece por despachar
        assert any(n["product"]["sku"] == "PASO-M" for n in client.get("/api/reports/needs", headers=h).json())
        passing = {d["product"]["sku"]: d["qty"] for d in client.get("/api/reports/dispatch", headers=h).json()}
        assert passing == {"PASO-M": 10, "PASO-L": 4}

        # al despachar, sale primero de Despacho
        client.post("/api/movements", headers=h, json={"sku": "PASO-M", "type": "out", "qty": 10})
        assert _stock(client, h, "PASO-M") == {"F-2-1": 2}

        # un codigo que solo esta de paso no entra "automatico" a la bodega: hay que elegir
        r = client.post("/api/movements", headers=h, json={"sku": "PASO-L", "type": "in", "qty": 1})
        assert r.status_code == 400 and "Despacho" in r.json()["detail"]
        r = client.post("/api/movements", headers=h, json={"sku": "PASO-L", "type": "in", "qty": 1, "location_id": "F-2-1"})
        assert r.status_code == 200

        # de paso sin codigo: no se puede
        r = client.post("/api/documents/remision", headers=h, json={"destination": "despacho", "lines": [
            {"name": ref, "size": "XL", "qty": 3}]})
        assert r.status_code == 400 and "código" in r.json()["detail"]

        # el editor de la bodega sigue funcionando con prendas en Despacho
        layout = client.get("/api/layout", headers=h).json()
        el = next(e for e in layout["elements"] if e["type"] == "rack")
        r = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"x": el["x"]})
        assert r.status_code == 200, r.text
