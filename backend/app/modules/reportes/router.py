"""Pedidos, lo más vendido, exportar a Excel (y CSV) y datos de prueba."""
import csv
import io
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.modules.avisos import push
from app.modules.catalogo import service as catalog
from app.modules.inventario import serializers as ser, service as inv
from app.modules.reportes import excel

router = APIRouter(prefix="/api/reports", tags=["reportes"])


@router.get("/needs", response_model=list[schemas.NeedOut])
def needs(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = inv.needs(db)
    outs = ser.products_out(db, [p for p, _, _ in rows])
    return [schemas.NeedOut(product=o, order_qty=q, in_reserve=r) for o, (_, q, r) in zip(outs, rows)]


@router.get("/weekly", response_model=list[schemas.WeekFlowOut], response_model_by_alias=True)
def weekly(weeks: int = Query(default=8, ge=1, le=26), db: Session = Depends(get_db),
           _: models.User = Depends(get_current_user)):
    return [schemas.WeekFlowOut(**row) for row in inv.weekly_flow(db, weeks=weeks, tz=ser.BOGOTA)]


@router.get("/dead", response_model=list[schemas.DeadOut])
def dead(days: int = Query(default=60, ge=7, le=365), db: Session = Depends(get_db),
         _: models.User = Depends(get_current_user)):
    rows = inv.dead_stock(db, days=days)
    outs = ser.products_out(db, [p for p, _ in rows])
    return [schemas.DeadOut(product=o, last_out=last) for o, (_, last) in zip(outs, rows)]


@router.get("/value", response_model=schemas.ValueOut)
def value(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Cuanto vale lo que hay, a precio de la tienda (solo los codigos que
    estan en la tienda; el resto se cuenta aparte)."""
    cat = catalog.items()
    passing = inv.apart_qty(db)  # lo de paso y el outlet no se cuentan
    out = {"available": bool(cat), "value": 0, "units_priced": 0, "units_total": 0,
           "reserve_value": 0, "reserve_units_priced": 0, "reserve_units_total": 0}
    for p in db.query(models.Product).filter(models.Product.qty > 0).all():
        have = inv.stock_qty(p, passing)  # lo de paso no es de la bodega
        if have <= 0:
            continue
        out["units_total"] += have
        price = (cat.get(p.sku) or {}).get("price") or 0
        if price:
            out["units_priced"] += have
            out["value"] += have * price
    for it in db.query(models.ReserveItem).filter(models.ReserveItem.qty > 0).all():
        out["reserve_units_total"] += it.qty
        price = (cat.get(it.sku) or {}).get("price") or 0 if it.sku else 0
        if price:
            out["reserve_units_priced"] += it.qty
            out["reserve_value"] += it.qty * price
    return out


@router.get("/dispatch", response_model=list[schemas.DispatchOut])
def dispatch(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Lo que esta de paso, esperando salir."""
    rows = inv.dispatch_list(db)
    outs = ser.products_out(db, [p for p, *_ in rows])
    return [schemas.DispatchOut(product=o, qty=q, since=s, doc_number=d.number if d else None,
                                doc_supplier=d.supplier if d else None, doc_notes=d.notes if d else None)
            for o, (_, q, s, d) in zip(outs, rows)]


@router.post("/dispatch/out", response_model=schemas.DispatchSendOut)
def dispatch_out(payload: schemas.DispatchSendIn, background: BackgroundTasks, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    """Despachar: lo que estaba de paso salio empacado. Se descuenta de
    Despacho (todo junto: si algo no alcanza, no se descuenta nada) y sale
    del inventario, con la nota en el historial."""
    note = "Despacho" + (f": {payload.note.strip()}" if payload.note and payload.note.strip() else "")
    merged: dict[str, int] = {}
    for line in payload.lines:
        sku = inv.resolve_sku(db, line.sku)
        merged[sku] = merged.get(sku, 0) + line.qty
    events = []
    try:
        for sku, qty in merged.items():
            product, movs = inv.apply_movement(db, sku, "out", qty, user, location_id=inv.DISPATCH,
                                               note=note[:80], commit=False)
            events.extend(push.movement_events(product, "out", movs, user))
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se despachó nada.")
    for event in events:
        background.add_task(push.notify, *event)
    return schemas.DispatchSendOut(units=sum(merged.values()), lines=len(merged))


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


@router.get("/inventory.xlsx")
def inventory_xlsx(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """El inventario en Excel: resumen, por talla, por referencia, por
    ubicacion, la reserva y lo que hay que pedir."""
    return _xlsx(excel.inventory_workbook(db, user.name), f"inventario-{_today()}.xlsx")


@router.get("/pedido.xlsx")
def pedido_xlsx(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Solo lo que hay que pedir (y lo que se trae de la reserva)."""
    return _xlsx(excel.needs_workbook(db, user.name), f"pedido-{_today()}.xlsx")


@router.get("/movements.xlsx")
def movements_xlsx(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """El historial en Excel (los ultimos 5000 movimientos) y por dia."""
    return _xlsx(excel.movements_workbook(db, user.name), f"historial-{_today()}.xlsx")


def _xlsx(data: bytes, filename: str) -> Response:
    return Response(content=data, media_type=excel.XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


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
