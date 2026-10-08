"""Las canastas debajo de la mesa: 9 ubicaciones que guardan prendas (una
fila de 3 pilas de 3 al frente), y la distribucion que ya existia las recibe
una sola vez. La que habia quedado con 18 pasa a 9 si las de mas estan vacias."""
from fastapi.testclient import TestClient

from app import models
from app.core.database import SessionLocal
from app.modules.bodega.logic import table_slots
from app.main import app
from app.core.config import settings
from app.core.migrations import table_bins, table_bins_nine


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_slots_are_stacks_of_three():
    assert len(table_slots(18)) == 18 and table_slots(18)[0] == (1, 1) and table_slots(18)[-1] == (3, 6)
    # 17: a la ultima pila le falta la de arriba
    assert len(table_slots(17)) == 17 and (1, 6) not in table_slots(17) and (2, 6) in table_slots(17)
    assert table_slots(0) == []
    # la mesa de verdad: 9, una fila de 3 pilas
    assert table_slots(9) == [(lv, pile) for lv in (1, 2, 3) for pile in (1, 2, 3)]


def test_table_baskets_hold_stock_and_old_layouts_get_them_once():
    with TestClient(app) as client:
        h = _h(client)
        table = next(e for e in client.get("/api/layout", headers=h).json()["elements"] if e["type"] == "table")
        ids = [l["id"] for l in table["locations"]]
        assert table["code"] == "M" and table["name"] == "Mesa M" and len(ids) == 9
        assert ids[:3] == ["M-1-1", "M-1-2", "M-1-3"] and ids[-1] == "M-3-3"
        # el 3D recibe el nivel y la pila de cada canasta: no los recalcula
        assert [(l["level"], l["pile"]) for l in table["locations"]] == table_slots(9)

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
            assert mesa.params["bins"] == 9 and mesa.code == mesa_code
            mesa.params = {"w": 1.3, "bins": 0}
            db.commit()
            table_bins(db)  # ya se hizo: no vuelve a tocarla
            assert db.get(models.Element, mesa_id).params["bins"] == 0
            mesa = db.get(models.Element, mesa_id)
            mesa.params = {"w": 1.3, "bins": 9}
            db.commit()


def test_table_with_18_becomes_9_once_only_if_the_extra_baskets_are_empty():
    with TestClient(app) as client:
        h = _h(client)
        with SessionLocal() as db:
            mesa = db.query(models.Element).filter_by(type="table").one()
            mesa_id, code = mesa.id, mesa.code
            mesa.params = {"w": 1.3, "bins": 18}
            mesa.rot = 0  # como venia: el frente mirando a la pared del fondo
            db.commit()
        # con prendas en una de las de mas (M-2-5): no se toca
        r = client.post("/api/products", headers=h, json={"sku": "MESA-EXTRA", "name": "PRUEBA MESA 18", "size": "S",
                                                           "location_id": f"{code}-2-5", "qty": 1})
        assert r.status_code == 201, r.text
        with SessionLocal() as db:
            flag = db.get(models.AppSetting, "layout_mesa_9_canastas")
            if flag:
                db.delete(flag)
                db.commit()
            table_bins_nine(db)
            assert db.get(models.Element, mesa_id).params["bins"] == 18
            assert db.get(models.Element, mesa_id).rot == 2  # girada aunque no se cambie el numero
            assert db.get(models.AppSetting, "layout_mesa_9_canastas") is not None
        # vacias (la prenda sale de ahi): pasa a 9 y su ubicacion principal se reubica
        assert client.post("/api/movements", headers=h, json={"sku": "MESA-EXTRA", "type": "out", "qty": 1}).status_code == 200
        with SessionLocal() as db:
            db.delete(db.get(models.AppSetting, "layout_mesa_9_canastas"))
            db.commit()
            table_bins_nine(db)
            assert db.get(models.Element, mesa_id).params["bins"] == 9
            assert db.get(models.Product, "MESA-EXTRA").location_id == f"{code}-2-3"
            # ya se hizo: si despues se cambia en el editor, no se vuelve a tocar
            mesa = db.get(models.Element, mesa_id)
            mesa.params = {"w": 1.3, "bins": 18}
            db.commit()
            table_bins_nine(db)
            assert db.get(models.Element, mesa_id).params["bins"] == 18
            mesa = db.get(models.Element, mesa_id)
            mesa.params = {"w": 1.3, "bins": 9}
            db.commit()
        assert client.delete("/api/products/MESA-EXTRA", headers=h).status_code == 204
        ids = [l["id"] for e in client.get("/api/layout", headers=h).json()["elements"] if e["type"] == "table" for l in e["locations"]]
        assert len(ids) == 9 and ids[-1] == f"{code}-3-3"
