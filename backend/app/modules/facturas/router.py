"""Facturas y pedidos: la factura descuenta todo lo que salio (o solo se
registra), el pedido se descuenta al empacarlo y espera su factura, que se
anexa despues (o se deshace). Todo junto o nada; el mismo numero no se
aplica dos veces."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.database import get_db
from app.core.deps import get_current_user
from app.modules.avisos import push
from app.modules.documentos import photo_store
from app.modules.inventario import service as inv, serializers as ser
from app.modules.documentos.service import already, norm_number

router = APIRouter(prefix="/api/documents", tags=["facturas"])


PEDIDO_NOTE = "Pedido "  # nota de las salidas de un pedido que espera su factura
NO_FACTURA_NOTE = "Pedido sin factura "  # las de un pedido que se confirmo sin factura


def _merge_out(db: Session, lines: list[schemas.DocumentLineIn]) -> dict[tuple[str, Optional[str]], int]:
    """La misma referencia repetida se descuenta una sola vez, sumada."""
    merged: dict[tuple[str, Optional[str]], int] = {}
    for line in lines:
        key = (inv.resolve_sku(db, line.sku), line.location_id or None)
        merged[key] = merged.get(key, 0) + line.qty
    return merged


def _take_out(db: Session, merged: dict, user: models.User, note: str) -> tuple[list[tuple[str, str, int]], dict[str, int]]:
    """Descuenta todo: primero lo que sale de una ubicacion elegida y despues
    lo de "donde haya", para que no se lleve lo de la canasta que se eligio.
    Lo de "donde haya" que no alcanza en la bodega sale de la reserva (lo
    que estaba guardado aparte tambien se empaca). Devuelve de donde salio
    cada parte (sku, ubicacion o RESERVA, cantidad) y cuantas habia de cada
    codigo antes (para el aviso de bajo minimo)."""
    parts: list[tuple[str, str, int]] = []
    first_before: dict[str, int] = {}
    for (sku, loc), qty in sorted(merged.items(), key=lambda kv: kv[0][1] is None):
        try:
            if loc:
                _, movs = inv.apply_movement(db, sku, "out", qty, user, location_id=loc, note=note, commit=False)
                first_before.setdefault(sku, movs[0].before)
                parts += [(sku, m.location_id, m.qty) for m in movs]
                continue
            here = min(qty, inv.usable_out(db, sku))
            if here:
                _, movs = inv.apply_movement(db, sku, "out", here, user, note=note, commit=False)
                first_before.setdefault(sku, movs[0].before)
                parts += [(sku, m.location_id, m.qty) for m in movs]
            if qty > here:
                movs = inv.out_from_reserve(db, sku, qty - here, user, note)
                first_before.setdefault(sku, movs[0].before)
                parts.append((sku, inv.RESERVE_LOC, qty - here))
        except inv.InventoryError as e:
            raise inv.InventoryError(f"{sku}: {e}") from e
    return parts, first_before


def _lines_from(parts: list[tuple[str, str, int]], into: Optional[list[dict]] = None) -> list[dict]:
    """Las lineas del documento, una por codigo y ubicacion de donde salio."""
    lines = [dict(l) for l in (into or [])]
    for sku, loc, qty in parts:
        same = next((l for l in lines if l["sku"] == sku and l.get("location_id") == loc), None)
        if same:
            same["qty"] += qty
        else:
            lines.append({"sku": sku, "qty": qty, "location_id": loc})
    return lines


def _warn_low(background: BackgroundTasks, db: Session, skus: set[str], first_before: dict[str, int]) -> list[models.Product]:
    products = db.query(models.Product).filter(models.Product.sku.in_(skus)).all() if skus else []
    for p in products:
        if p.min_qty > 0 and first_before.get(p.sku, 0) > p.min_qty >= p.qty:
            background.add_task(push.notify, "low", f"Bajo mínimo · {push.label(p.name, p.size)}",
                                f"Quedan {p.qty} (mínimo {p.min_qty}). Revisa la reserva o haz el pedido.",
                                "/summary", f"low-{p.sku}", None)
    return products


def _factura_taken(db: Session, number: str, but: Optional[int] = None) -> None:
    prev = already(db, "factura", number)
    if prev and prev.id != but:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        verb = "se registró" if prev.mode == "registro" else "se descontó"
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya {verb} el {when} ({prev.user_name}).")


@router.post("/factura", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_factura(payload: schemas.FacturaIn, background: BackgroundTasks, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    """La factura de lo que salio: se descuenta todo junto o nada. Con
    record_only solo se guarda el registro (ya se desconto por otro lado)."""
    number = norm_number(payload.number)
    _factura_taken(db, number)
    merged = _merge_out(db, payload.lines)
    if payload.record_only:
        by_sku: dict[str, int] = {}
        for (sku, _), qty in merged.items():
            by_sku[sku] = by_sku.get(sku, 0) + qty
        doc = models.Document(kind="factura", number=number, mode="registro", units=sum(by_sku.values()),
                              lines=[{"sku": sku, "qty": qty, "location_id": None} for sku, qty in by_sku.items()],
                              user_id=user.id, user_name=user.name)
        db.add(doc)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se registró.")
        db.refresh(doc)
        return schemas.DocumentResult(document=doc, products=[])

    note = f"Factura {number}"
    try:
        parts, first_before = _take_out(db, merged, user, note)
        doc = models.Document(
            kind="factura", number=number, units=sum(merged.values()),
            lines=[{"sku": sku, "qty": qty, "location_id": loc} for (sku, loc), qty in merged.items()],
            user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se descontó nada de la factura.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se descontó.")
    db.refresh(doc)
    background.add_task(push.notify, "docs", f"Factura {number}",
                        f"Salieron {doc.units} prendas · {user.name}", "/summary", f"doc-{number}", user.id)
    products = _warn_low(background, db, {p[0] for p in parts}, first_before)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


@router.post("/pedido", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def create_pedido(payload: schemas.PedidoIn, background: BackgroundTasks, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    """Un pedido empacado antes de tener la factura: se descuenta ya (todo
    junto o nada) y queda esperando la factura, que se anexa despues."""
    number = f"PED-{datetime.now(ser.BOGOTA):%m%d-%H%M%S}"
    note = f"{PEDIDO_NOTE}{number}"
    try:
        parts, first_before = _take_out(db, _merge_out(db, payload.lines), user, note)
        lines = _lines_from(parts)
        doc = models.Document(kind="factura", number=number, status="espera", lines=lines,
                              units=sum(l["qty"] for l in lines), notes=" ".join(payload.notes.split()) or None,
                              user_id=user.id, user_name=user.name)
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se descontó nada del pedido.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Se guardaron dos pedidos en el mismo segundo: intenta de nuevo.")
    db.refresh(doc)
    background.add_task(push.notify, "docs", "Pedido empacado",
                        f"Salieron {doc.units} prendas · esperando factura · {user.name}", "/summary", f"doc-{number}", user.id)
    products = _warn_low(background, db, {p[0] for p in parts}, first_before)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


def _waiting(db: Session, doc_id: int) -> models.Document:
    doc = db.get(models.Document, doc_id)
    if not doc or doc.kind != "factura" or doc.status != "espera":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese pedido ya no está esperando factura.")
    return doc


@router.post("/{doc_id}/factura", response_model=schemas.DocumentResult)
def attach_factura(doc_id: int, payload: schemas.AttachIn, background: BackgroundTasks, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    """La factura de un pedido que ya se desconto: el pedido queda con su
    numero. Lo que la factura trae y no estaba en el pedido se descuenta
    ahora; lo del pedido que no va en la factura, si se pide, vuelve a donde
    salio. Todo junto o nada."""
    doc = _waiting(db, doc_id)
    number = norm_number(payload.number)
    if not number:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escribe el número de la factura.")
    _factura_taken(db, number, but=doc.id)
    note = f"Factura {number}"
    old_note = f"{PEDIDO_NOTE}{doc.number}"
    lines = [dict(l) for l in doc.lines or []]
    first_before: dict[str, int] = {}
    touched: set[str] = set()
    try:
        for r in payload.returns:
            sku = inv.resolve_sku(db, r.sku)
            left = r.qty
            for l in lines:
                if l["sku"] != sku or l["qty"] <= 0 or left <= 0:
                    continue
                back = min(left, l["qty"])
                if l.get("location_id") == inv.RESERVE_LOC:
                    inv.back_to_reserve(db, sku, back)  # habia salido de la reserva: vuelve alla
                else:
                    inv.apply_movement(db, sku, "in", back, user, location_id=l.get("location_id"),
                                       note=f"Devuelta de la factura {number}", commit=False)
                l["qty"] -= back
                left -= back
            if left > 0:
                raise inv.InventoryError(f"{sku}: en el pedido no hay tantas para devolver.")
            touched.add(sku)
        parts, first_before = _take_out(db, _merge_out(db, payload.deduct), user, note)
        touched |= {p[0] for p in parts}
        lines = _lines_from(parts, [l for l in lines if l["qty"] > 0])
        if not lines:
            raise inv.InventoryError("Así no queda nada en el pedido: si no salió nada, deshaz el pedido.")
        # el historial del pedido queda con el numero de su factura
        db.query(models.Movement).filter(models.Movement.note == old_note).update(
            {models.Movement.note: note}, synchronize_session=False)
        doc.number = number
        doc.status = None
        doc.closed_at = models.now()
        doc.lines = lines
        doc.units = sum(l["qty"] for l in lines)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se anexó la factura.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya se registró.")
    db.refresh(doc)
    background.add_task(push.notify, "docs", f"Factura {number}",
                        f"Anexada al pedido: {doc.units} prendas · {user.name}", "/summary", f"doc-{number}", user.id)
    products = _warn_low(background, db, touched, first_before)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


@router.post("/{doc_id}/sin-factura", response_model=schemas.DocumentOut)
def confirm_without_factura(doc_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Un pedido que no va a tener factura: queda cerrado como salida, sin
    numero de factura. Ya se desconto al empacarlo: el inventario no cambia."""
    doc = _waiting(db, doc_id)
    db.query(models.Movement).filter(models.Movement.note == f"{PEDIDO_NOTE}{doc.number}").update(
        {models.Movement.note: f"{NO_FACTURA_NOTE}{doc.number}"}, synchronize_session=False)
    doc.status = None
    doc.mode = "sin_factura"
    doc.closed_at = models.now()
    db.commit()
    db.refresh(doc)
    return doc


