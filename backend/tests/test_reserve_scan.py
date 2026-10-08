"""Escanear para la reserva: el codigo se identifica solo (de la bodega o de
la tienda) y se suma a lo que ya habia guardado de ese codigo."""
import uuid

from fastapi.testclient import TestClient

from app.modules.catalogo import service as catalog
from app.core.config import settings
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _cleanup(client, h, ids):
    for i in ids:
        client.delete(f"/api/reserve/{i}", headers=h)


def test_scanning_a_code_from_the_bodega_adds_to_the_reserve():
    with TestClient(app) as client:
        h = _h(client)
        sku = f"RES-{uuid.uuid4().hex[:6].upper()}"
        assert client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA RESERVA PRUEBA", "size": "L",
                                                              "location_id": "C-1-1", "qty": 1}).status_code == 201

        who = client.get(f"/api/reserve/identify/{sku.lower()}", headers=h).json()
        assert who["name"] == "CHAQUETA RESERVA PRUEBA" and who["size"] == "L" and who["source"] == "bodega"
        assert who["in_reserve"] == 0

        r = client.post("/api/reserve/scan", headers=h, json={"sku": sku, "qty": 3}).json()
        assert r["created"] and r["item"]["qty"] == 3 and r["item"]["sku"] == sku
        r = client.post("/api/reserve/scan", headers=h, json={"sku": sku, "qty": 2}).json()
        assert not r["created"] and r["item"]["qty"] == 5
        assert client.get(f"/api/reserve/identify/{sku}", headers=h).json()["in_reserve"] == 5
        # la bodega no cambia: la reserva es aparte
        assert client.get(f"/api/products/{sku}", headers=h).json()["qty"] == 1

        _cleanup(client, h, [r["item"]["id"]])
        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204


def test_a_code_only_in_the_store_and_a_manual_item_without_code(monkeypatch):
    with TestClient(app) as client:
        h = _h(client)
        sku = f"TIENDA{uuid.uuid4().hex[:6].upper()}"
        name = f"PANTALON TIENDA {sku[-6:]}"
        photo = "https://cdn.example.com/pantalon.jpg"
        store = {sku: {"sku": sku, "name": name, "size": "M", "price": 1, "image": photo}}
        monkeypatch.setattr(catalog, "lookup", lambda code, fetch=True: store.get(code))

        # lo que se guardo a mano sin codigo, con la misma referencia y talla
        manual = client.post("/api/reserve", headers=h, json={"name": name, "size": "M", "qty": 4}).json()
        r = client.post("/api/reserve/scan", headers=h, json={"sku": sku}).json()
        assert r["source"] == "tienda" and not r["created"]
        assert r["item"]["id"] == manual["id"] and r["item"]["qty"] == 5 and r["item"]["sku"] == sku
        # con la foto de la tienda, y al enviarla a la bodega llega con su foto
        assert r["item"]["image_url"] == photo
        t = client.post(f"/api/reserve/{manual['id']}/transfer", headers=h, json={"qty": 1, "location_id": "C-1-1"})
        assert t.status_code == 200, t.text
        assert t.json()["product"]["image_url"] == photo
        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204

        # solo en la reserva (escrito a mano con su codigo): se reconoce, no se repite
        only = client.post("/api/reserve", headers=h, json={"sku": f"SOLO{sku}", "name": "GUANTE SOLO RESERVA", "qty": 1}).json()
        r = client.post("/api/reserve/scan", headers=h, json={"sku": f"solo{sku}", "qty": 2}).json()
        assert r["source"] == "reserva" and r["item"]["id"] == only["id"] and r["item"]["qty"] == 3
        _cleanup(client, h, [only["id"]])

        # ni en la bodega ni en la tienda: hay que escribir la referencia
        r = client.post("/api/reserve/scan", headers=h, json={"sku": "NOEXISTE123"})
        assert r.status_code == 404 and "escribe la referencia" in r.json()["detail"]
        assert client.get("/api/reserve/identify/NOEXISTE123", headers=h).status_code == 404

        _cleanup(client, h, [manual["id"]])


def test_old_reserve_items_get_their_photo(monkeypatch):
    with TestClient(app) as client:
        h = _h(client)
        sku = f"VIEJA{uuid.uuid4().hex[:6].upper()}"
        photo = "https://cdn.example.com/vieja.jpg"
        # guardada antes, sin foto
        item = client.post("/api/reserve", headers=h, json={"sku": sku, "name": "CHAQUETA VIEJA", "size": "S", "qty": 1}).json()
        assert item["image_url"] is None
        monkeypatch.setattr(catalog, "lookup", lambda code, fetch=True: {"image": photo} if code == sku else None)
        listed = next(i for i in client.get("/api/reserve", headers=h).json() if i["id"] == item["id"])
        assert listed["image_url"] == photo
        _cleanup(client, h, [item["id"]])


def test_what_runs_out_leaves_the_reserve():
    with TestClient(app) as client:
        h = _h(client)
        sku = f"ACABA{uuid.uuid4().hex[:6].upper()}"
        item = client.post("/api/reserve", headers=h, json={"sku": sku, "name": "CHAQUETA SE ACABA", "size": "M", "qty": 2}).json()

        # enviar todo a la bodega: llega con su movimiento y la linea sale sola de la reserva
        r = client.post(f"/api/reserve/{item['id']}/transfer", headers=h, json={"qty": 2, "location_id": "C-1-1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["reserve"]["qty"] == 0 and body["product"]["qty"] == 2
        assert body["movement"]["note"] == "Desde la reserva" and body["movement"]["qty"] == 2
        assert all(i["id"] != item["id"] for i in client.get("/api/reserve", headers=h).json())

        # lo que quedo en 0 a mano se quita de una vez
        a = client.post("/api/reserve", headers=h, json={"name": "GUANTE CERO A", "qty": 0}).json()
        b = client.post("/api/reserve", headers=h, json={"name": "GUANTE CERO B", "qty": 3}).json()
        client.patch(f"/api/reserve/{b['id']}", headers=h, json={"qty": 0})
        keep = client.post("/api/reserve", headers=h, json={"name": "GUANTE SE QUEDA", "qty": 1}).json()
        assert client.post("/api/reserve/clean", headers=h).json()["removed"] >= 2
        ids = {i["id"] for i in client.get("/api/reserve", headers=h).json()}
        assert a["id"] not in ids and b["id"] not in ids and keep["id"] in ids

        _cleanup(client, h, [keep["id"]])
        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
