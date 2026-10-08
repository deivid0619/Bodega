"""Existencias por ubicacion: un mismo codigo en varias ubicaciones,
salidas repartidas, traslados, deshacer, migracion de datos viejos y
renombrar muebles sin perder prendas."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app import models
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.core.migrations import backfill_stock


def _login(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    p = client.get(f"/api/products/{sku}", headers=h).json()
    return p["qty"], {s["location_id"]: s["qty"] for s in p["stock"]}


def test_multi_location_flow():
    with TestClient(app) as client:
        h = _login(client)
        r = client.post("/api/products", headers=h, json={
            "sku": "ML-JACKET-S", "name": "Chaqueta prueba", "size": "S", "location_id": "P-A1", "qty": 3, "min_qty": 0})
        assert r.status_code == 201, r.text
        assert _stock(client, h, "ML-JACKET-S") == (3, {"P-A1": 3})

        # entrada a otra ubicacion: el codigo queda en dos lugares
        r = client.post("/api/movements", headers=h, json={"sku": "ML-JACKET-S", "type": "in", "qty": 2, "location_id": "C-1-2"})
        assert r.status_code == 200, r.text
        assert _stock(client, h, "ML-JACKET-S") == (5, {"P-A1": 3, "C-1-2": 2})
        assert [s["location_id"] for s in r.json()["product"]["stock"]] == ["P-A1", "C-1-2"]  # la principal primero

        # salida sin elegir: primero la principal, luego el resto (dos filas de historial)
        r = client.post("/api/movements", headers=h, json={"sku": "ML-JACKET-S", "type": "out", "qty": 4})
        assert r.status_code == 200, r.text
        parts = [(m["location_id"], m["qty"]) for m in r.json()["movements"]]
        assert parts == [("P-A1", 3), ("C-1-2", 1)]
        assert _stock(client, h, "ML-JACKET-S") == (1, {"C-1-2": 1})

        # salida de una ubicacion sin suficiente: se rechaza sin tocar nada
        r = client.post("/api/movements", headers=h, json={"sku": "ML-JACKET-S", "type": "out", "qty": 1, "location_id": "P-A1"})
        assert r.status_code == 400
        assert _stock(client, h, "ML-JACKET-S") == (1, {"C-1-2": 1})

        # conteo en una ubicacion fija lo que hay ahi
        r = client.post("/api/movements", headers=h, json={"sku": "ML-JACKET-S", "type": "set", "qty": 6, "location_id": "P-A1"})
        assert r.status_code == 200, r.text
        assert _stock(client, h, "ML-JACKET-S") == (7, {"P-A1": 6, "C-1-2": 1})

        # deshacer el conteo devuelve lo de esa ubicacion
        mid = r.json()["movement"]["id"]
        assert client.post(f"/api/movements/{mid}/undo", headers=h).status_code == 200
        assert _stock(client, h, "ML-JACKET-S") == (1, {"C-1-2": 1})

        # traslado: el total no cambia; si se lleva todo lo de la principal, la principal cambia
        client.post("/api/movements", headers=h, json={"sku": "ML-JACKET-S", "type": "in", "qty": 4, "location_id": "P-A1"})
        r = client.post("/api/products/ML-JACKET-S/move", headers=h, json={"from_location": "P-A1", "to_location": "P-B1", "qty": 4})
        assert r.status_code == 200, r.text
        assert r.json()["product"]["location_id"] == "P-B1"
        assert _stock(client, h, "ML-JACKET-S") == (5, {"P-B1": 4, "C-1-2": 1})
        mv = r.json()["movement"]
        assert (mv["type"], mv["location_id"], mv["to_location_id"]) == ("move", "P-A1", "P-B1")
        assert client.post(f"/api/movements/{mv['id']}/undo", headers=h).status_code == 200
        assert _stock(client, h, "ML-JACKET-S") == (5, {"P-A1": 4, "C-1-2": 1})

        r = client.post("/api/products/ML-JACKET-S/move", headers=h, json={"from_location": "C-1-2", "to_location": "P-A1", "qty": 9})
        assert r.status_code == 400

        # la lista trae las existencias por ubicacion
        listed = next(p for p in client.get("/api/products", headers=h).json() if p["sku"] == "ML-JACKET-S")
        assert {s["location_id"]: s["qty"] for s in listed["stock"]} == {"P-A1": 4, "C-1-2": 1}

        # cambiar el codigo de un mueble mueve las existencias con el
        layout = client.get("/api/layout", headers=h).json()
        rack_a = next(e for e in layout["elements"] if e["code"] == "A")
        r = client.patch(f"/api/layout/elements/{rack_a['id']}", headers=h, json={"code": "AZ"})
        assert r.status_code == 200, r.text
        assert _stock(client, h, "ML-JACKET-S") == (5, {"P-AZ1": 4, "C-1-2": 1})
        client.patch(f"/api/layout/elements/{rack_a['id']}", headers=h, json={"code": "A"})
        assert _stock(client, h, "ML-JACKET-S") == (5, {"P-A1": 4, "C-1-2": 1})

        # borrar un mueble con prendas en una ubicacion que no es la principal se bloquea
        bins_c = next(e for e in layout["elements"] if e["code"] == "C")
        r = client.delete(f"/api/layout/elements/{bins_c['id']}", headers=h)
        assert r.status_code == 400

        # recepcion desde la reserva a una ubicacion elegida, aunque el codigo ya tenga otra
        res = client.post("/api/reserve", headers=h, json={"name": "Chaqueta prueba", "size": "S", "qty": 5, "sku": "ML-JACKET-S"}).json()
        r = client.post(f"/api/reserve/{res['id']}/transfer", headers=h, json={"qty": 2, "location_id": "C-1-3"})
        assert r.status_code == 200, r.text
        assert _stock(client, h, "ML-JACKET-S") == (7, {"P-A1": 4, "C-1-2": 1, "C-1-3": 2})


def test_backfill_moves_old_single_location_data():
    with TestClient(app):
        db = SessionLocal()
        try:
            # como quedaban los datos antes: cantidad en el codigo, sin filas por ubicacion
            db.add(models.Product(sku="ML-OLD-1", name="Vieja", size="M", location_id="C-2-1", qty=4, min_qty=0))
            db.commit()
            backfill_stock(db)
            rows = db.query(models.Stock).filter(models.Stock.sku == "ML-OLD-1").all()
            assert [(r.location_id, r.qty) for r in rows] == [("C-2-1", 4)]
            backfill_stock(db)  # idempotente
            assert db.query(models.Stock).filter(models.Stock.sku == "ML-OLD-1").count() == 1
        finally:
            db.close()
