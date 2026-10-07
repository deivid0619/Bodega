"""Documentos que mueven inventario de una vez: la factura (todo lo que
salio en un despacho), la remision de un proveedor (lo que llego) y el
conteo de una ubicacion. Se aplican completos o nada, y el mismo numero no
se puede aplicar dos veces."""
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import threading
import unicodedata
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import catalog, photo_store
from ..database import SessionLocal
from ..migrations import purge_old_photos
from ..layout_logic import DISPATCH
from .. import inventory_service as inv
from .. import models, push, schemas
from .. import serializers as ser
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/documents", tags=["documentos"])


def _norm_number(number: str) -> str:
    return "".join(number.upper().split())


def _already(db: Session, kind: str, number: str) -> Optional[models.Document]:
    return db.query(models.Document).filter_by(kind=kind, number=number).first()


# ---- fotos del papel: la prueba de lo que llego y lo que salio ----
def _purge_in_background() -> None:
    def run():
        db = SessionLocal()
        try:
            purge_old_photos(db)
        finally:
            db.close()
    threading.Thread(target=run, daemon=True).start()


@router.get("/photo-store", response_model=schemas.PhotoStoreOut)
def photo_store_status(_: models.User = Depends(get_current_user)):
    """Si las fotos se estan guardando bien (en el Resumen)."""
    return photo_store.status()


@router.post("/{doc_id}/photos", response_model=schemas.DocumentOut)
async def add_photo(doc_id: int, request: Request, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    """Guarda la foto de la remision o la factura (la app la manda ya
    achicada, como JPG). Se guarda un mes y despues se borra sola."""
    doc = db.get(models.Document, doc_id)
    if not doc or doc.kind not in ("factura", "remision"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese documento no existe.")
    if not photo_store.usable():
        # en produccion sin Supabase se perderian al reiniciar: mejor decirlo
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, photo_store.NOT_READY)
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype not in photo_store.TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Solo fotos (JPG, PNG o WebP).")
    data = await request.body()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La foto llegó vacía. Intenta otra vez.")
    if len(data) > photo_store.MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "La foto es muy grande.")
    photos = list(doc.photos or [])
    if len(photos) >= photo_store.MAX_PER_DOC:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ya tiene {photo_store.MAX_PER_DOC} fotos.")
    path = f"{doc.kind}/{doc.id}-{uuid.uuid4().hex[:12]}.{photo_store.TYPES[ctype]}"
    try:
        await run_in_threadpool(photo_store.put, path, data, ctype)
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo guardar la foto. Intenta otra vez.")
    doc.photos = photos + [{"path": path, "type": ctype, "size": len(data)}]
    db.commit()
    db.refresh(doc)
    _purge_in_background()  # de paso, las de hace mas de un mes
    return doc


