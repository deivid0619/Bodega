"""Registro, inicio de sesion, datos del usuario actual y el enlace para ver
sin editar."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..security import create_access_token, hash_password, verify_password

VIEW_KEY = "view_link"  # en app_settings: la llave del enlace activo
VIEW_NAME = "view_link_name"  # y para quien es

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


# ---- enlace para ver sin editar (para mostrar la app a alguien) ----
def _viewers_out(db: Session) -> None:
    """Las sesiones abiertas con un enlace viejo dejan de servir."""
    db.query(models.User).filter(models.User.role == "viewer").delete(synchronize_session=False)


def _setting(db: Session, key: str, value: str | None) -> None:
    row = db.get(models.AppSetting, key)
    if value:
        if row:
            row.value = value
        else:
            db.add(models.AppSetting(key=key, value=value))
    elif row:
        db.delete(row)


@router.get("/view-link", response_model=schemas.ViewLinkOut)
def view_link(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    row = db.get(models.AppSetting, VIEW_KEY)
    who = db.get(models.AppSetting, VIEW_NAME)
    return schemas.ViewLinkOut(active=bool(row), key=row.value if row else None, name=who.value if row and who else None)


@router.post("/view-link", response_model=schemas.ViewLinkOut)
def new_view_link(payload: Optional[schemas.ViewLinkIn] = None, db: Session = Depends(get_db),
                  _: models.User = Depends(require_admin)):
    """Crea el enlace (o uno nuevo: el anterior y sus sesiones dejan de servir),
    con el nombre de quien lo va a usar."""
    key = secrets.token_urlsafe(18)
    name = " ".join((payload.name if payload else "").split())
    _setting(db, VIEW_KEY, key)
    _setting(db, VIEW_NAME, name or None)
    _viewers_out(db)
    db.commit()
    return schemas.ViewLinkOut(active=True, key=key, name=name or None)


@router.delete("/view-link", status_code=status.HTTP_204_NO_CONTENT)
def stop_view_link(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Desactiva el enlace: ya no abre y quien lo estaba usando sale."""
    _setting(db, VIEW_KEY, None)
    _setting(db, VIEW_NAME, None)
    _viewers_out(db)
    db.commit()


@router.post("/view", response_model=schemas.Token)
def enter_view(payload: schemas.ViewKeyIn, db: Session = Depends(get_db)):
    """Entrar con el enlace para ver: sin contrasena, como "Solo ver"."""
    row = db.get(models.AppSetting, VIEW_KEY)
    if not row or not secrets.compare_digest(row.value, payload.key.strip()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Este enlace ya no funciona. Pide uno nuevo.")
    # una cuenta por enlace: al crear otro o desactivarlo, se borra y sus sesiones se cierran
    email = f"solo-ver-{row.value[:8].lower()}@bodega.app"
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        who = db.get(models.AppSetting, VIEW_NAME)
        user = models.User(email=email, name=who.value if who else "Solo ver",
                           password_hash=hash_password(secrets.token_urlsafe(24)), role="viewer")
        db.add(user)
        db.commit()
        db.refresh(user)
    return schemas.Token(access_token=create_access_token(user.email), user=schemas.UserOut.model_validate(user))
