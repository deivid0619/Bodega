"""Catalogo de la tienda: un codigo nuevo se llena con nombre, talla, foto y
precio; el valor del inventario sale a precio de tienda. La tienda se
simula: las pruebas no salen a internet."""
from fastapi.testclient import TestClient

from app import catalog
from app.config import settings
from app.main import app

SHOP = [{
    "title": "Chaqueta  Prueba Catalogo Negra", "handle": "chaqueta-prueba",
    "options": [{"name": "Color"}, {"name": "TALLA"}],
    "images": [{"src": "https://cdn.example/chaqueta.jpg?v=1"}],
    "variants": [
        {"sku": "cat-100s", "option1": "Negra", "option2": "S", "price": "250000.00"},
        {"sku": "CAT-100M", "option1": "Negra", "option2": "M", "price": "250000.00",
         "featured_image": {"src": "https://cdn.example/m.jpg"}},
        {"sku": "", "option1": "Negra", "option2": "L", "price": "250000.00"},
    ],
}]


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_catalog_fills_new_codes_and_prices_the_stock(monkeypatch):
    monkeypatch.setattr(settings, "catalog_url", "https://tienda.example/products.json")
    monkeypatch.setattr(catalog, "_fetch", lambda: SHOP)
    monkeypatch.setitem(catalog._cache, "at", 0.0)
    monkeypatch.setitem(catalog._cache, "items", {})
    with TestClient(app) as client:
        h = _h(client)
        hit = client.get("/api/catalog/lookup/CAT-100S", headers=h).json()
        assert (hit["name"], hit["size"], hit["price"]) == ("CHAQUETA PRUEBA CATALOGO NEGRA", "S", 250000)
        assert hit["image"] == "https://cdn.example/chaqueta.jpg?v=1&width=400"
        assert client.get("/api/catalog/lookup/NO-ESTA", headers=h).status_code == 404

        found = client.get("/api/catalog/search?q=prueba catalogo", headers=h).json()
        assert [s["sku"] for s in found[0]["sizes"]] == ["CAT-100S", "CAT-100M"]

        # registrar un codigo de la tienda le pone su foto
        r = client.post("/api/products", headers=h, json={"sku": "CAT-100M", "name": "CHAQUETA PRUEBA CATALOGO NEGRA",
                                                           "size": "M", "location_id": "F-8-1", "qty": 3})
        assert r.status_code == 201, r.text
        assert r.json()["product"]["image_url"] == "https://cdn.example/m.jpg?width=400"

        # valor a precio de tienda: solo lo que esta en la tienda tiene precio
        r = client.post("/api/products", headers=h, json={"sku": "SIN-TIENDA-1", "name": "OTRA", "size": "",
                                                           "location_id": "F-8-1", "qty": 2})
        assert r.status_code == 201
        v = client.get("/api/reports/value", headers=h).json()
        assert v["available"] is True and v["value"] >= 3 * 250000 and v["units_priced"] >= 3
        assert v["units_total"] - v["units_priced"] >= 2
