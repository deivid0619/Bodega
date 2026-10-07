"""Avisos para las personas de los enlaces "solo ver": el equipo elige a quien
avisarle de una remision o unas entradas; cada uno ve solo los suyos y le
llegan al celular. Los avisos de siempre del equipo no les llegan."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_bodega.db")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "admin1234")

from fastapi.testclient import TestClient

from app import models, push
from app.config import settings
from app.database import SessionLocal
from app.main import app


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _sub(client, headers, name):
    return client.post("/api/push/subscribe", headers=headers, json={
        "endpoint": f"https://push.example/{name}", "keys": {"p256dh": "k" * 20, "auth": "a" * 10}})


def test_notices_reach_only_who_was_chosen(monkeypatch):
    sent = []
    monkeypatch.setattr(push, "send", lambda sub, payload, vapid: sent.append((sub.endpoint, payload["title"])) or True)
    with TestClient(app) as client:
        admin = _h(client.post("/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}).json()["access_token"])
        gab = client.post("/api/auth/view-links", headers=admin, json={"name": "Gabriel"}).json()
        ana = client.post("/api/auth/view-links", headers=admin, json={"name": "Ana"}).json()
        assert gab["notify"] == {"remision": True, "entradas": True}

        # a Ana no se le marcan las remisiones de entrada
        r = client.put(f"/api/auth/view-links/{ana['id']}/notify", headers=admin, json={"remision": False, "entradas": True})
        assert r.status_code == 200 and r.json()["notify"] == {"remision": False, "entradas": True}
        rec = {x["name"]: x for x in client.get("/api/notices/recipients", headers=admin).json()}
        assert rec["Ana"]["remision"] is False and rec["Gabriel"]["remision"] is True

        g = _h(client.post("/api/auth/view", json={"key": gab["key"]}).json()["access_token"])
        a = _h(client.post("/api/auth/view", json={"key": ana["key"]}).json()["access_token"])
        # activan los avisos en su celular (es lo unico que pueden guardar)
        assert _sub(client, g, "gabriel").status_code == 204
        assert _sub(client, a, "ana").status_code == 204
        # pero no ven a quien se avisa ni mandan avisos
        assert client.get("/api/notices/recipients", headers=g).json() == []
        assert client.post("/api/notices", headers=g, json={"kind": "in", "title": "x", "links": [gab["id"]]}).status_code == 403

        # el equipo le avisa solo a Gabriel de una remision
        r = client.post("/api/notices", headers=admin, json={
            "kind": "remision", "title": "Remisión OPR 12 · Taller", "body": "Entraron 20 prendas", "links": [gab["id"]]})
        assert r.status_code == 201 and r.json()["to"] == ["Gabriel"]
        assert ("https://push.example/gabriel", "Remisión OPR 12 · Taller") in sent
        assert not any(e.endswith("/ana") for e, _ in sent)

        mine = client.get("/api/notices", headers=g).json()
        assert [n["title"] for n in mine][:1] == ["Remisión OPR 12 · Taller"] and mine[0]["to"] == []
        assert not any(n["title"] == "Remisión OPR 12 · Taller" for n in client.get("/api/notices", headers=a).json())
        assert client.get("/api/notices", headers=admin).json()[0]["to"] == ["Gabriel"]

        # los avisos de siempre (entradas, salidas...) no les llegan a ellos
        sent.clear()
        push.notify("in", "Entraron 3 · Prueba", "F-1-1")
        assert not any(e.endswith(("/gabriel", "/ana")) for e, _ in sent)

        client.delete(f"/api/auth/view-links/{gab['id']}", headers=admin)
        client.delete(f"/api/auth/view-links/{ana['id']}", headers=admin)
    with SessionLocal() as db:
        db.query(models.PushSubscription).filter(models.PushSubscription.endpoint.like("https://push.example/%")).delete(synchronize_session=False)
        db.commit()
