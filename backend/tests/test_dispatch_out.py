"""Despachar: lo que se mando de la reserva a Despacho (de paso) sale del
inventario cuando se empaca, y no vuelve a salir en "llevar a la bodega"."""
import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_from_reserve_to_dispatch_and_out():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        items = []
        for size in ("32", "34"):
            items.append(client.post("/api/reserve", headers=h, json={"sku": f"PANT-{tag}-{size}", "name": "PANTALON DESPACHO",
                                                                   "size": size, "qty": 5}).json())
        # 2 de cada talla de la reserva a Despacho
        for it in items:
            r = client.post(f"/api/reserve/{it['id']}/transfer", headers=h, json={"qty": 2, "location_id": "DESPACHO"})
            assert r.status_code == 200, r.text
        # no vuelven a salir para "llevar a la bodega" (estan para despacharse)
        tasks = client.get("/api/reserve/restock", headers=h).json()
        assert not any(t["product"]["sku"].startswith(f"PANT-{tag}") for t in tasks)
        passing = {d["product"]["sku"]: d["qty"] for d in client.get("/api/reports/dispatch", headers=h).json()}
        assert passing[f"PANT-{tag}-32"] == 2 and passing[f"PANT-{tag}-34"] == 2

        # mas de lo que hay: no se despacha nada
        r = client.post("/api/reports/dispatch/out", headers=h, json={"lines": [
            {"sku": f"PANT-{tag}-32", "qty": 2}, {"sku": f"PANT-{tag}-34", "qty": 3}]})
        assert r.status_code == 400
        assert client.get(f"/api/products/PANT-{tag}-32", headers=h).json()["qty"] == 2

        r = client.post("/api/reports/dispatch/out", headers=h, json={"lines": [
            {"sku": f"PANT-{tag}-32", "qty": 2}, {"sku": f"PANT-{tag}-34", "qty": 2}], "note": "pedido Juan"})
        assert r.status_code == 200 and r.json()["units"] == 4
        for size in ("32", "34"):
            p = client.get(f"/api/products/PANT-{tag}-{size}", headers=h).json()
            assert p["qty"] == 0
        moves = client.get(f"/api/movements?sku=PANT-{tag}-32", headers=h).json()
        assert any(m["type"] == "out" and m["note"] == "Despacho: pedido Juan" for m in moves)
        # la reserva sigue con lo que quedo alla
        left = {i["sku"]: i["qty"] for i in client.get("/api/reserve", headers=h).json()}
        assert left[f"PANT-{tag}-32"] == 3

        # lo que se llevo de mas a Despacho vuelve a la reserva (y no cuenta como venta)
        client.post(f"/api/reserve/{items[0]['id']}/transfer", headers=h, json={"qty": 2, "location_id": "DESPACHO"})
        r = client.post("/api/reserve/return", headers=h, json={"sku": f"PANT-{tag}-32", "qty": 2})
        assert r.status_code == 200 and r.json()["qty"] == 3
        assert client.get(f"/api/products/PANT-{tag}-32", headers=h).json()["qty"] == 0
        top = client.get("/api/reports/top", headers=h).json()
        assert next(t for t in top if t["sku"] == f"PANT-{tag}-32")["qty_out"] == 2  # solo lo despachado
        r = client.post("/api/reserve/return", headers=h, json={"sku": f"PANT-{tag}-32", "qty": 1})
        assert r.status_code == 400  # en Despacho ya no queda

        # si despues se guarda en la bodega, esa pasa a ser su ubicacion
        r = client.post("/api/movements", headers=h, json={"sku": f"PANT-{tag}-34", "type": "in", "qty": 1, "location_id": "C-1-1"})
        assert r.json()["product"]["location_id"] == "C-1-1"

        for it in items:
            client.delete(f"/api/reserve/{it['id']}", headers=h)
        for size in ("32", "34"):
            client.delete(f"/api/products/PANT-{tag}-{size}", headers=h)


def test_dispatch_straight_from_the_reserve():
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:5].upper()
        it = client.post("/api/reserve", headers=h, json={"sku": f"DIR-{tag}", "name": "PANTALON DIRECTO", "size": "32", "qty": 10}).json()
        r = client.post(f"/api/reserve/{it['id']}/dispatch", headers=h, json={"qty": 2, "note": "pedido Ana"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reserve"]["qty"] == 8 and body["product"]["qty"] == 0
        assert body["movement"]["type"] == "out" and body["movement"]["note"] == "Despacho: pedido Ana"
        # no queda nada esperando en Despacho ni sale en "llevar a la bodega"
        assert not any(d["product"]["sku"] == f"DIR-{tag}" for d in client.get("/api/reports/dispatch", headers=h).json())
        assert not any(t["product"]["sku"] == f"DIR-{tag}" for t in client.get("/api/reserve/restock", headers=h).json())
        # cuenta como lo que sale; mas de lo que hay: no se descuenta nada
        assert next(t for t in client.get("/api/reports/top", headers=h).json() if t["sku"] == f"DIR-{tag}")["qty_out"] == 2
        assert client.post(f"/api/reserve/{it['id']}/dispatch", headers=h, json={"qty": 9}).status_code == 400
        # todo lo que queda: sale sola de la reserva
        assert client.post(f"/api/reserve/{it['id']}/dispatch", headers=h, json={"qty": 8}).json()["reserve"]["qty"] == 0
        assert all(i["id"] != it["id"] for i in client.get("/api/reserve", headers=h).json())
        client.delete(f"/api/products/DIR-{tag}", headers=h)
