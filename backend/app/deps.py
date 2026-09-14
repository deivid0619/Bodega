"""Dependencias de FastAPI: usuario actual y control de rol."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import get_db
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
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
