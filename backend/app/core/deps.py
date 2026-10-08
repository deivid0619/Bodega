"""Dependencias de FastAPI: usuario actual y control de rol."""
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app import models
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


VIEW_ONLY = "Esta cuenta es solo para ver: aquí no se puede cambiar nada."
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    user = _authenticated(token, db)
    # la cuenta del enlace "solo ver": consulta todo, no cambia nada
    if user.role == "viewer" and request.method not in SAFE_METHODS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=VIEW_ONLY)
    return user


def get_any_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    """Tambien la cuenta "solo ver", sin el bloqueo de cambios: solo para lo
    que es suyo y no toca la bodega (activar los avisos en su celular)."""
    return _authenticated(token, db)


def _authenticated(token: str | None, db: Session) -> models.User:
    if settings.skip_auth:
        # SOLO DESARROLLO (ver config.py): sin login, actua como el primer
        # usuario admin que exista.
        dev_user = (
            db.query(models.User)
            .filter(models.User.role == "admin")
            .order_by(models.User.id)
            .first()
        )
        if dev_user:
            return dev_user
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesion invalida o vencida. Vuelve a iniciar sesion.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise unauthorized
    email = decode_access_token(token)
    if not email:
        raise unauthorized
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise unauthorized
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede hacer esto.",
        )
    return user
