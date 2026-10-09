"""Los documentos guardados: la lista (con busqueda), cuantos hay, el
calendario del Resumen y las fotos del papel (dos meses, como prueba)."""
import uuid
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models, schemas
from app.core.database import get_db
from app.core.deps import get_current_user
from app.modules.documentos import photo_store
from app.modules.inventario import serializers as ser
from app.modules.documentos.service import fold, local_midnight, norm_number, purge_in_background

router = APIRouter(prefix="/api/documents", tags=["documentos"])


@router.get("/photo-store", response_model=schemas.PhotoStoreOut)
def photo_store_status(_: models.User = Depends(get_current_user)):
    """Si las fotos se estan guardando bien (en el Resumen)."""
    return photo_store.status()


@router.post("/{doc_id}/photos", response_model=schemas.DocumentOut)
async def add_photo(doc_id: int, request: Request, db: Session = Depends(get_db),
                    _: models.User = Depends(get_current_user)):
    """Guarda la foto de la remision o la factura (la app la manda ya
    achicada, como JPG). Se guarda dos meses y despues se borra sola."""
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
    purge_in_background()  # de paso, las de hace mas de dos meses
    return doc


@router.delete("/{doc_id}/photos/{index}", response_model=schemas.DocumentOut)
async def delete_photo(doc_id: int, index: int, db: Session = Depends(get_db),
                       _: models.User = Depends(get_current_user)):
    """Quitar una foto que se subio por error (otra hoja, borrosa, repetida).
    Se borra del almacenamiento; el documento y lo registrado no cambian."""
    doc = db.get(models.Document, doc_id)
    photos = list((doc.photos or []) if doc else [])
    if not 0 <= index < len(photos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está.")
    gone = photos.pop(index)
    try:
        await run_in_threadpool(photo_store.delete, [gone["path"]])
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo borrar la foto. Intenta otra vez.")
    doc.photos = photos
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{doc_id}/photos/{index}")
def get_photo(doc_id: int, index: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """La foto (para verla o descargarla). Solo con sesion: nunca es publica."""
    doc = db.get(models.Document, doc_id)
    photos = (doc.photos or []) if doc else []
    if not 0 <= index < len(photos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan dos meses.")
    p = photos[index]
    try:
        data = photo_store.get(p["path"])
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo traer la foto. Intenta otra vez.")
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa foto ya no está: se guardan dos meses.")
    return Response(content=data, media_type=p.get("type") or "image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/counts", response_model=schemas.DocumentCountsOut)
def document_counts(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Cuantas remisiones y facturas hay guardadas (el apartado del Resumen)."""
    rows = dict(db.query(models.Document.kind, func.count(models.Document.id)).group_by(models.Document.kind).all())
    waiting = db.query(func.count(models.Document.id)).filter(models.Document.kind == "factura",
                                                             models.Document.status == "espera").scalar()
    return schemas.DocumentCountsOut(remision=rows.get("remision", 0), factura=rows.get("factura", 0), espera=waiting or 0)


@router.get("/calendar", response_model=list[schemas.DocumentDayOut])
def documents_calendar(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                       db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """El calendario del Resumen: lo que entro con remision y lo que salio con
    factura cada dia del mes (el dia en que se registro, hora de Colombia)."""
    y, m = map(int, month.split("-"))
    start, end = local_midnight(y, m), local_midnight(y + (m == 12), m % 12 + 1)
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


def _haystack(d: models.Document) -> str:
    """Donde se busca: numero, proveedor, notas, quien la registro y cada
    prenda (nombre, talla y codigo)."""
    parts = [d.number, d.supplier or "", d.notes or "", d.user_name or ""]
    parts += [f"{l.get('name') or ''} {l.get('size') or ''} {l.get('sku') or ''}" for l in (d.lines or [])]
    return fold(" | ".join(parts))


@router.get("", response_model=list[schemas.DocumentOut])
def list_documents(kind: Optional[Literal["factura", "remision", "conteo"]] = None, number: Optional[str] = None,
                   base: Optional[str] = None, prefix: Optional[str] = None, limit: int = Query(default=30, le=200),
                   search: Optional[str] = Query(default=None, alias="q", max_length=60),
                   before: Optional[int] = None,
                   day: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
                   month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
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
            start = local_midnight(*map(int, day.split("-")))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Fecha inválida.")
        q = q.filter(models.Document.created_at >= start, models.Document.created_at < start + timedelta(days=1))
    if month:
        # las de un mes (el calendario en grande), hora de Colombia
        y, m = map(int, month.split("-"))
        q = q.filter(models.Document.created_at >= local_midnight(y, m),
                     models.Document.created_at < local_midnight(y + (m == 12), m % 12 + 1))
    term = fold(" ".join((search or "").split()))
    if term:
        # se busca aqui y no en la base: asi da igual si se escribe con
        # tildes, sin ellas o en minuscula (SQLite y Postgres no lo hacen igual)
        compact = term.replace(" ", "")
        found = []
        for d in q.yield_per(200):
            if term in _haystack(d) or compact in fold(d.number):
                found.append(d)
                if len(found) >= limit:
                    break
        return found
    if number:
        q = q.filter(models.Document.number == norm_number(number))
    if prefix:
        # conteos de una ubicacion: P-D1@...
        q = q.filter(models.Document.number.startswith(prefix.upper(), autoescape=True))
    if base:
        # todas las entregas de una misma orden: OPR123, OPR123#2, OPR123#3...
        b = norm_number(base).split("#")[0]
        q = q.filter(or_(models.Document.number == b,
                         models.Document.number.startswith(b + "#", autoescape=True)))
    return q.limit(limit).all()
