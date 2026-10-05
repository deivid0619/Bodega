"""Pedidos, lo más vendido, exportar a CSV y datos de prueba."""
import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import inventory_service as inv
from .. import models, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/reports", tags=["reportes"])


@router.get("/needs", response_model=list[schemas.NeedOut])
def needs(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = inv.needs(db)
    outs = ser.products_out(db, [p for p, _, _ in rows])
    return [schemas.NeedOut(product=o, order_qty=q, in_reserve=r) for o, (_, q, r) in zip(outs, rows)]


@router.get("/top", response_model=list[schemas.TopOut])
def top(days: int = 30, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return [schemas.TopOut(**row) for row in inv.top_movers(db, days=days)]


def _csv_response(rows: list[list], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/inventory.csv")
def inventory_csv(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = [["SKU", "Referencia", "Talla", "Ubicación principal", "Dónde está", "Cantidad", "Mínimo", "Estado", "Salidas 30 días"]]
    names, outs, stock = ser.loc_names(db), ser.out_30d_map(db), ser.stock_map(db)
    for p in db.query(models.Product).order_by(models.Product.name, models.Product.size).all():
        estado = "Agotado" if p.qty == 0 else ("Bajo mínimo" if p.min_qty and p.qty <= p.min_qty else "OK")
        where = ", ".join(f"{loc} ({q})" for loc, q in sorted(stock.get(p.sku, []), key=lambda r: -r[1]))
        rows.append([p.sku, p.name, p.size, names.get(p.location_id, p.location_id), where, p.qty, p.min_qty,
                     estado, outs.get(p.sku, 0)])
    return _csv_response(rows, f"inventario-{_today()}.csv")


@router.get("/movements.csv")
def movements_csv(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = [["Fecha", "Tipo", "SKU", "Referencia", "Talla", "Cantidad", "Antes", "Después", "Ubicación", "Hacia",
             "Nota", "Usuario"]]
    labels = {"in": "Entrada", "out": "Salida", "set": "Conteo", "new": "Registro nuevo", "move": "Traslado"}
    names = ser.loc_names(db)
    for m in db.query(models.Movement).order_by(models.Movement.id.desc()).limit(5000).all():
        rows.append([ser.local_time(m.created_at).strftime("%Y-%m-%d %H:%M"), labels.get(m.type, m.type), m.sku,
                     m.product_name, m.product_size, m.qty, m.before, m.after, names.get(m.location_id, m.location_id),
                     names.get(m.to_location_id, m.to_location_id) if m.to_location_id else "", m.note or "",
                     m.user_name])
    return _csv_response(rows, f"historial-{_today()}.csv")


def _today():
    return datetime.now(ser.BOGOTA).date()


@router.post("/demo")
def toggle_demo(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    if inv.has_demo_data(db):
        inv.remove_demo_data(db)
        return {"demo": False}
    inv.load_demo_data(db, user)
    return {"demo": True}
