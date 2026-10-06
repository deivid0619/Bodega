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


def test_removing_a_column_does_not_shift_the_other_baskets():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        wall = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()  # 4 x 6
        code, sku = wall["code"], f"COL-{tag}"
        r = client.post("/api/products", headers=h, json={"sku": sku, "name": "PRUEBA COLUMNA", "size": "",
                                                           "location_id": f"{code}-2-2", "qty": 3})
        assert r.status_code == 201, r.text
        parcel = client.post("/api/parcels", headers=h, json={"owner": "Prueba", "location_id": f"{code}-3-2"}).json()

        # quitar una columna: lo de la 2-2 sigue en la 2-2 (antes pasaba a la 2-1... o a otra fila)
        for cols in (3, 2, 5):
            r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"params": {"cols": cols}})
            assert r.status_code == 200, r.text
            assert _stock(client, h, sku) == {f"{code}-2-2": 3}
            assert _parcel_loc(client, h, parcel["id"]) == f"{code}-3-2"

        # quitar la columna donde hay prendas: no deja, y dice cual canasta
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"params": {"cols": 1}})
        assert r.status_code == 400 and f"{code}-2-2" in r.json()["detail"]

        # cambiar el codigo: misma fila y columna, otro nombre
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"code": f"Q{tag[:3]}"})
        assert r.status_code == 200, r.text
        assert _stock(client, h, sku) == {f"Q{tag[:3]}-2-2": 3}

        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
        assert client.delete(f"/api/parcels/{parcel['id']}", headers=h).status_code == 204
        assert client.delete(f"/api/layout/elements/{wall['id']}", headers=h).status_code == 204


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
        # subida 1,4 m (encima de otro mueble): se queda a esa altura al cambiar de tipo
        assert client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"y0": 1.4}).status_code == 200

        # canastas -> cajas: todo queda en las cajas, con la misma letra
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"type": "boxes"})
        assert r.status_code == 200, r.text
        boxes = r.json()
        assert boxes["type"] == "boxes" and boxes["code"] == code and boxes["name"] == f"Cajas {code}"
        # del mismo tamano: 4 x 6 canastas -> 24 cajas de a 6 una encima de otra
        assert boxes["params"] == {"count": 24, "levels": 6} and boxes["y0"] == 1.4
        assert [l["id"] for l in boxes["locations"]] == [code]
        assert _stock(client, h, a) == {code: 2} and _stock(client, h, b) == {code: 3}
        assert client.get(f"/api/products/{b}", headers=h).json()["location_id"] == code
        assert _parcel_loc(client, h, parcel["id"]) == code

        # cajas -> canastas: lo de las cajas pasa a la primera canasta
        r = client.patch(f"/api/layout/elements/{wall['id']}", headers=h, json={"type": "bins"})
        assert r.status_code == 200, r.text
        bins = r.json()
        assert bins["type"] == "bins" and bins["code"] == code and bins["locations"][0]["id"] == f"{code}-1-1"
        assert bins["params"] == {"cols": 4, "rows": 6} and bins["y0"] == 1.4
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
