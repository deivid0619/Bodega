"""El inventario arranca vacio: la prenda de ejemplo del prototipo ya no se
crea sola, y la que quedo se quita una vez si nunca se uso."""
from fastapi.testclient import TestClient

from app import models
from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.core.migrations import remove_sample_product

SAMPLE = "P-WPM210200L"


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _sample(db):
    db.add(models.Product(sku=SAMPLE, name="CORTAV. REXA IMP-100% NEGRO", size="L", location_id="C-1-1", qty=0))
    flag = db.get(models.AppSetting, "prenda_ejemplo_quitada")
    if flag:
        db.delete(flag)
    db.commit()


def test_sample_product_is_not_seeded_and_the_old_one_goes_once():
    with TestClient(app) as client:
        h = _h(client)
        # al arrancar no se crea ninguna prenda
        assert client.get(f"/api/products/{SAMPLE}", headers=h).status_code == 404

        # la que quedo de antes (nunca usada) se quita una sola vez
        with SessionLocal() as db:
            _sample(db)
            remove_sample_product(db)
            assert db.get(models.Product, SAMPLE) is None
            assert db.get(models.AppSetting, "prenda_ejemplo_quitada") is not None

        # si ya se uso (tiene historial), no se toca
        r = client.post("/api/products", headers=h, json={"sku": SAMPLE, "name": "CORTAV. REXA IMP-100% NEGRO",
                                                           "size": "L", "location_id": "C-1-1", "qty": 1})
        assert r.status_code == 201, r.text
        client.post("/api/movements", headers=h, json={"sku": SAMPLE, "type": "out", "qty": 1})
        with SessionLocal() as db:
            db.delete(db.get(models.AppSetting, "prenda_ejemplo_quitada"))
            db.commit()
            remove_sample_product(db)
            assert db.get(models.Product, SAMPLE) is not None
        assert client.delete(f"/api/products/{SAMPLE}", headers=h).status_code == 204
