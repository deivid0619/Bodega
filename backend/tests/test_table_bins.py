"""Las canastas debajo de la mesa: 18 ubicaciones que guardan prendas, y la
distribucion que ya existia las recibe una sola vez."""
from fastapi.testclient import TestClient

from app import models
from app.core.database import SessionLocal
from app.modules.bodega.logic import table_slots
from app.main import app
from app.core.config import settings
from app.core.migrations import table_bins


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_slots_are_stacks_of_three():
    assert len(table_slots(18)) == 18 and table_slots(18)[0] == (1, 1) and table_slots(18)[-1] == (3, 6)
    # 17: a la ultima pila le falta la de arriba
    assert len(table_slots(17)) == 17 and (1, 6) not in table_slots(17) and (2, 6) in table_slots(17)
    assert table_slots(0) == []


def test_table_baskets_hold_stock_and_old_layouts_get_them_once():
    with TestClient(app) as client:
        h = _h(client)
        table = next(e for e in client.get("/api/layout", headers=h).json()["elements"] if e["type"] == "table")
        ids = [l["id"] for l in table["locations"]]
        assert table["code"] == "M" and table["name"] == "Mesa M" and len(ids) == 18
        assert ids[:3] == ["M-1-1", "M-1-2", "M-1-3"] and ids[-1] == "M-3-6"
        # el 3D recibe el nivel y la pila de cada canasta: no los recalcula
        assert [(l["level"], l["pile"]) for l in table["locations"]] == table_slots(18)

        r = client.post("/api/products", headers=h, json={"sku": "MESA-1", "name": "PRUEBA MESA", "size": "S",
                                                           "location_id": "M-2-3", "qty": 2})
        assert r.status_code == 201, r.text

        # una distribucion vieja (mesa sin codigo ni canastas) las recibe una sola vez
        with SessionLocal() as db:
            mesa = db.query(models.Element).filter_by(type="table").one()
            flag = db.get(models.AppSetting, "layout_mesa_18_canastas")
            assert flag is not None
            db.delete(flag)
            mesa_id, mesa_code = mesa.id, mesa.code
            mesa.params = {"w": 1.3}
            mesa.code = None
            db.commit()
            table_bins(db)
            mesa = db.get(models.Element, mesa_id)
            assert mesa.params["bins"] == 18 and mesa.code == mesa_code
            mesa.params = {"w": 1.3, "bins": 0}
            db.commit()
            table_bins(db)  # ya se hizo: no vuelve a tocarla
            assert db.get(models.Element, mesa_id).params["bins"] == 0
            mesa = db.get(models.Element, mesa_id)
            mesa.params = {"w": 1.3, "bins": 18}
            db.commit()
