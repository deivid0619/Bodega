"""Distribución de la bodega: cuarto, y agregar/mover/redimensionar/borrar
muebles. Editar la distribución es solo para administradores."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import layout_service as svc
from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/layout", tags=["distribución"])


@router.get("", response_model=schemas.LayoutOut)
def get_layout(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    room = svc.get_room(db)
    elements = [svc.element_out(e) for e in svc.get_elements(db)]
    return schemas.LayoutOut(room=schemas.RoomOut(width=room.width, depth=room.depth), elements=elements)


@router.put("/room", response_model=schemas.RoomOut)
def update_room(payload: schemas.RoomIn, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    try:
        room = svc.update_room(db, payload.width, payload.depth)
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return schemas.RoomOut(width=room.width, depth=room.depth)


@router.post("/reset", response_model=schemas.LayoutOut)
def reset_layout(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    try:
        svc.reset_to_default(db)
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    room = svc.get_room(db)
    elements = [svc.element_out(e) for e in svc.get_elements(db)]
    return schemas.LayoutOut(room=schemas.RoomOut(width=room.width, depth=room.depth), elements=elements)


@router.post("/elements", response_model=schemas.ElementOut)
def add_element(payload: schemas.ElementCreateIn, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    try:
        el = svc.add_element(db, payload.type, payload.x, payload.z, payload.rot)
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return svc.element_out(el)


@router.patch("/elements/{element_id}", response_model=schemas.ElementOut)
def update_element(element_id: str, payload: schemas.ElementUpdateIn, db: Session = Depends(get_db),
                    _: models.User = Depends(require_admin)):
    try:
        el = svc.update_element(db, element_id, payload.model_dump(exclude_unset=True))
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return svc.element_out(el)


@router.post("/elements/{element_id}/duplicate", response_model=schemas.ElementOut)
def duplicate_element(element_id: str, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    try:
        el = svc.duplicate_element(db, element_id)
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return svc.element_out(el)


@router.delete("/elements/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_element(element_id: str, db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    try:
        svc.delete_element(db, element_id)
    except svc.LayoutError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
