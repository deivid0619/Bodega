"""Traer de la reserva: lo agotado o en su minimo que tiene prendas guardadas
se sugiere para llevar, y eso no se pide al proveedor."""
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


def test_restock_suggests_what_the_reserve_can_cover():
    with TestClient(app) as client:
        h = _h(client)
        ref = "RESTOCK PRUEBA"
        for sku, size, qty, min_qty in [("RST-S", "S", 1, 2), ("RST-M", "M", 0, 0), ("RST-L", "L", 5, 2)]:
            r = client.post("/api/products", headers=h, json={
                "sku": sku, "name": ref, "size": size, "location_id": "F-4-1", "qty": qty, "min_qty": min_qty})
            assert r.status_code == 201, r.text
        for body in [{"sku": "RST-S", "name": ref, "size": "S", "qty": 10},
                     {"name": ref, "size": "M", "qty": 1},     # guardada sin codigo
                     {"name": ref, "size": "L", "qty": 4}]:
            assert client.post("/api/reserve", headers=h, json=body).status_code == 201

        tasks = {t["product"]["sku"]: t for t in client.get("/api/reserve/restock", headers=h).json()
                 if t["product"]["name"] == ref}
        # S: hay 1 de minimo 2 -> llevar hasta el doble del minimo (3); M agotada sin minimo -> la que hay (1)
        assert {k: v["suggest"] for k, v in tasks.items()} == {"RST-S": 3, "RST-M": 1}
        assert tasks["RST-M"]["reserve"]["sku"] is None

        # lo que cubre la reserva no se pide al proveedor
        need = next(n for n in client.get("/api/reports/needs", headers=h).json() if n["product"]["sku"] == "RST-S")
        assert (need["order_qty"], need["in_reserve"]) == (0, 10)

        # traer la M: la prenda sin codigo queda con el codigo de la bodega y sale de las tareas
        t = tasks["RST-M"]
        r = client.post(f"/api/reserve/{t['reserve']['id']}/transfer", headers=h, json={
            "qty": 1, "location_id": t["product"]["location_id"], "sku": "RST-M"})
        assert r.status_code == 200, r.text
        assert r.json()["reserve"]["sku"] == "RST-M" and r.json()["product"]["qty"] == 1
        left = [x["product"]["sku"] for x in client.get("/api/reserve/restock", headers=h).json()]
        assert "RST-M" not in left and "RST-S" in left


def test_count_fixes_only_that_location():
    with TestClient(app) as client:
        h = _h(client)
        for sku, loc, qty in [("CNT-A", "F-5-1", 5), ("CNT-B", "F-5-1", 2), ("CNT-C", "F-6-1", 3)]:
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": "CONTEO PRUEBA", "size": sku[-1], "location_id": loc, "qty": qty})
            assert r.status_code == 201, r.text

        # A: faltan 2; B: cuadra; C: estaba en otra ubicacion y aparecio 1 aqui
        r = client.post("/api/documents/conteo", headers=h, json={"location_id": "F-5-1", "lines": [
            {"sku": "CNT-A", "qty": 3}, {"sku": "cnt-b", "qty": 2}, {"sku": "CNT-C", "qty": 1}]})
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert doc["kind"] == "conteo" and doc["number"].startswith("F-5-1@") and doc["units"] == 3
        assert [(l["sku"], l["before"], l["counted"]) for l in doc["lines"]] == [("CNT-A", 5, 3), ("CNT-B", 2, 2), ("CNT-C", 0, 1)]
        c = client.get("/api/products/CNT-C", headers=h).json()
        assert c["qty"] == 4 and {s["location_id"]: s["qty"] for s in c["stock"]} == {"F-6-1": 3, "F-5-1": 1}
        assert client.get("/api/products/CNT-A", headers=h).json()["qty"] == 3
        moves = client.get("/api/movements?limit=2", headers=h).json()
        assert [(m["sku"], m["note"]) for m in moves] == [("CNT-C", "Conteo F-5-1"), ("CNT-A", "Conteo F-5-1")]
        listed = client.get("/api/documents?kind=conteo&prefix=F-5-1@", headers=h).json()
        assert len(listed) == 1

        # un codigo que no existe: no se guarda nada del conteo
        r = client.post("/api/documents/conteo", headers=h, json={"location_id": "F-5-1", "lines": [
            {"sku": "CNT-A", "qty": 9}, {"sku": "NO-EXISTE-X", "qty": 1}]})
        assert r.status_code == 400 and "No se guardó" in r.json()["detail"]
        assert client.get("/api/products/CNT-A", headers=h).json()["qty"] == 3
