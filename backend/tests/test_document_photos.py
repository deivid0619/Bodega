"""Fotos de remisiones y facturas: se guardan como prueba un mes, se ven y
se descargan con sesion, y despues se borran solas (el documento queda)."""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import models
from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.migrations import purge_old_photos


def _h(client):
    r = client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_a_factura_photo_is_kept_a_month(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "photos_dir", str(tmp_path))
    monkeypatch.setattr(settings, "supabase_url", "")
    with TestClient(app) as client:
        h = _h(client)
        tag = uuid.uuid4().hex[:6].upper()
        sku = f"FOTO-{tag}"
        assert client.post("/api/products", headers=h, json={"sku": sku, "name": "CHAQUETA FOTO PRUEBA", "size": "M",
                                                              "location_id": "C-1-1", "qty": 2}).status_code == 201
        doc = client.post("/api/documents/factura", headers=h, json={"number": f"FEV{tag}", "lines": [{"sku": sku, "qty": 1}]}).json()["document"]
        assert doc["photo_count"] == 0 and doc["photos_until"] is None

        jpg = b"\xff\xd8\xff\xe0" + b"foto de prueba" * 50
        r = client.post(f"/api/documents/{doc['id']}/photos", headers={**h, "Content-Type": "image/jpeg"}, content=jpg)
        assert r.status_code == 200, r.text
        assert r.json()["photo_count"] == 1
        until = datetime.fromisoformat(r.json()["photos_until"].replace("Z", "+00:00"))
        assert timedelta(days=29) < until - datetime.now(timezone.utc) <= timedelta(days=30)
        assert len(list(tmp_path.rglob("*.jpg"))) == 1

        # se ve y se descarga solo con sesion
        got = client.get(f"/api/documents/{doc['id']}/photos/0", headers=h)
        assert got.status_code == 200 and got.content == jpg and got.headers["content-type"] == "image/jpeg"
        assert client.get(f"/api/documents/{doc['id']}/photos/0").status_code == 401
        # solo fotos
        r = client.post(f"/api/documents/{doc['id']}/photos", headers={**h, "Content-Type": "application/pdf"}, content=b"%PDF")
        assert r.status_code == 415

        # paso un mes: la foto se borra sola y el documento queda
        db = SessionLocal()
        try:
            d = db.get(models.Document, doc["id"])
            d.created_at = datetime.now(timezone.utc) - timedelta(days=31)
            db.commit()
            assert purge_old_photos(db) >= 1
        finally:
            db.close()
        assert client.get(f"/api/documents/{doc['id']}/photos/0", headers=h).status_code == 404
        assert not list(tmp_path.rglob("*.jpg"))
        listed = next(x for x in client.get(f"/api/documents?kind=factura&number=FEV{tag}", headers=h).json())
        assert listed["photo_count"] == 0 and listed["units"] == 1

        client.delete(f"/api/products/{sku}", headers=h)
