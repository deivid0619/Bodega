"""Avisos al celular: activar o apagar en este dispositivo, elegir cuales,
y mandar uno de prueba. La cuenta "solo ver" tambien puede (es solo su
celular: no cambia nada de la bodega)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.modules.avisos import push
from app.core.database import get_db
from app.core.deps import get_any_user

router = APIRouter(prefix="/api/push", tags=["avisos al celular"])


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)
    keys: dict[str, str]
    prefs: dict[str, bool] = {}


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)
    prefs: dict[str, bool] = {}


def _mine(db: Session, endpoint: str, user: models.User) -> models.PushSubscription:
    sub = db.query(models.PushSubscription).filter_by(endpoint=endpoint, user_id=user.id).first()
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Este celular no tiene los avisos activados.")
    return sub


@router.get("/key")
def key(db: Session = Depends(get_db), _: models.User = Depends(get_any_user)):
    return {"public_key": push.public_key(db), "kinds": list(push.KINDS)}


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(payload: SubscriptionIn, db: Session = Depends(get_db), user: models.User = Depends(get_any_user)):
    p256dh, auth = payload.keys.get("p256dh"), payload.keys.get("auth")
    if not p256dh or not auth:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Faltan las llaves de este celular.")
    sub = db.query(models.PushSubscription).filter_by(endpoint=payload.endpoint).first()
    if sub is None:
        sub = models.PushSubscription(endpoint=payload.endpoint)
        db.add(sub)
    # el mismo celular con otra cuenta: los avisos son de quien inicio sesion ahora
    sub.user_id, sub.p256dh, sub.auth = user.id, p256dh, auth
    sub.prefs = push.clean_prefs(payload.prefs)
    db.commit()


@router.post("/prefs", status_code=status.HTTP_204_NO_CONTENT)
def prefs(payload: EndpointIn, db: Session = Depends(get_db), user: models.User = Depends(get_any_user)):
    sub = _mine(db, payload.endpoint, user)
    sub.prefs = push.clean_prefs(payload.prefs)
    db.commit()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(payload: EndpointIn, db: Session = Depends(get_db), user: models.User = Depends(get_any_user)):
    db.query(models.PushSubscription).filter_by(endpoint=payload.endpoint, user_id=user.id).delete()
    db.commit()


@router.post("/test")
def test(payload: EndpointIn, db: Session = Depends(get_db), user: models.User = Depends(get_any_user)):
    sub = _mine(db, payload.endpoint, user)
    ok = push.send(sub, {"title": "Bodega", "body": "Así te llegarán los avisos.", "url": "/", "tag": "prueba"},
                   push._keys(db))
    if not ok:
        db.delete(sub)
        db.commit()
        raise HTTPException(status.HTTP_410_GONE, "Este celular ya no recibe avisos. Actívalos otra vez.")
    return {"sent": True}
