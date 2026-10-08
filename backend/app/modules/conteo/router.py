"""Conteo de una ubicacion: cada codigo queda con lo que se conto ahi; solo
lo que no cuadra genera un ajuste en el historial."""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.database import get_db
from app.core.deps import get_current_user
from app.modules.avisos import push
from app.modules.inventario import service as inv, serializers as ser

router = APIRouter(prefix="/api/documents", tags=["conteo"])


@router.post("/conteo", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_count(payload: schemas.CountIn, background: BackgroundTasks, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    """Conteo de una ubicacion: cada codigo contado queda con lo que se conto
    EN ESA ubicacion (las demas no se tocan). Solo los que no cuadran generan
    un ajuste en el historial; el conteo completo queda guardado."""
    loc = payload.location_id
    if loc not in inv.location_ids(db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa ubicación no existe.")
    counted: dict[str, int] = {}
    for line in payload.lines:
        counted[inv.resolve_sku(db, line.sku)] = line.qty

    note = f"Conteo {loc}"
    out_lines: list[dict] = []
    try:
        for sku, qty in counted.items():
            if db.get(models.Product, sku) is None:
                raise inv.UnknownSku(f"El código {sku} no está registrado.")
            row = (db.query(models.Stock).filter_by(sku=sku, location_id=loc)
                   .with_for_update().first())
            before = row.qty if row else 0
            if qty != before:
                inv.apply_movement(db, sku, "set", qty, user, location_id=loc, note=note, commit=False)
            out_lines.append({"sku": sku, "before": before, "counted": qty})
        stamp = datetime.now(ser.BOGOTA).strftime("%Y%m%d%H%M%S")
        doc = models.Document(
            kind="conteo", number=f"{loc[:24]}@{stamp}", lines=out_lines,
            units=sum(abs(l["counted"] - l["before"]) for l in out_lines),
            user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se guardó el conteo.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese conteo ya se guardó.")
    db.refresh(doc)
    products = db.query(models.Product).filter(models.Product.sku.in_(list(counted))).all()
    fixed = sum(1 for l in out_lines if l["counted"] != l["before"])
    if fixed:
        background.add_task(push.notify, "set", f"Conteo de {loc}",
                            f"{fixed} {'ajuste' if fixed == 1 else 'ajustes'} · {user.name}", "/summary", f"count-{loc}", user.id)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))
