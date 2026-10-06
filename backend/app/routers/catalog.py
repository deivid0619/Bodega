"""Catalogo de la tienda: buscar un codigo o una referencia para llenar
nombre, talla y foto, y completar las fotos de lo que ya esta registrado."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import catalog, models, schemas
from .. import inventory_service as inv
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/catalog", tags=["catalogo de la tienda"])


@router.get("/lookup/{sku}", response_model=schemas.CatalogItemOut)
def lookup(sku: str, _: models.User = Depends(get_current_user)):
    hit = catalog.lookup(sku)
    if not hit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está en la tienda.")
    return hit


@router.get("/status", response_model=schemas.CatalogStatusOut)
def store_status(_: models.User = Depends(get_current_user)):
    """Si la conexion con la tienda esta bien: de ahi salen nombres, tallas,
    fotos y los codigos para comparar."""
    if not catalog.status()["codes"]:
        catalog.items()  # recien despierto: se lee ya
    return catalog.status()


@router.post("/refresh", response_model=schemas.CatalogStatusOut)
def store_refresh(_: models.User = Depends(get_current_user)):
    return catalog.refresh()


@router.get("/near/{sku}", response_model=list[schemas.CatalogNearOut])
def near(sku: str, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Codigos casi iguales al de una etiqueta (que puede venir mal impresa):
    los de la tienda y los que ya estan registrados en la bodega."""
    code = "".join(sku.upper().split())
    out = [{**it, "in_bodega": db.get(models.Product, it["sku"]) is not None} for it in catalog.near(code)]
    seen = {o["sku"] for o in out}
    if len(code) >= 6:
        for p in db.query(models.Product).filter(models.Product.sku.like(f"%{code[-2:]}")).all():
            if p.sku not in seen and catalog.close_codes(p.sku, code):
                out.append({"sku": p.sku, "name": p.name, "size": p.size, "price": 0, "image": p.image_url, "in_bodega": True})
    return out[:4]


@router.post("/alias", status_code=status.HTTP_204_NO_CONTENT)
def save_alias(payload: schemas.AliasIn, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """La etiqueta `code` viene con el codigo mal: es `sku`. Desde ahora, al
    escanearla se usa el codigo bueno."""
    inv.save_alias(db, payload.code, payload.sku)
    db.commit()


@router.get("/search", response_model=list[schemas.CatalogProductOut])
def search(q: str = Query(min_length=2, max_length=80), limit: int = Query(default=8, ge=1, le=20),
           _: models.User = Depends(get_current_user)):
    return catalog.search(q, limit)


@router.post("/sync-images")
def sync_images(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    """Pone la foto de la tienda a las prendas registradas que no tienen foto."""
    cat = catalog.items()
    if not cat:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "No se pudo leer la tienda. Revisa la conexión e intenta de nuevo.")
    updated = 0
    for p in db.query(models.Product).filter(models.Product.image_url.is_(None)).all():
        hit = cat.get(p.sku)
        if hit and hit["image"]:
            p.image_url = hit["image"]
            updated += 1
    db.commit()
    return {"updated": updated}
