"""Prueba de extremo a extremo: registro admin sembrado, login, distribución,
registrar prenda nueva, entrada, salida, error de sobre-venta, deshacer,
editar la bodega y proteger el inventario al reducir un mueble."""
import os

os.environ["DATABASE_URL"] = "sqlite:///./test_bodega.db"
os.environ["ADMIN_EMAIL"] = "admin@test.com"
os.environ["ADMIN_PASSWORD"] = "admin1234"

import pathlib

if pathlib.Path("test_bodega.db").exists():
    pathlib.Path("test_bodega.db").unlink()

from fastapi.testclient import TestClient

from app.main import app


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_full_flow():
    with TestClient(app) as client:
        _run_flow(client)


def _run_flow(client):
    r = client.post("/api/auth/login", json={"email": "admin@test.com", "password": "admin1234"})
    assert r.status_code == 200, r.text
    admin_token = r.json()["access_token"]
    assert r.json()["user"]["role"] == "admin"

    r = client.post("/api/auth/register", json={
        "email": "op@test.com", "password": "operador1", "name": "Operador",
        "invite_code": "pigmalion",
    })
    assert r.status_code == 200, r.text
    op_token = r.json()["access_token"]
    assert r.json()["user"]["role"] == "operator"

    r = client.get("/api/layout", headers=auth_headers(op_token))
    assert r.status_code == 200
    layout = r.json()
    assert layout["room"]["width"] == 8.4
    bins = [e for e in layout["elements"] if e["code"] == "C"][0]
    assert len(bins["locations"]) == 9 * 8

    seeded = client.get("/api/products/P-WPM210200L", headers=auth_headers(op_token))
    assert seeded.status_code == 200
    assert seeded.json()["qty"] == 0

    r = client.post("/api/products", headers=auth_headers(op_token), json={
        "sku": "TEST-CHAQ-L", "name": "CHAQUETA DE PRUEBA", "size": "L",
        "location_id": "C-1-1", "qty": 5, "min_qty": 3,
    })
    assert r.status_code == 201, r.text
    assert r.json()["product"]["qty"] == 5

    r = client.post("/api/movements", headers=auth_headers(op_token), json={"sku": "TEST-CHAQ-L", "type": "in", "qty": 3})
    assert r.status_code == 200
    assert r.json()["product"]["qty"] == 8

    r = client.post("/api/movements", headers=auth_headers(op_token), json={"sku": "TEST-CHAQ-L", "type": "out", "qty": 100})
    assert r.status_code == 400
    assert "Solo hay" in r.json()["detail"]

    r = client.post("/api/movements", headers=auth_headers(op_token), json={"sku": "TEST-CHAQ-L", "type": "out", "qty": 6})
    assert r.status_code == 200
    assert r.json()["product"]["qty"] == 2
    last_id = r.json()["movement"]["id"]

    r = client.post(f"/api/movements/{last_id}/undo", headers=auth_headers(op_token))
    assert r.status_code == 200
    assert r.json()["qty"] == 8

    needs = client.get("/api/reports/needs", headers=auth_headers(op_token)).json()
    assert any(n["product"]["sku"] == "TEST-CHAQ-L" for n in needs) is False  # 8 > min 3, no aparece

    r = client.post("/api/movements", headers=auth_headers(op_token), json={"sku": "TEST-CHAQ-L", "type": "set", "qty": 2})
    assert r.json()["product"]["qty"] == 2
    needs = client.get("/api/reports/needs", headers=auth_headers(op_token)).json()
    assert any(n["product"]["sku"] == "TEST-CHAQ-L" for n in needs) is True

    r = client.patch("/api/layout/elements/e1", headers=auth_headers(op_token), json={"code": "Z"})
    assert r.status_code == 403

    r = client.patch("/api/products/TEST-CHAQ-L", headers=auth_headers(op_token), json={"location_id": "C-8-9"})
    assert r.status_code == 200

    r = client.patch("/api/layout/elements/e1", headers=auth_headers(admin_token),
                      json={"params": {"cols": 1, "rows": 1}})
    assert r.status_code == 400
    assert "sin ubicación" in r.json()["detail"]

    r = client.patch("/api/products/TEST-CHAQ-L", headers=auth_headers(op_token), json={"location_id": "C-1-1"})
    assert r.status_code == 200
    r = client.patch("/api/layout/elements/e1", headers=auth_headers(admin_token),
                      json={"params": {"cols": 1, "rows": 1}})
    assert r.status_code == 200
    r = client.patch("/api/layout/elements/e1", headers=auth_headers(admin_token),
                      json={"params": {"cols": 9, "rows": 8}})
    assert r.status_code == 200

    r = client.post("/api/layout/elements", headers=auth_headers(admin_token), json={"type": "shelf", "x": 0, "z": 0, "rot": 0})
    assert r.status_code == 200
    new_el = r.json()
    assert new_el["code"] not in (None, "")

    r = client.delete(f"/api/layout/elements/{new_el['id']}", headers=auth_headers(admin_token))
    assert r.status_code == 204

    r = client.post("/api/reports/demo", headers=auth_headers(admin_token))
    assert r.status_code == 200 and r.json()["demo"] is True
    inv = client.get("/api/products", headers=auth_headers(op_token)).json()
    assert any(p["demo"] for p in inv)

    r = client.post("/api/reports/demo", headers=auth_headers(admin_token))
    assert r.json()["demo"] is False

    csv = client.get("/api/reports/inventory.csv", headers=auth_headers(op_token))
    assert csv.status_code == 200 and "TEST-CHAQ-L" in csv.text

    r = client.post("/api/layout/reset", headers=auth_headers(op_token))
    assert r.status_code == 403
    r = client.post("/api/layout/reset", headers=auth_headers(admin_token))
    assert r.status_code == 200, r.text
    assert len(r.json()["elements"]) == 10

    r = client.delete("/api/products", headers=auth_headers(op_token))
    assert r.status_code == 403
    r = client.delete("/api/products", headers=auth_headers(admin_token))
    assert r.status_code == 204
    r = client.get("/api/products", headers=auth_headers(op_token))
    assert r.json() == []
    r = client.get("/api/movements", headers=auth_headers(op_token))
    assert r.json() == []
    r = client.get("/api/layout", headers=auth_headers(op_token))
    assert len(r.json()["elements"]) == 10  # la distribución no se borró

    print("OK: flujo completo probado end-to-end")
