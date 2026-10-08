"""Todas las tablas de la base, cada una en su modulo. El codigo las usa como
models.Product, models.Document... y SQLAlchemy necesita conocerlas todas
para crear la base."""
from app.core.database import Base, now  # noqa: F401
from app.core.models import AppSetting  # noqa: F401
from app.modules.auth.models import User, ViewLink  # noqa: F401
from app.modules.bodega.models import RoomConfig, Element  # noqa: F401
from app.modules.inventario.models import Product, Stock, Movement, CodeAlias  # noqa: F401
from app.modules.documentos.models import Document  # noqa: F401
from app.modules.despacho.models import Parcel  # noqa: F401
from app.modules.reserva.models import ReserveItem  # noqa: F401
from app.modules.avisos.models import PushSubscription, Notice  # noqa: F401
