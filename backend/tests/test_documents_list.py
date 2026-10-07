"""Remision con una ubicacion por referencia, y el apartado de remisiones y
facturas del Resumen: cuantas hay, buscar, ver mas y el calendario."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from datetime import datetime

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.serializers import BOGOTA


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    return {s["location_id"]: s["qty"] for s in client.get(f"/api/products/{sku}", headers=h).json()["stock"]}


def test_remision_each_reference_to_its_own_place():
    with TestClient(app) as client:
        h = _h(client)
        jacket, wind = "CHAQUETA UBICA PRUEBA", "CORTAVIENTOS UBICA PRUEBA"
        r = client.post("/api/products", headers=h, json={"sku": "UBI-CH-M", "name": jacket, "size": "M", "location_id": "F-1-1", "qty": 1})
        assert r.status_code == 201, r.text

        # la chaqueta a una ubicacion, el cortavientos (nuevo) a otra, y una
        # talla repartida en dos lugares
        r = client.post("/api/documents/remision", headers=h, json={"number": "UBI 1", "lines": [
            {"name": jacket, "size": "M", "sku": "UBI-CH-M", "qty": 3, "location_id": "F-2-1"},
            {"name": jacket, "size": "M", "sku": "UBI-CH-M", "qty": 2, "location_id": "F-3-1"},
            {"name": wind, "size": "L", "sku": "UBI-CV-L", "qty": 4, "location_id": "F-3-1"},
            {"name": wind, "size": "XL", "sku": "UBI-CV-XL", "qty": 1, "location_id": "F-3-1"},
        ]})
        assert r.status_code == 201, r.text
        lines = r.json()["document"]["lines"]
        assert sorted((l["size"], l["qty"], l["location_id"]) for l in lines if l["name"] == jacket) == [("M", 2, "F-3-1"), ("M", 3, "F-2-1")]
        assert _stock(client, h, "UBI-CH-M") == {"F-1-1": 1, "F-2-1": 3, "F-3-1": 2}
        assert _stock(client, h, "UBI-CV-L") == {"F-3-1": 4}
        assert client.get("/api/products/UBI-CV-XL", headers=h).json()["location_id"] == "F-3-1"

        # sin elegir: donde ya esta la talla (como antes)
        r = client.post("/api/documents/remision", headers=h, json={"number": "UBI 2", "lines": [
            {"name": wind, "size": "L", "sku": "UBI-CV-L", "qty": 1}]})
        assert r.status_code == 201, r.text
        assert _stock(client, h, "UBI-CV-L") == {"F-3-1": 5}

        # una ubicacion que no existe: no entra nada
        r = client.post("/api/documents/remision", headers=h, json={"number": "UBI 3", "lines": [
            {"name": wind, "size": "L", "sku": "UBI-CV-L", "qty": 1},
            {"name": jacket, "size": "M", "sku": "UBI-CH-M", "qty": 1, "location_id": "NO-EXISTE"}]})
        assert r.status_code == 400 and "No entró nada" in r.json()["detail"]
        assert _stock(client, h, "UBI-CV-L") == {"F-3-1": 5}

        # a la reserva, la ubicacion no importa
        r = client.post("/api/documents/remision", headers=h, json={"number": "UBI 4", "destination": "reserva", "lines": [
            {"name": wind, "size": "L", "sku": "UBI-CV-L", "qty": 2, "location_id": "F-1-1"}]})
        assert r.status_code == 201, r.text
        assert _stock(client, h, "UBI-CV-L") == {"F-3-1": 5}


def test_documents_section_counts_search_pages_and_calendar():
    with TestClient(app) as client:
        h = _h(client)
        before = client.get("/api/documents/counts", headers=h).json()
        ref = "PANTALON BUSCA PRUEBA"
        r = client.post("/api/products", headers=h, json={"sku": "BUS-P-32", "name": ref, "size": "32", "location_id": "F-1-1", "qty": 0})
        assert r.status_code == 201, r.text
        for n, supplier in [("BUS 1", "Taller Ñandú"), ("BUS 2", "Otro taller"), ("BUS 3", "")]:
            r = client.post("/api/documents/remision", headers=h, json={"number": n, "supplier": supplier, "lines": [
                {"name": ref, "size": "32", "sku": "BUS-P-32", "qty": 2}]})
            assert r.status_code == 201, r.text
        after = client.get("/api/documents/counts", headers=h).json()
        assert after["remision"] == before["remision"] + 3 and after["factura"] == before["factura"]

        # buscar por numero, proveedor (con Ñ) o prenda
        def found(q):
            return [d["number"] for d in client.get(f"/api/documents?kind=remision&q={q}", headers=h).json()]
        assert found("bus 2") == ["BUS2"]
        assert found("ñandú") == ["BUS1"]
        assert found("busca prueba")[:3] == ["BUS3", "BUS2", "BUS1"]
        assert found("bus-p-32")[:3] == ["BUS3", "BUS2", "BUS1"]
        assert found("100%") == []

        # ver mas: la pagina siguiente empieza despues de la ultima que se vio
        first = client.get("/api/documents?kind=remision&q=busca&limit=2", headers=h).json()
        rest = client.get(f"/api/documents?kind=remision&q=busca&limit=2&before={first[-1]['id']}", headers=h).json()
        assert [d["number"] for d in first + rest][:3] == ["BUS3", "BUS2", "BUS1"]

        # el calendario: hoy (hora de Colombia) tiene lo que entro con
        # remision y lo que salio con factura
        today = datetime.now(BOGOTA).date()

        def cal_today():
            cal = client.get(f"/api/documents/calendar?month={today:%Y-%m}", headers=h).json()
            return next(d for d in cal if d["day"] == today.isoformat())
        day = cal_today()
        assert day["remisiones"] >= 3 and day["units_in"] >= 6
        r = client.post("/api/documents/factura", headers=h, json={"number": "BUS F1", "lines": [{"sku": "BUS-P-32", "qty": 4}]})
        assert r.status_code == 201, r.text
        now = cal_today()
        assert (now["facturas"], now["units_out"]) == (day["facturas"] + 1, day["units_out"] + 4)
        assert (now["remisiones"], now["units_in"]) == (day["remisiones"], day["units_in"])

        # tocar el dia: sus remisiones y sus facturas
        listed = client.get(f"/api/documents?kind=remision&day={today.isoformat()}&limit=200", headers=h).json()
        assert {"BUS1", "BUS2", "BUS3"} <= {d["number"] for d in listed}
        assert len(listed) == now["remisiones"]
        sold = client.get(f"/api/documents?kind=factura&day={today.isoformat()}&limit=200", headers=h).json()
        assert "BUSF1" in {d["number"] for d in sold} and len(sold) == now["facturas"]
        assert client.get("/api/documents?kind=remision&day=2001-01-01", headers=h).json() == []
        assert client.get("/api/documents/calendar?month=2026-13", headers=h).status_code == 422
        assert client.get("/api/documents?day=2026-02-30", headers=h).status_code == 422
