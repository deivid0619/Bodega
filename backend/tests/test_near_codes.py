"""Codigos casi iguales a los de la tienda y referencias escritas distinto:
asi no queda una prenda sin nombre ni foto, ni la reserva contada aparte."""
import uuid

from fastapi.testclient import TestClient

from app import catalog
from app.config import settings
from app.main import app

STORE = {
    "P-PRM001800S": {"sku": "P-PRM001800S", "name": "GUANTES MOTO PROTECCIÓN VORTEX NEÓN", "size": "S", "price": 1, "image": "s.jpg"},
    "P-PRM001800M": {"sku": "P-PRM001800M", "name": "GUANTES MOTO PROTECCIÓN VORTEX NEÓN", "size": "M", "price": 1, "image": "m.jpg"},
    "P-PRM00180XL": {"sku": "P-PRM00180XL", "name": "GUANTES MOTO PROTECCIÓN VORTEX NEÓN", "size": "XL", "price": 1, "image": "xl.jpg"},
    "P-PRM00170XL": {"sku": "P-PRM00170XL", "name": "GUANTES MOTO PROTECCIÓN VORTEX GRIS", "size": "XL", "price": 1, "image": "gris.jpg"},
    "PGPRGP072VCMM": {"sku": "PGPRGP072VCMM", "name": "CHAQUETA MOTO GENESIS PRO VERANO CAMO GRIS", "size": "M", "price": 1, "image": "camo-m.jpg"},
    "PGPRGP072VCML": {"sku": "PGPRGP072VCML", "name": "CHAQUETA MOTO GENESIS PRO VERANO CAMO GRIS", "size": "L", "price": 1, "image": "camo-l.jpg"},
    "PGPRGP073VCMM": {"sku": "PGPRGP073VCMM", "name": "CHAQUETA OTRA REFERENCIA", "size": "M", "price": 1, "image": "otra.jpg"},
}


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_a_label_code_close_to_the_store_one(monkeypatch):
    monkeypatch.setattr(catalog, "items", lambda fetch=True: STORE)
    # la etiqueta de la XL trae un cero de mas: se encuentra la XL (no la gris, ni otra talla)
    assert [it["sku"] for it in catalog.near("P-PRM001800XL")] == ["P-PRM00180XL"]
    assert catalog.near("P-PRM001800L") == []  # la L no esta: no se confunde con la S o la M
    assert catalog.near("P-PRM001800M") == []  # igual no es "casi igual"
    # la etiqueta trae otras letras en el prefijo y una de menos, pero el mismo
    # numero de referencia (072) y la misma talla: la M de la tienda, no la L
    # ni la 073
    assert [it["sku"] for it in catalog.near("PGPRBI072CMM")] == ["PGPRGP072VCMM"]
    assert catalog.near("PGPRBI074CMM") == []  # otra referencia: no se parece
    assert catalog.near("PGPRXX072ABCDEM") == []  # mas de tres letras distintas
    with TestClient(app) as client:
        h = _h(client)
        r = client.get("/api/catalog/near/p-prm001800xl", headers=h)
        assert r.status_code == 200 and [x["size"] for x in r.json()] == ["XL"]
        # guardada a mano con el codigo de la etiqueta: toma la foto de esa XL sola
        item = client.post("/api/reserve", headers=h, json={"sku": "P-PRM001800XL", "name": "GUANTES VORTEX",
                                                             "size": "XL", "qty": 2}).json()
        listed = next(i for i in client.get("/api/reserve", headers=h).json() if i["id"] == item["id"])
        assert listed["image_url"] == "xl.jpg"
        client.delete(f"/api/reserve/{item['id']}", headers=h)


def test_the_reserve_counts_with_or_without_accents():
    with TestClient(app) as client:
        h = _h(client)
        sku = f"ACENTO{uuid.uuid4().hex[:5].upper()}"
        name = f"GUANTES PROTECCION PRUEBA {sku[-5:]}"
        assert client.post("/api/products", headers=h, json={"sku": sku, "name": name, "size": "XL",
                                                              "location_id": "C-1-1", "qty": 1, "min_qty": 3}).status_code == 201
        # en la reserva, escrita a mano con tilde y espacios de mas, sin codigo
        item = client.post("/api/reserve", headers=h, json={"name": name.replace("PROTECCION", "protección  "),
                                                             "size": "xl", "qty": 4}).json()
        need = next(n for n in client.get("/api/reports/needs", headers=h).json() if n["product"]["sku"] == sku)
        assert need["in_reserve"] == 4
        # y escanearla para la reserva se suma a esa, no crea otra
        r = client.post("/api/reserve/scan", headers=h, json={"sku": sku, "qty": 1}).json()
        assert r["item"]["id"] == item["id"] and r["item"]["qty"] == 5
        client.delete(f"/api/reserve/{item['id']}", headers=h)
        assert client.delete(f"/api/products/{sku}", headers=h).status_code == 204
