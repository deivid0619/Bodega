"""Un mismo cambio no se guarda dos veces. La app manda cada cambio con su
llave (encabezado X-Request-Id). Si la señal se cae justo despues de que el
servidor lo guardo, la app lo vuelve a mandar con la misma llave y aqui se
responde lo mismo de la primera vez, sin volver a aplicarlo. Es lo que
permite registrar sin señal y subirlo despues."""
from datetime import timedelta

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.database import SessionLocal, now
from app.core.models import RequestKey

KEEP = timedelta(days=7)
WRITES = {"POST", "PUT", "PATCH", "DELETE"}


class Idempotency(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        key = (request.headers.get("x-request-id") or "").strip()[:64]
        if request.method not in WRITES or not key or not request.url.path.startswith("/api/"):
            return await call_next(request)
        with SessionLocal() as db:
            done = db.get(RequestKey, key)
            if done:
                return Response(content=done.body, status_code=done.status,
                                media_type=done.media_type or "application/json", headers={"X-Repeated": "1"})
        response = await call_next(request)
        if not 200 <= response.status_code < 300:
            return response  # lo que fallo se puede volver a intentar
        body = b"".join([chunk async for chunk in response.body_iterator])
        with SessionLocal() as db:
            db.add(RequestKey(key=key, path=request.url.path[:200], status=response.status_code,
                              media_type=response.media_type, body=body))
            db.query(RequestKey).filter(RequestKey.created_at < now() - KEEP).delete(synchronize_session=False)
            try:
                db.commit()
            except Exception:  # la misma llave llego dos veces a la vez: la primera ya quedo
                db.rollback()
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(content=body, status_code=response.status_code, headers=headers, media_type=response.media_type)
