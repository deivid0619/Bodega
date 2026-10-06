"""Catalogo de la tienda: buscar un codigo o una referencia para llenar
nombre, talla y foto, y completar las fotos de lo que ya esta registrado."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import catalog, models, schemas
from ..database import get_db
from ..deps import get_current_user, require_admin

router = APIRouter(prefix="/api/catalog", tags=["catalogo de la tienda"])


@router.get("/lookup/{sku}", response_model=schemas.CatalogItemOut)
def lookup(sku: str, _: models.User = Depends(get_current_user)):
    hit = catalog.lookup(sku)
    if not hit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese código no está en la tienda.")
    return hit


@router.get("/near/{sku}", response_model=list[schemas.CatalogItemOut])
def near(sku: str, _: models.User = Depends(get_current_user)):
    """Lo que hay en la tienda con un codigo casi igual (para elegir)."""
    return catalog.near(sku)


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
