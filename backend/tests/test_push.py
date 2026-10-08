"""Avisos al celular: le llegan a los demas segun lo que eligio cada uno,
nunca a quien hizo el movimiento (salvo bajo minimo, que es para todos), y
un celular que ya no existe se olvida. El envio se simula: nada sale a internet."""
import json

from fastapi.testclient import TestClient

from app.modules.avisos import push
from app.core.config import settings
from app.main import app

KEYS = {"p256dh": "B" * 87, "auth": "A" * 22}


def _login(client, email, password):
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_push_reaches_the_others_by_preference(monkeypatch):
    sent = []

    def fake_webpush(info, data=None, **kw):
        sent.append((info["endpoint"], json.loads(data)))
        if "perdido" in info["endpoint"]:
            raise push.WebPushException("ya no existe", response=type("R", (), {"status_code": 410})())

    monkeypatch.setattr(push, "webpush", fake_webpush)
    with TestClient(app) as client:
        admin = _login(client, settings.admin_email, settings.admin_password)
        r = client.post("/api/auth/register", json={"email": "aviso@test.com", "password": "clave-prueba",
                                                    "name": "Operador Avisos", "invite_code": settings.registration_code})
        assert r.status_code == 200, r.text
        op = {"Authorization": f"Bearer {r.json()['access_token']}"}

        assert len(client.get("/api/push/key", headers=op).json()["public_key"]) >= 80
        for headers, endpoint, prefs in [(op, "https://push.example/op", {"in": False}),
                                         (admin, "https://push.example/admin", {}),
                                         (op, "https://push.example/perdido", {})]:
            r = client.post("/api/push/subscribe", headers=headers, json={"endpoint": endpoint, "keys": KEYS, "prefs": prefs})
            assert r.status_code == 204, r.text

        r = client.post("/api/products", headers=admin, json={"sku": "PUSH-A", "name": "AVISO PRUEBA", "size": "M",
                                                               "location_id": "F-8-1", "qty": 3, "min_qty": 2})
        assert r.status_code == 201
        sent.clear()
        client.post("/api/movements", headers=admin, json={"sku": "PUSH-A", "type": "out", "qty": 1})
        got = {(endpoint.rsplit("/", 1)[1], payload["tag"]) for endpoint, payload in sent}
        assert ("op", "out-PUSH-A") in got                       # al otro le llega la salida
        assert ("admin", "out-PUSH-A") not in got                # a quien la hizo, no
        assert ("admin", "low-PUSH-A") in got                    # quedo en el minimo: a todos
        title = next(p["title"] for e, p in sent if p["tag"] == "out-PUSH-A")
        assert title.startswith("Salieron 1")

        # el celular que ya no existe se olvido
        assert client.post("/api/push/prefs", headers=op, json={"endpoint": "https://push.example/perdido"}).status_code == 404

        # el operador apago las entradas
        sent.clear()
        client.post("/api/movements", headers=admin, json={"sku": "PUSH-A", "type": "in", "qty": 1})
        assert not any(e.endswith("/op") for e, _ in sent)

        # cambiar preferencias y apagar los avisos
        assert client.post("/api/push/prefs", headers=op, json={"endpoint": "https://push.example/op", "prefs": {"in": True}}).status_code == 204
        assert client.post("/api/push/unsubscribe", headers=op, json={"endpoint": "https://push.example/op"}).status_code == 204
        assert client.post("/api/push/prefs", headers=op, json={"endpoint": "https://push.example/op"}).status_code == 404
