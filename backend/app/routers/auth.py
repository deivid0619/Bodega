"""Registro, inicio de sesion y datos del usuario actual."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..security import create_access_token, hash_password, verify_password

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
