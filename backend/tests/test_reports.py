"""Reportes: entradas y salidas por semana, y lo que no se mueve."""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app import models
from app.config import settings
from app.database import SessionLocal
from app.main import app


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_weekly_flow_and_dead_stock():
    with TestClient(app) as client:
        h = _h(client)
        weeks = client.get("/api/reports/weekly", headers=h).json()
        assert len(weeks) == 8 and weeks[-1]["week"] > weeks[0]["week"]
        before = weeks[-1]

        for sku, qty in [("REP-VIVA", 4), ("REP-PARADA", 6), ("REP-NUEVA", 3)]:
            r = client.post("/api/products", headers=h, json={"sku": sku, "name": "REPORTE PRUEBA", "size": sku[-1], "location_id": "F-7-1", "qty": qty})
            assert r.status_code == 201, r.text
        client.post("/api/movements", headers=h, json={"sku": "REP-VIVA", "type": "out", "qty": 2})
        client.post("/api/movements", headers=h, json={"sku": "REP-VIVA", "type": "in", "qty": 1})

        now = client.get("/api/reports/weekly", headers=h).json()[-1]
        assert (now["in"] - before["in"], now["out"] - before["out"]) == (4 + 6 + 3 + 1, 2)

        # PARADA se registro hace 90 dias y su ultima salida fue hace 70; VIVA salio hoy
        old = datetime.now(timezone.utc) - timedelta(days=90)
        with SessionLocal() as db:
            for sku in ("REP-VIVA", "REP-PARADA"):
                db.get(models.Product, sku).created_at = old
            db.add(models.Movement(sku="REP-PARADA", type="out", qty=1, before=7, after=6, location_id="F-7-1",
                                   product_name="REPORTE PRUEBA", product_size="A",
                                   created_at=datetime.now(timezone.utc) - timedelta(days=70)))
            db.commit()

        dead = {d["product"]["sku"]: d for d in client.get("/api/reports/dead?days=60", headers=h).json()}
        assert "REP-PARADA" in dead and dead["REP-PARADA"]["last_out"].endswith(("Z", "+00:00"))
        assert "REP-VIVA" not in dead          # salio hace poco
        assert "REP-NUEVA" not in dead         # recien registrada
        assert "REP-PARADA" not in {d["product"]["sku"] for d in client.get("/api/reports/dead?days=90", headers=h).json()}
