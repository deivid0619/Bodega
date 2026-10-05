"""Editar la distribucion: un mueble de canastas puede volverse cajas y al
reves, y lo que tenia (prendas y lo anotado de paso) se va con el."""
import uuid

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    return {s["location_id"]: s["qty"] for s in client.get(f"/api/products/{sku}", headers=h).json()["stock"]}


def _parcel_loc(client, h, parcel_id):
    return next(p for p in client.get("/api/parcels", headers=h).json() if p["id"] == parcel_id)["location_id"]


def test_bins_become_boxes_and_back_keeping_what_they_hold():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        # un mueble de canastas propio, para no tocar los de las otras pruebas
        wall = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()
        code = wall["code"]
        a, b = f"TIPO-{tag}-A", f"TIPO-{tag}-B"
        for sku, loc, qty in ((a, f"{code}-1-1", 2), (b, f"{code}-2-3", 3)):
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": "PRUEBA TIPO", "size": "",
                                                               "location_id": loc, "qty": qty})
            assert r.status_code == 201, r.text
        parcel = client.post("/api/parcels", headers=h, json={"owner": "Prueba", "location_id": f"{code}-2-3"}).json()

        # canastas -> cajas: todo queda en las cajas, con la misma letra
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"type": "boxes"})
        assert r.status_code == 200, r.text
        boxes = r.json()
        assert boxes["type"] == "boxes" and boxes["code"] == code and boxes["name"] == f"Cajas {code}"
        assert [l["id"] for l in boxes["locations"]] == [code]
        assert _stock(client, h, a) == {code: 2} and _stock(client, h, b) == {code: 3}
        assert client.get(f"/api/products/{b}", headers=h).json()["location_id"] == code
        assert _parcel_loc(client, h, parcel["id"]) == code

        # cajas -> canastas: lo de las cajas pasa a la primera canasta
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"type": "bins"})
        assert r.status_code == 200, r.text
        bins = r.json()
        assert bins["type"] == "bins" and bins["code"] == code and bins["locations"][0]["id"] == f"{code}-1-1"
        assert _stock(client, h, a) == {f"{code}-1-1": 2} and _stock(client, h, b) == {f"{code}-1-1": 3}
        assert _parcel_loc(client, h, parcel["id"]) == f"{code}-1-1"

        # solo entre canastas y cajas
        rack = next(e for e in client.get("/api/layout", headers=h).json()["elements"] if e["type"] == "rack")
        r = client.patch(f"/api/layout/elements/{rack['id']}", headers=h, json={"type": "bins"})
        assert r.status_code == 400 and "canastas y cajas" in r.json()["detail"]
        assert client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"type": "rack"}).status_code == 422

        # unas cajas con su codigo automatico reciben una letra al volverse canastas (no CAJAS-1-1)
        cajas = client.post("/api/layout/elements", headers=h, json={"type": "boxes", "x": 1, "z": 1}).json()
        r = client.patch(f"/api/layout/elements/{cajas['id']}", headers=h, json={"type": "bins"})
        assert r.status_code == 200, r.text
        assert r.json()["code"].isalpha() and len(r.json()["code"]) == 1

        # si una ubicacion desaparece, lo anotado de paso pasa a Despacho
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"params": {"cols": 1, "rows": 1}})
        assert r.status_code == 200, r.text
        for sku in (a, b):
            assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
        assert client.delete(f"/api/layout/elements/{wall['id']}", headers=h).status_code == 204
        assert _parcel_loc(client, h, parcel["id"]) == "DESPACHO"
        assert client.delete(f"/api/parcels/{parcel['id']}", headers=h).status_code == 204
        assert client.delete(f"/api/layout/elements/{cajas['id']}", headers=h).status_code == 204
