"""Los datos que entran y salen de la API, cada uno en su modulo. El codigo
los usa como schemas.ProductOut, schemas.RemisionIn..."""
from app.core.types import UtcDatetime  # noqa: F401
from app.modules.auth.schemas import UserOut, RegisterIn, ViewKeyIn, ViewLinkIn, ViewLinkOut, ViewLinkNotifyIn, LoginIn, Token  # noqa: F401
from app.modules.avisos.schemas import RecipientOut, NoticeIn, NoticeOut  # noqa: F401
from app.modules.bodega.schemas import ElementType, RoomOut, RoomIn, LocationOut, ElementOut, ElementCreateIn, ElementUpdateIn, LocationOutletIn, LayoutOut  # noqa: F401
from app.modules.inventario.schemas import MovementType, StockOut, ProductOut, ProductCreateIn, AliasIn, ProductUpdateIn, MovementIn, MoveIn, MovementOut, MovementResult  # noqa: F401
from app.modules.documentos.schemas import DocumentLineIn, DocumentOut, PhotoStoreOut, DocumentCountsOut, DocumentDayOut, DocumentResult  # noqa: F401
from app.modules.facturas.schemas import FacturaIn, PedidoIn, AttachIn  # noqa: F401
from app.modules.remisiones.schemas import RemisionLineIn, RemisionIn, RecentEntryOut  # noqa: F401
from app.modules.conteo.schemas import CountLineIn, CountIn  # noqa: F401
from app.modules.reserva.schemas import ReserveItemOut, ReserveItemCreateIn, ReserveScanIn, ReserveIdentifyOut, ReserveScanOut, ReserveItemUpdateIn, ReserveReturnIn, ReserveDispatchIn, ReserveTransferIn, ReserveTransferResult, RestockOut  # noqa: F401
from app.modules.reportes.schemas import NeedOut, WeekFlowOut, DeadOut, ValueOut, TopOut  # noqa: F401
from app.modules.catalogo.schemas import CatalogItemOut, CatalogStatusOut, CatalogNearOut, CatalogSizeOut, CatalogProductOut  # noqa: F401
from app.modules.despacho.schemas import DispatchLineIn, DispatchSendIn, DispatchSendOut, DispatchOut, ParcelKind, ParcelIn, ParcelUpdateIn, ParcelOut  # noqa: F401