@router.post("/{doc_id}/esperar-factura", response_model=schemas.DocumentOut)
def wait_for_factura_again(doc_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Al final si llego la factura: el pedido confirmado sin factura vuelve a
    esperarla (para anexarla). El inventario no cambia."""
    doc = db.get(models.Document, doc_id)
    if not doc or doc.kind != "factura" or doc.mode != "sin_factura":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese pedido no se confirmó sin factura.")
    db.query(models.Movement).filter(models.Movement.note == f"{NO_FACTURA_NOTE}{doc.number}").update(
        {models.Movement.note: f"{PEDIDO_NOTE}{doc.number}"}, synchronize_session=False)
    doc.status = "espera"
    doc.mode = None
    doc.closed_at = None
    db.commit()
    db.refresh(doc)
    return doc


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_pedido(doc_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Deshacer un pedido que todavia espera su factura: todo vuelve a donde
    salio y el pedido se borra. Las facturas y remisiones no se borran."""
    doc = _waiting(db, doc_id)
    paths = [p["path"] for p in doc.photos or []]
    try:
        for l in doc.lines or []:
            if l["qty"] > 0 and l.get("location_id") == inv.RESERVE_LOC:
                inv.back_to_reserve(db, l["sku"], l["qty"])  # habia salido de la reserva: vuelve alla
            elif l["qty"] > 0:
                inv.apply_movement(db, l["sku"], "in", l["qty"], user, location_id=l.get("location_id"),
                                   note="Pedido deshecho", commit=False)
        # sus salidas ya no esperan factura: el historial dice que se deshizo
        db.query(models.Movement).filter(models.Movement.note == f"{PEDIDO_NOTE}{doc.number}").update(
            {models.Movement.note: f"Pedido deshecho {doc.number}"}, synchronize_session=False)
        db.delete(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No se deshizo el pedido.")
    if paths:
        try:
            photo_store.delete(paths)
        except Exception:  # sin conexion con el almacenamiento: se borran solas al mes
            pass
