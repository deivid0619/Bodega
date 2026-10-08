"""Registro, inicio de sesion, datos del usuario actual y el enlace para ver
sin editar."""
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..security import create_access_token, hash_password, verify_password

VIEW_KEY = "view_link"  # el enlace unico de antes (app_settings): pasa a view_links
VIEW_NAME = "view_link_name"

router = APIRouter(prefix="/api/auth", tags=["autenticación"])


@router.post("/register", response_model=schemas.Token)
def register(payload: schemas.RegisterIn, db: Session = Depends(get_db)):
    if payload.invite_code != settings.registration_code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El código de invitación no es correcto.")
    email = payload.email.strip().lower()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ya existe una cuenta con ese correo.")
    user = models.User(email=email, name=payload.name.strip(), password_hash=hash_password(payload.password), role="operator")
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user.email)
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user))


@router.post("/login", response_model=schemas.Token)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Correo o contraseña incorrectos.")
    token = create_access_token(user.email)
    return schemas.Token(access_token=token, user=schemas.UserOut.model_validate(user))


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user


# ---- enlaces para ver sin editar (uno por persona) ----
VIEW_DAYS = 30  # la sesion de solo ver dura un mes (quitar el enlace la cierra al instante)


def _viewer_email(key: str) -> str:
    return f"solo-ver-{key[:8].lower()}@bodega.app"


def _legacy(db: Session) -> None:
    """El enlace unico de antes (en app_settings) pasa a la lista con la misma
    llave: quien ya lo tenia sigue entrando."""
    row = db.get(models.AppSetting, VIEW_KEY)
    if not row:
        return
    who = db.get(models.AppSetting, VIEW_NAME)
    if not db.query(models.ViewLink).filter(models.ViewLink.key == row.value).first():
        db.add(models.ViewLink(key=row.value, name=who.value if who else ""))
    db.delete(row)
    if who:
        db.delete(who)
    db.commit()


def link_notify(link: models.ViewLink) -> dict[str, bool]:
    """Que avisos le van marcados de entrada (sin dato: todos)."""
    saved = link.notify or {}
    return {k: bool(saved.get(k, True)) for k in ("remision", "entradas", "salidas")}


def link_of(db: Session, user: models.User) -> models.ViewLink | None:
    """El enlace de una cuenta "solo ver"."""
    for link in db.query(models.ViewLink).all():
        if _viewer_email(link.key) == user.email:
            return link
    return None


def viewer_ids(db: Session, links: list[models.ViewLink]) -> list[int]:
    """Las cuentas de esos enlaces (solo existen si ya los abrieron)."""
    emails = [_viewer_email(l.key) for l in links]
    return [u for (u,) in db.query(models.User.id).filter(models.User.email.in_(emails))] if emails else []


def _link_out(db: Session, link: models.ViewLink) -> schemas.ViewLinkOut:
    used = db.query(models.User.id).filter(models.User.email == _viewer_email(link.key)).first() is not None
    return schemas.ViewLinkOut(id=link.id, key=link.key, name=link.name, used=used, notify=link_notify(link),
                               created_at=link.created_at)


def _get_link(db: Session, link_id: int) -> models.ViewLink:
    link = db.get(models.ViewLink, link_id)
    if not link:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese enlace ya no existe.")
    return link


@router.get("/view-links", response_model=list[schemas.ViewLinkOut])
def view_links(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    _legacy(db)
    return [_link_out(db, l) for l in db.query(models.ViewLink).order_by(models.ViewLink.id).all()]


@router.post("/view-links", response_model=schemas.ViewLinkOut, status_code=status.HTTP_201_CREATED)
def new_view_link(payload: schemas.ViewLinkIn, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Un enlace nuevo para alguien: su cuenta "Solo ver" se llama asi."""
    _legacy(db)
    link = models.ViewLink(key=secrets.token_urlsafe(18), name=" ".join(payload.name.split()))
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_out(db, link)


@router.patch("/view-links/{link_id}", response_model=schemas.ViewLinkOut)
def rename_view_link(link_id: int, payload: schemas.ViewLinkIn, db: Session = Depends(get_db),
                     _: models.User = Depends(require_admin)):
    """Cambiar el nombre: el enlace sigue igual y su cuenta se llama distinto."""
    link = _get_link(db, link_id)
    link.name = " ".join(payload.name.split())
    user = db.query(models.User).filter(models.User.email == _viewer_email(link.key)).first()
    if user:
        user.name = link.name or "Solo ver"
    db.commit()
    return _link_out(db, link)


@router.put("/view-links/{link_id}/notify", response_model=schemas.ViewLinkOut)
def set_link_notify(link_id: int, payload: schemas.ViewLinkNotifyIn, db: Session = Depends(get_db),
                    _: models.User = Depends(require_admin)):
    """Que avisos le van marcados de entrada a esta persona (al registrar una
    remision, unas entradas o unas salidas igual se puede cambiar)."""
    link = _get_link(db, link_id)
    link.notify = {"remision": payload.remision, "entradas": payload.entradas, "salidas": payload.salidas}
    db.commit()
    return _link_out(db, link)


@router.delete("/view-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_view_link(link_id: int, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Quitar un enlace: ya no abre y quien lo estaba usando sale."""
    link = _get_link(db, link_id)
    db.query(models.User).filter(models.User.email == _viewer_email(link.key)).delete(synchronize_session=False)
    db.delete(link)
    db.commit()


@router.post("/view", response_model=schemas.Token)
def enter_view(payload: schemas.ViewKeyIn, db: Session = Depends(get_db)):
    """Entrar con un enlace para ver: sin contrasena, como "Solo ver", con el
    nombre del enlace."""
    _legacy(db)
    key = payload.key.strip()
    link = db.query(models.ViewLink).filter(models.ViewLink.key == key).first()
    if not link or not secrets.compare_digest(link.key, key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Este enlace ya no funciona. Pide uno nuevo.")
    email = _viewer_email(link.key)
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        user = models.User(email=email, name=link.name or "Solo ver",
                           password_hash=hash_password(secrets.token_urlsafe(24)), role="viewer")
        db.add(user)
        db.commit()
        db.refresh(user)
    return schemas.Token(access_token=create_access_token(user.email, minutes=VIEW_DAYS * 24 * 60),
                         user=schemas.UserOut.model_validate(user))