@router.get("/{doc_id}/photos/{index}")
def get_photo(doc_id: int, index: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """La foto (para verla o descargarla). Solo con sesion: nunca es publica."""
    doc = db.get(models.Document, doc_id)
    photos = (doc.photos or []) if doc else []
    if not 0 <= index < len(photos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan un mes.")
    p = photos[index]
    try:
        data = photo_store.get(p["path"])
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo traer la foto. Intenta otra vez.")
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan un mes.")
    return Response(content=data, media_type=p.get("type") or "image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/counts", response_model=schemas.DocumentCountsOut)
def document_counts(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Cuantas remisiones y facturas hay guardadas (el apartado del Resumen)."""
    rows = dict(db.query(models.Document.kind, func.count(models.Document.id)).group_by(models.Document.kind).all())
    waiting = db.query(func.count(models.Document.id)).filter(models.Document.kind == "factura",
                                                             models.Document.status == "espera").scalar()
    return schemas.DocumentCountsOut(remision=rows.get("remision", 0), factura=rows.get("factura", 0), espera=waiting or 0)


def _local_midnight(y: int, m: int, d: int = 1) -> datetime:
    """Las 12 de la noche en Colombia, en UTC (como esta en la base)."""
    return datetime(y, m, d, tzinfo=ser.BOGOTA).astimezone(timezone.utc)


@router.get("/calendar", response_model=list[schemas.DocumentDayOut])
def documents_calendar(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                       db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """El calendario del Resumen: lo que entro con remision y lo que salio con
    factura cada dia del mes (el dia en que se registro, hora de Colombia)."""
    y, m = map(int, month.split("-"))
    start, end = _local_midnight(y, m), _local_midnight(y + (m == 12), m % 12 + 1)
    rows = (db.query(models.Document.kind, models.Document.created_at, models.Document.units)
            .filter(models.Document.kind.in_(("remision", "factura")),
                    models.Document.created_at >= start, models.Document.created_at < end).all())
    days: dict[str, schemas.DocumentDayOut] = {}
    for kind, created, units in rows:
        day = ser.local_time(created).date().isoformat()
        d = days.setdefault(day, schemas.DocumentDayOut(day=day))
        if kind == "remision":
            d.remisiones += 1
            d.units_in += units or 0
        else:
            d.facturas += 1
            d.units_out += units or 0
    return [days[k] for k in sorted(days)]


def _fold(s: str) -> str:
    """Para buscar sin importar mayusculas ni tildes: 'Ñandú' -> 'nandu'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s.casefold()) if not unicodedata.combining(c))


def _haystack(d: models.Document) -> str:
    """Donde se busca: numero, proveedor, notas, quien la registro y cada
    prenda (nombre, talla y codigo)."""
    parts = [d.number, d.supplier or "", d.notes or "", d.user_name or ""]
    parts += [f"{l.get('name') or ''} {l.get('size') or ''} {l.get('sku') or ''}" for l in (d.lines or [])]
    return _fold(" | ".join(parts))


@router.get("", response_model=list[schemas.DocumentOut])
def list_documents(kind: Optional[Literal["factura", "remision", "conteo"]] = None, number: Optional[str] = None,
                   base: Optional[str] = None, prefix: Optional[str] = None, limit: int = Query(default=30, le=200),
                   search: Optional[str] = Query(default=None, alias="q", max_length=60),
                   before: Optional[int] = None,
                   day: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                   status_: Optional[Literal["espera"]] = Query(default=None, alias="status"),
                   db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    q = db.query(models.Document).order_by(models.Document.id.desc())
    if kind:
        q = q.filter(models.Document.kind == kind)
    if status_:
        # los pedidos que esperan su factura
        q = q.filter(models.Document.status == status_)
    if before:
        # la pagina siguiente: las anteriores a la ultima que ya se vio
        q = q.filter(models.Document.id < before)
    if day:
        # las de un dia del calendario (hora de Colombia)
        try:
            start = _local_midnight(*map(int, day.split("-")))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Fecha inválida.")
        q = q.filter(models.Document.created_at >= start, models.Document.created_at < start + timedelta(days=1))
    term = _fold(" ".join((search or "").split()))
    if term:
        # se busca aqui y no en la base: asi da igual si se escribe con
        # tildes, sin ellas o en minuscula (SQLite y Postgres no lo hacen igual)
        compact = term.replace(" ", "")
        found = []
        for d in q.yield_per(200):
            if term in _haystack(d) or compact in _fold(d.number):
                found.append(d)
                if len(found) >= limit:
                    break
        return found
    if number:
        q = q.filter(models.Document.number == _norm_number(number))
    if prefix:
        # conteos de una ubicacion: P-D1@...
        q = q.filter(models.Document.number.startswith(prefix.upper(), autoescape=True))
    if base:
        # todas las entregas de una misma orden: OPR123, OPR123#2, OPR123#3...
        b = _norm_number(base).split("#")[0]
        q = q.filter(or_(models.Document.number == b,
                         models.Document.number.startswith(b + "#", autoescape=True)))
    return q.limit(limit).all()


PEDIDO_NOTE = "Pedido "  # nota de las salidas de un pedido que espera su factura


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
    Devuelve de donde salio cada parte (sku, ubicacion, cantidad) y cuantas
    habia de cada codigo antes (para el aviso de bajo minimo)."""
    parts: list[tuple[str, str, int]] = []
    first_before: dict[str, int] = {}
    for (sku, loc), qty in sorted(merged.items(), key=lambda kv: kv[0][1] is None):
        try:
            _, movs = inv.apply_movement(db, sku, "out", qty, user, location_id=loc, note=note, commit=False)
        except inv.InventoryError as e:
            raise inv.InventoryError(f"{sku}: {e}") from e
        first_before.setdefault(sku, movs[0].before)
        parts += [(sku, m.location_id, m.qty) for m in movs]
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
    prev = _already(db, "factura", number)
    if prev and prev.id != but:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        verb = "se registró" if prev.mode == "registro" else "se descontó"
        raise HTTPException(status.HTTP_409_CONFLICT, f"La factura {number} ya {verb} el {when} ({prev.user_name}).")


@router.post("/factura", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_factura(payload: schemas.FacturaIn, background: BackgroundTasks, db: Session = Depends(get_db),
                  user: models.User = Depends(get_current_user)):
    """La factura de lo que salio: se descuenta todo junto o nada. Con
    record_only solo se guarda el registro (ya se desconto por otro lado)."""
    number = _norm_number(payload.number)
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
    number = _norm_number(payload.number)
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


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_pedido(doc_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Deshacer un pedido que todavia espera su factura: todo vuelve a donde
    salio y el pedido se borra. Las facturas y remisiones no se borran."""
    doc = _waiting(db, doc_id)
    paths = [p["path"] for p in doc.photos or []]
    try:
        for l in doc.lines or []:
            if l["qty"] > 0:
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


@router.get("/recent-entries", response_model=list[schemas.RecentEntryOut])
def recent_entries(skus: str = Query(min_length=1, max_length=4000), days: int = Query(default=3, ge=1, le=30),
                   db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Lo que entro de estos codigos escaneando o a mano (sin remision) en los
    ultimos dias: si llega la remision de algo que ya se entro, es solo
    registro y no se debe sumar otra vez."""
    codes = {inv.resolve_sku(db, s) for s in skus.split(",")[:300] if s.strip()}
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (db.query(models.Movement.sku, func.sum(models.Movement.qty), func.max(models.Movement.created_at))
            .filter(models.Movement.sku.in_(codes), models.Movement.type.in_(("in", "new")),
                    models.Movement.created_at >= since,
                    or_(models.Movement.note.is_(None), models.Movement.note == ""))
            .group_by(models.Movement.sku).all())
    return [schemas.RecentEntryOut(sku=sku, qty=qty, last_at=last) for sku, qty, last in rows if qty]


def _sibling_location(db: Session, name: str, skus: set[str]) -> Optional[str]:
    """Donde estan las otras tallas de la referencia (por nombre, o las tallas
    de la misma referencia que ya estan registradas): una talla nueva se
    guarda con ellas si no se elige otra ubicacion."""
    q = db.query(models.Product).filter((models.Product.name == name) | (models.Product.sku.in_(skus or {""})))
    p = q.order_by(models.Product.qty.desc()).first()
    return p.location_id if p else None


@router.post("/remision", response_model=schemas.DocumentResult, status_code=status.HTTP_201_CREATED)
def apply_remision(payload: schemas.RemisionIn, background: BackgroundTasks, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    """Entrada de mercancia de un proveedor, ya contada. Cada talla con codigo
    entra a la bodega (a la ubicacion elegida para su referencia, o a su
    ubicacion principal); sin codigo, o si se elige la reserva, queda en la
    reserva. Todo junto o nada."""
    number = _norm_number(payload.number or "")
    if not number:
        # el papel no trae numero: uno automatico con la fecha y la hora (asi
        # no se puede revisar si ya entro, pero queda guardada)
        number = f"SN-{datetime.now(ser.BOGOTA):%m%d-%H%M%S}"
    prev = _already(db, "remision", number)
    if prev:
        when = ser.local_time(prev.created_at).strftime("%d/%m/%Y")
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"La remisión {number} ya entró el {when} ({prev.user_name}). "
                            "Si es otra entrega de la misma orden, márcala como otra entrega.")

    to_bodega = payload.destination == "bodega"
    passing = payload.destination == "despacho"
    record = payload.destination == "registro"  # solo el papel: lo que llego ya se habia entrado
    # la misma talla repetida se suma (si va al mismo lugar: una referencia se
    # puede repartir en dos ubicaciones)
    merged: dict[tuple[str, str, Optional[str], Optional[str], bool], list[int]] = {}
    for line in payload.lines:
        sku = inv.resolve_sku(db, line.sku or "") or None
        # repartida: esta parte de la talla va a la reserva aunque el resto entre a la bodega
        to_res = bool(line.to_reserve) and to_bodega
        loc = ((line.location_id or payload.location_id or "").strip() or None) if to_bodega and not to_res else None
        key = (" ".join(line.name.upper().split()), line.size.strip().upper(), sku, loc, to_res)
        acc = merged.setdefault(key, [0, 0])
        acc[0] += line.qty
        acc[1] += line.pending
    if not any(q or p for q, p in merged.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La remisión no tiene cantidades.")

    note = f"{inv.REMISION_NOTE}{number}"
    out_lines: list[dict] = []
    touched: list[str] = []
    try:
        chosen = {k[3] for k in merged if k[3]}
        if chosen - inv.location_ids(db):
            raise inv.InventoryError("Esa ubicación no existe.")
        for (name, size, sku, loc, to_res), (qty, pending) in merged.items():
            row = {"name": name, "size": size, "sku": sku, "qty": qty, "pending": pending,
                   "dest": None, "location_id": None}
            out_lines.append(row)
            if qty == 0:
                continue
            if record:
                row["dest"] = "registro"
                continue
            product = db.get(models.Product, sku) if sku else None
            if passing:
                # de paso: se cuenta en Despacho; sin codigo no se puede (no queda en la bodega)
                if not sku:
                    raise inv.InventoryError(f"{name} {size}: para dejarla de paso hace falta el código de la etiqueta.".replace("  ", " "))
                if product:
                    inv.apply_movement(db, sku, "in", qty, user, location_id=DISPATCH, note=note, commit=False)
                else:
                    image = (catalog.lookup(sku, fetch=False) or {}).get("image")
                    inv.register_product(db, sku, name, size, DISPATCH, qty, 0, user, image_url=image, note=note, commit=False)
                row["dest"], row["location_id"] = "despacho", DISPATCH
                touched.append(sku)
                continue
            if not to_bodega or not sku or to_res:
                inv.add_to_reserve(db, product.name if product else name, product.size if product else size, sku, qty)
                row["dest"] = "reserva"
                continue
            if product:
                _, movs = inv.apply_movement(db, sku, "in", qty, user, location_id=loc, note=note, commit=False)
                row["location_id"] = movs[-1].location_id
            else:
                loc = loc or _sibling_location(db, name, {k[2] for k in merged if k[0] == name and k[2]})
                if not loc:
                    raise inv.InventoryError(f"{sku} es un código nuevo: elige en qué ubicación guardarlo.")
                image = (catalog.lookup(sku, fetch=False) or {}).get("image")
                inv.register_product(db, sku, name, size, loc, qty, 0, user, image_url=image, note=note, commit=False)
                row["location_id"] = loc
            row["dest"] = "bodega"
            touched.append(sku)
        doc = models.Document(
            kind="remision", number=number, supplier=payload.supplier.strip() or None, doc_date=payload.date,
            notes=" ".join(payload.notes.split()) or None,
            lines=out_lines, units=sum(r["qty"] for r in out_lines), pending=sum(r["pending"] for r in out_lines),
            mode="registro" if record else None, user_id=user.id, user_name=user.name,
        )
        db.add(doc)
        db.commit()
    except inv.InventoryError as e:
        db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{e} No entró nada de la remisión.")
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"La remisión {number} ya entró.")
    db.refresh(doc)
    products = db.query(models.Product).filter(models.Product.sku.in_(set(touched))).all() if touched else []
    owed = f" · quedaron debiendo {doc.pending}" if doc.pending else ""
    shown = "sin número" if number.startswith("SN-") else number
    background.add_task(push.notify, "docs", f"Remisión {shown}" + (f" · {doc.supplier}" if doc.supplier else ""),
                        f"{'Solo registro: ' if record else ''}Entraron {doc.units} prendas{owed} · {user.name}",
                        "/summary", f"doc-{number}", user.id)
    return schemas.DocumentResult(document=doc, products=ser.products_out(db, products))


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
