"""Outlet: prendas que estan en la bodega pero no se entregan normalmente.
Se ubican y se ven, pero no cuentan: ni en lo que hay que pedir, ni en el
valor, ni en lo que no se mueve, y una salida automatica no las toca."""
import uuid

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    return {s["location_id"]: s["qty"] for s in client.get(f"/api/products/{sku}", headers=h).json()["stock"]}


def test_outlet_garments_are_located_but_not_counted():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        sku = f"OUT-{tag}"
        el = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()
        r = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"params": {"outlet": True}})
        assert r.status_code == 200, r.text
        outlet = r.json()
        loc = outlet["locations"][0]
        assert outlet["name"].endswith("(outlet)") and loc["outlet"] is True and loc["name"].endswith("(outlet)")
        assert outlet["params"]["cols"] == 4  # marcarlo no cambia su tamano

        # 5 en la bodega y 3 en el outlet, con minimo 5
        r = client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA OUTLET PRUEBA", "size": "M",
                                                           "location_id": "C-1-1", "qty": 5, "min_qty": 5})
        assert r.status_code == 201, r.text
        assert client.post("/api/movements", headers=h, json={"sku": sku, "type": "in", "qty": 3,
                                                               "location_id": loc["id"]}).status_code == 200

        # lo que hay que pedir se calcula sin el outlet: hay 5 (no 8), pedir 5
        need = next(n for n in client.get("/api/reports/needs", headers=h).json() if n["product"]["sku"] == sku)
        assert need["order_qty"] == 5

        # una salida sin ubicacion no saca del outlet
        r = client.post("/api/movements", headers=h, json={"sku": sku, "type": "out", "qty": 6})
        assert r.status_code == 400 and "outlet" in r.json()["detail"]
        assert client.post("/api/movements", headers=h, json={"sku": sku, "type": "out", "qty": 5}).status_code == 200
        assert _stock(client, h, sku) == {loc["id"]: 3}
        r = client.post("/api/movements", headers=h, json={"sku": sku, "type": "out", "qty": 1})
        assert r.status_code == 400 and "outlet" in r.json()["detail"]
        # eligiendo el outlet, si
        r = client.post("/api/movements", headers=h, json={"sku": sku, "type": "out", "qty": 1, "location_id": loc["id"]})
        assert r.status_code == 200, r.text

        # quitarle la marca: vuelve a contar, en lo que hay que pedir y en el valor
        units_with_outlet = client.get("/api/reports/value", headers=h).json()["units_total"]
        r = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"params": {"outlet": False}})
        assert r.status_code == 200 and not r.json()["locations"][0].get("outlet")
        need = next(n for n in client.get("/api/reports/needs", headers=h).json() if n["product"]["sku"] == sku)
        assert need["order_qty"] == 8  # hay 2 que ahora si cuentan: pedir hasta 10
        assert client.get("/api/reports/value", headers=h).json()["units_total"] - units_with_outlet == 2

        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
        assert client.delete(f"/api/layout/elements/{el['id']}", headers=h).status_code == 204


def test_single_locations_can_be_outlet():
    with TestClient(app) as client:
        h = _h(client)
        sku = f"OUT1-{uuid.uuid4().hex[:5].upper()}"
        el = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()
        code = el["code"]

        def mark(loc_id, on=True):
            r = client.put(f"/api/layout/locations/{loc_id}/outlet", headers=h, json={"outlet": on})
            assert r.status_code == 200, r.text
            return r.json()

        def locs(e):
            return {l["id"]: l for l in e["locations"]}

        # una sola canasta: solo esa es outlet, el mueble no
        e = mark(f"{code}-1-2")
        L = locs(e)
        assert L[f"{code}-1-2"]["outlet"] and L[f"{code}-1-2"]["name"].endswith("(outlet)")
        assert not L[f"{code}-1-1"]["outlet"] and not e["name"].endswith("(outlet)")
        assert e["params"]["outlet_slots"] == ["1-2"] and "outlet" not in e["params"]

        # 4 en una canasta normal y 2 en la del outlet: una salida sin ubicacion solo ve 4
        r = client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA OUTLET UNA", "size": "M",
                                                           "location_id": f"{code}-1-1", "qty": 4})
        assert r.status_code == 201, r.text
        assert client.post("/api/movements", headers=h, json={"sku": sku, "type": "in", "qty": 2,
                                                               "location_id": f"{code}-1-2"}).status_code == 200
        r = client.post("/api/movements", headers=h, json={"sku": sku, "type": "out", "qty": 5})
        assert r.status_code == 400 and "outlet" in r.json()["detail"]

        # quitar una columna no corre la marca; la de la columna que se quita se va
        mark(f"{code}-1-4")
        e = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"params": {"cols": 3}}).json()
        assert e["params"]["outlet_slots"] == ["1-2"]
        assert [l["id"] for l in e["locations"] if l.get("outlet")] == [f"{code}-1-2"]

        # todo el mueble desde el editor y luego desmarcar solo una
        e = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"params": {"outlet": True}}).json()
        assert e["params"].get("outlet") is True and "outlet_slots" not in e["params"]
        e = mark(f"{code}-1-1", False)
        assert "outlet" not in e["params"] and len(e["params"]["outlet_slots"]) == len(e["locations"]) - 1
        assert not locs(e)[f"{code}-1-1"]["outlet"] and not e["name"].endswith("(outlet)")
        # volver a marcarla: quedan todas, es todo el mueble otra vez
        e = mark(f"{code}-1-1")
        assert e["params"].get("outlet") is True and e["name"].endswith("(outlet)")

        assert client.put("/api/layout/locations/NO-EXISTE/outlet", headers=h, json={"outlet": True}).status_code == 404

        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
        assert client.delete(f"/api/layout/elements/{el['id']}", headers=h).status_code == 204


def test_outlet_survives_changing_bins_to_boxes():
    with TestClient(app) as client:
        h = _h(client)
        el = client.post("/api/layout/elements", headers=h, json={"type": "bins", "x": 0, "z": 0}).json()
        client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"params": {"outlet": True}})
        r = client.patch(f"/api/layout/elements/{el['id']}", headers=h, json={"type": "boxes"})
        assert r.status_code == 200, r.text
        assert r.json()["params"].get("outlet") is True and r.json()["locations"][0]["outlet"] is True
        assert client.delete(f"/api/layout/elements/{el['id']}", headers=h).status_code == 204
