"""Solo registro (remision y factura), el pedido que se descuenta al
empacarlo y espera su factura, y el aviso de lo que ya entro escaneando."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _stock(client, h, sku):
    return {s["location_id"]: s["qty"] for s in client.get(f"/api/products/{sku}", headers=h).json()["stock"]}


def _new(client, h, sku, loc, qty, name="CHAQUETA PEDIDO PRUEBA", size="M"):
    r = client.post("/api/products", headers=h, json={"sku": sku, "name": name, "size": size, "location_id": loc, "qty": qty})
    assert r.status_code == 201, r.text


def test_solo_registro_no_toca_el_inventario():
    with TestClient(app) as client:
        h = _h(client)
        _new(client, h, "REG-M", "F-1-1", 4)
        moves = len(client.get("/api/movements?limit=200", headers=h).json())

        # remision: se guarda el papel y lo que dice, sin sumar
        r = client.post("/api/documents/remision", headers=h, json={"number": "REG 1", "destination": "registro", "lines": [
            {"name": "CHAQUETA PEDIDO PRUEBA", "size": "M", "sku": "REG-M", "qty": 3},
            {"name": "REFERENCIA QUE NO EXISTE", "size": "L", "sku": "REG-NUEVA", "qty": 2}]})
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert doc["mode"] == "registro" and doc["units"] == 5
        assert {l["dest"] for l in doc["lines"]} == {"registro"}
        assert _stock(client, h, "REG-M") == {"F-1-1": 4}
        assert client.get("/api/products/REG-NUEVA", headers=h).status_code == 404

        # factura: igual, y el mismo numero no se registra dos veces
        r = client.post("/api/documents/factura", headers=h, json={"number": "REG F1", "record_only": True,
                                                                     "lines": [{"sku": "REG-M", "qty": 2}, {"sku": "reg-m", "qty": 1}]})
        assert r.status_code == 201, r.text
        assert r.json()["document"]["mode"] == "registro" and r.json()["document"]["lines"] == [{"sku": "REG-M", "qty": 3, "location_id": None}]
        assert _stock(client, h, "REG-M") == {"F-1-1": 4}
        assert len(client.get("/api/movements?limit=200", headers=h).json()) == moves
        r = client.post("/api/documents/factura", headers=h, json={"number": "REGF1", "lines": [{"sku": "REG-M", "qty": 1}]})
        assert r.status_code == 409


def test_pedido_espera_su_factura():
    with TestClient(app) as client:
        h = _h(client)
        _new(client, h, "PED-A", "F-1-1", 5)
        _new(client, h, "PED-B", "F-2-1", 3, size="L")
        _new(client, h, "PED-C", "F-3-1", 2, size="XL")
        before = client.get("/api/documents/counts", headers=h).json()

        # se empaca: sale ya del inventario y queda esperando la factura
        r = client.post("/api/documents/pedido", headers=h, json={"notes": " Cliente  Ana ", "lines": [
            {"sku": "PED-A", "qty": 2}, {"sku": "PED-B", "qty": 1, "location_id": "F-2-1"}]})
        assert r.status_code == 201, r.text
        ped = r.json()["document"]
        assert ped["status"] == "espera" and ped["number"].startswith("PED-") and ped["units"] == 3 and ped["notes"] == "Cliente Ana"
        assert sorted((l["sku"], l["qty"], l["location_id"]) for l in ped["lines"]) == [("PED-A", 2, "F-1-1"), ("PED-B", 1, "F-2-1")]
        assert (_stock(client, h, "PED-A"), _stock(client, h, "PED-B")) == ({"F-1-1": 3}, {"F-2-1": 2})
        assert client.get("/api/documents/counts", headers=h).json()["espera"] == before["espera"] + 1
        waiting = client.get("/api/documents?kind=factura&status=espera", headers=h).json()
        assert ped["id"] in {d["id"] for d in waiting}
        notes = {m["note"] for m in client.get("/api/movements?limit=5", headers=h).json()}
        assert f"Pedido {ped['number']}" in notes

        # no se puede pedir mas de lo que hay: no sale nada
        r = client.post("/api/documents/pedido", headers=h, json={"lines": [{"sku": "PED-A", "qty": 1}, {"sku": "PED-C", "qty": 9}]})
        assert r.status_code == 400 and "No se descontó nada" in r.json()["detail"]
        assert _stock(client, h, "PED-A") == {"F-1-1": 3}

        # la factura trae una C que no estaba y no trae la B (vuelve a su lugar)
        r = client.post(f"/api/documents/{ped['id']}/factura", headers=h, json={
            "number": "fev 777", "deduct": [{"sku": "PED-C", "qty": 1}], "returns": [{"sku": "PED-B", "qty": 1}]})
        assert r.status_code == 200, r.text
        fac = r.json()["document"]
        assert (fac["id"], fac["number"], fac["status"], fac["units"]) == (ped["id"], "FEV777", None, 3)
        assert fac["closed_at"]
        assert sorted((l["sku"], l["qty"]) for l in fac["lines"]) == [("PED-A", 2), ("PED-C", 1)]
        assert (_stock(client, h, "PED-B"), _stock(client, h, "PED-C")) == ({"F-2-1": 3}, {"F-3-1": 1})
        # el historial del pedido quedo con el numero de la factura
        notes = [m["note"] for m in client.get("/api/movements?limit=8", headers=h).json()]
        assert not any(n and n.startswith("Pedido PED-") and ped["number"] in n for n in notes)
        assert notes.count("Factura FEV777") >= 2
        assert client.get("/api/documents?kind=factura&number=FEV777", headers=h).json()[0]["id"] == ped["id"]
        # ya no espera: no se anexa otra vez ni se deshace
        assert client.post(f"/api/documents/{ped['id']}/factura", headers=h, json={"number": "X1"}).status_code == 404
        assert client.delete(f"/api/documents/{ped['id']}", headers=h).status_code == 404

        # otro pedido: la factura no puede ser una que ya existe
        r = client.post("/api/documents/pedido", headers=h, json={"lines": [{"sku": "PED-A", "qty": 1}]})
        assert r.status_code == 201, r.text
        ped2 = r.json()["document"]
        assert client.post(f"/api/documents/{ped2['id']}/factura", headers=h, json={"number": "FEV777"}).status_code == 409
        # devolver todo no deja un pedido vacio
        r = client.post(f"/api/documents/{ped2['id']}/factura", headers=h, json={"number": "FEV778", "returns": [{"sku": "PED-A", "qty": 1}]})
        assert r.status_code == 400
        assert _stock(client, h, "PED-A") == {"F-1-1": 2}

        # deshacer el pedido: todo vuelve y el pedido se borra
        assert client.delete(f"/api/documents/{ped2['id']}", headers=h).status_code == 204
        assert _stock(client, h, "PED-A") == {"F-1-1": 3}
        notes = [m["note"] for m in client.get("/api/movements?limit=4", headers=h).json()]
        assert f"Pedido deshecho {ped2['number']}" in notes and f"Pedido {ped2['number']}" not in notes
        assert client.get("/api/documents?kind=factura&status=espera", headers=h).json() == [
            d for d in client.get("/api/documents?kind=factura&status=espera", headers=h).json() if d["id"] != ped2["id"]]
        assert client.get("/api/documents/counts", headers=h).json()["espera"] == before["espera"]


def test_lo_que_ya_entro_escaneando():
    with TestClient(app) as client:
        h = _h(client)
        _new(client, h, "REC-M", "F-1-1", 0)
        # escaneando entraron 3 (sin remision)
        r = client.post("/api/movements", headers=h, json={"sku": "REC-M", "type": "in", "qty": 3})
        assert r.status_code in (200, 201), r.text
        # con una remision entraron 2: esas no cuentan como "sin remision"
        r = client.post("/api/documents/remision", headers=h, json={"number": "REC 1", "lines": [
            {"name": "CHAQUETA PEDIDO PRUEBA", "size": "M", "sku": "REC-M", "qty": 2}]})
        assert r.status_code == 201, r.text
        got = client.get("/api/documents/recent-entries?skus=REC-M,NO-EXISTE&days=3", headers=h).json()
        assert [(g["sku"], g["qty"]) for g in got] == [("REC-M", 3)]
        assert client.get("/api/documents/recent-entries?skus=NO-EXISTE", headers=h).json() == []
