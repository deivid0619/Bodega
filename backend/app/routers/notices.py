"""Avisos para las personas de los enlaces "solo ver". Quien registra una
remision o unas entradas elige a quien avisarle; a ellos les queda en su
apartado de Avisos y les llega al celular si lo activaron. Nada mas les
llega: lo demas de la bodega lo ven entrando a la app."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import models, push, schemas
from ..database import get_db
from ..deps import get_current_user
from .auth import link_notify, link_of, viewer_ids

router = APIRouter(prefix="/api/notices", tags=["avisos"])

KEEP_DAYS = 60  # los avisos viejos se borran solos
KIND_KEY = {"remision": "remision", "in": "entradas"}


def _staff(user: models.User) -> None:
    if user.role == "viewer":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esto es del equipo de la bodega.")


@router.get("/recipients", response_model=list[schemas.RecipientOut])
def recipients(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """A quien se le puede avisar al registrar, con lo que va marcado de entrada
    (la cuenta "solo ver" no avisa a nadie: lista vacia)."""
    if user.role == "viewer":
        return []
    return [schemas.RecipientOut(id=l.id, name=l.name or "Sin nombre", **link_notify(l))
            for l in db.query(models.ViewLink).order_by(models.ViewLink.id).all()]


@router.get("", response_model=list[schemas.NoticeOut])
def notices(limit: int = Query(30, ge=1, le=100), before: int | None = None,
            db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Los avisos mas nuevos primero. La cuenta "solo ver" ve solo los suyos;
    el equipo ve todos los que se han mandado y a quien."""
    q = db.query(models.Notice)
    if before:
        q = q.filter(models.Notice.id < before)
    q = q.order_by(models.Notice.id.desc())
    names = {l.id: l.name or "Sin nombre" for l in db.query(models.ViewLink).all()}
    if user.role == "viewer":
        mine = link_of(db, user)
        if not mine:
            return []
        # los de este enlace (se filtra aqui: la lista de enlaces va en JSON)
        out, offset = [], 0
        while len(out) < limit:
            batch = q.offset(offset).limit(200).all()
            if not batch:
                break
            out += [n for n in batch if mine.id in (n.links or [])]
            offset += 200
        return [_out(n) for n in out[:limit]]
    return [_out(n, [names[i] for i in (n.links or []) if i in names]) for n in q.limit(limit).all()]


def _out(n: models.Notice, to: list[str] | None = None) -> schemas.NoticeOut:
    return schemas.NoticeOut(id=n.id, kind=n.kind, title=n.title, body=n.body, url=n.url,
                             user_name=n.user_name, to=to or [], created_at=n.created_at)


@router.post("", response_model=schemas.NoticeOut, status_code=status.HTTP_201_CREATED)
def send_notice(payload: schemas.NoticeIn, background: BackgroundTasks, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    """Mandar un aviso a las personas elegidas (de una remision o unas entradas
    que se acaban de registrar)."""
    _staff(user)
    links = db.query(models.ViewLink).filter(models.ViewLink.id.in_(payload.links)).all()
    if not links:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esas personas ya no tienen enlace.")
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    db.query(models.Notice).filter(models.Notice.created_at < cutoff).delete(synchronize_session=False)
    notice = models.Notice(kind=payload.kind, title=payload.title.strip(), body=payload.body.strip(), url=payload.url,
                           links=[l.id for l in links], user_name=user.name)
    db.add(notice)
    db.commit()
    db.refresh(notice)
    background.add_task(push.notify_users, viewer_ids(db, links), notice.title, notice.body, notice.url,
                        f"aviso-{notice.id}")
    return _out(notice, [l.name or "Sin nombre" for l in links])
