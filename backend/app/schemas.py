"""Esquemas Pydantic: forma de los datos que entran y salen de la API."""
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from .layout_logic import DISPATCH

ElementType = Literal["bins", "shelf", "rack", "boxes", "table", "ladder", "balloons"]
MovementType = Literal["in", "out", "set"]

# Las fechas se guardan en UTC. SQLite (local) las devuelve sin zona y el
# navegador las tomaria como hora de Colombia: se marcan como UTC al salir.
UtcDatetime = Annotated[datetime, AfterValidator(lambda d: d if d.tzinfo else d.replace(tzinfo=timezone.utc))]


# ---------- auth ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    role: str


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=120)
    invite_code: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- layout ----------
class RoomOut(BaseModel):
    width: float
    depth: float


class RoomIn(BaseModel):
    width: float = Field(ge=4, le=24)
    depth: float = Field(ge=4, le=24)


class LocationOut(BaseModel):
    id: str
    kind: str
    name: str
    # canastas de la mesa: nivel (1 = arriba) y pila, para que el 3D las dibuje
    level: Optional[int] = None
    pile: Optional[int] = None
    outlet: bool = False  # lo que hay aqui no cuenta en el inventario


class ElementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: ElementType
    code: Optional[str] = None
    x: float
    z: float
    rot: int
    y0: float = 0
    params: dict[str, Any]
    locations: list[LocationOut] = []
    name: str


class ElementCreateIn(BaseModel):
    type: ElementType
    x: float = 0
    z: float = 0
    rot: int = 0


class ElementUpdateIn(BaseModel):
    type: Optional[Literal["bins", "boxes"]] = None  # canastas <-> cajas
    code: Optional[str] = None
    swap: bool = False  # si la letra ya la tiene otro mueble, intercambiarlas
    x: Optional[float] = None
    z: Optional[float] = None
    rot: Optional[int] = None
    y0: Optional[float] = None
    params: Optional[dict[str, Any]] = None


class LocationOutletIn(BaseModel):
    outlet: bool  # una sola canasta, nivel o barra: lo que hay ahi no cuenta


class LayoutOut(BaseModel):
    room: RoomOut
    elements: list[ElementOut]


# ---------- products ----------
class StockOut(BaseModel):
    location_id: str
    location_name: str
    qty: int


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    sku: str
    name: str
    size: str
    location_id: str
    location_name: str
    qty: int
    min_qty: int
    image_url: Optional[str] = None
    demo: bool
    out_30d: int = 0
    stock: list[StockOut] = []  # cuanto hay en cada ubicacion (la principal primero)
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ProductCreateIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    size: str = ""
    location_id: str
    qty: int = Field(ge=0, default=0)
    min_qty: int = Field(ge=0, default=0)
    image_url: Optional[str] = None
    label_code: Optional[str] = Field(default=None, max_length=64)  # la etiqueta, si traia el codigo mal


class AliasIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)  # lo que dice la etiqueta
    sku: str = Field(min_length=1, max_length=64)  # el codigo bueno


class ProductUpdateIn(BaseModel):
    name: Optional[str] = None
    size: Optional[str] = None
    min_qty: Optional[int] = Field(default=None, ge=0)
    location_id: Optional[str] = None
    image_url: Optional[str] = None


# ---------- movements ----------
class MovementIn(BaseModel):
    sku: str
    type: MovementType
    qty: int = Field(ge=0)
    location_id: Optional[str] = None  # sin elegir: la ubicacion principal (o donde haya, en salidas)


class MoveIn(BaseModel):
    from_location: str
    to_location: str
    qty: int = Field(gt=0)


class MovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sku: str
    type: str
    qty: int
    before: int
    after: int
    location_id: str
    location_name: str
    to_location_id: Optional[str] = None
    to_location_name: Optional[str] = None
    note: Optional[str] = None
    product_name: str
    product_size: str
    user_name: str
    demo: bool
    created_at: UtcDatetime


class MovementResult(BaseModel):
    product: ProductOut
    movement: MovementOut  # el ultimo; una salida repartida entre ubicaciones trae varios en "movements"
    movements: list[MovementOut] = []


# ---------- documentos (factura / remision) ----------
class DocumentLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)
    location_id: Optional[str] = None  # sin elegir: la principal y luego donde haya


class FacturaIn(BaseModel):
    number: str = Field(min_length=1, max_length=40)
    lines: list[DocumentLineIn] = Field(min_length=1)


class RemisionLineIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)  # la remision trae la referencia, no el codigo
    size: str = Field(default="", max_length=20)
    sku: Optional[str] = Field(default=None, max_length=64)  # sin codigo: entra a la reserva
    qty: int = Field(ge=0, default=0)  # lo que llego y se conto
    pending: int = Field(ge=0, default=0)  # lo que el proveedor quedo debiendo
    # bodega: donde se guarda esta referencia; sin elegir, la de toda la remision
    # o, si tampoco, donde ya esta cada talla
    location_id: Optional[str] = Field(default=None, max_length=32)


class RemisionIn(BaseModel):
    number: str = Field(default="", max_length=40)  # algunas no lo traen: se le pone uno automatico
    supplier: str = Field(default="", max_length=120)
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    destination: Literal["bodega", "reserva", "despacho"] = "bodega"  # despacho: de paso, sale en unos dias
    location_id: Optional[str] = None  # bodega: sin elegir, la ubicacion principal de cada talla
    notes: str = Field(default="", max_length=500)  # lo demas que diga el papel
    lines: list[RemisionLineIn] = Field(min_length=1)


class CountLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(ge=0)  # lo que se conto en la ubicacion


class CountIn(BaseModel):
    location_id: str = Field(min_length=1, max_length=32)
    lines: list[CountLineIn] = Field(min_length=1)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    number: str
    units: int
    pending: int = 0
    supplier: Optional[str] = None
    doc_date: Optional[str] = None
    notes: Optional[str] = None
    lines: list[dict[str, Any]]
    user_name: str
    created_at: UtcDatetime
    photo_count: int = 0  # fotos del papel guardadas (prueba)
    photos_until: Optional[UtcDatetime] = None  # hasta cuando se guardan


class PhotoStoreOut(BaseModel):
    """Donde se guardan las fotos de remisiones y facturas, y si funciona."""
    ok: bool
    where: Literal["supabase", "local", "none"]
    days: int
    detail: str


class DocumentCountsOut(BaseModel):
    """Cuantas remisiones y facturas hay guardadas, para el Resumen."""
    remision: int = 0
    factura: int = 0


class DocumentDayOut(BaseModel):
    """Un dia del calendario (hora de Colombia): lo que entro con remision y
    lo que salio con factura."""
    day: str  # AAAA-MM-DD
    remisiones: int = 0
    units_in: int = 0
    facturas: int = 0
    units_out: int = 0


class DocumentResult(BaseModel):
    document: DocumentOut
    products: list[ProductOut]


# ---------- bodega de reserva ----------
class ReserveItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sku: Optional[str] = None
    name: str
    size: str
    qty: int
    image_url: Optional[str] = None
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ReserveItemCreateIn(BaseModel):
    sku: Optional[str] = None
    name: str = Field(min_length=1, max_length=200)
    size: str = ""
    qty: int = Field(ge=0, default=0)
    image_url: Optional[str] = Field(default=None, max_length=500)


class ReserveScanIn(BaseModel):
    """Una etiqueta escaneada para la reserva: se identifica sola."""
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0, le=9999, default=1)


class ReserveIdentifyOut(BaseModel):
    sku: str
    name: str
    size: str
    image: Optional[str] = None
    source: Literal["bodega", "tienda", "reserva"]  # de donde salio el nombre
    in_reserve: int = 0  # cuantas hay ya guardadas de ese codigo


class ReserveScanOut(BaseModel):
    item: ReserveItemOut
    added: int
    created: bool  # el codigo no estaba en la reserva
    source: Literal["bodega", "tienda", "reserva"]


class ReserveItemUpdateIn(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    size: Optional[str] = None
    qty: Optional[int] = Field(default=None, ge=0)


class ReserveReturnIn(BaseModel):
    """Devolver a la reserva lo que esta en la bodega (o en Despacho)."""
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)
    location_id: str = "DESPACHO"  # de donde sale


class ReserveDispatchIn(BaseModel):
    """Despachar desde la reserva: sale empacado sin pasar por la bodega."""
    qty: int = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=60)  # pedido, cliente, guia...
    sku: Optional[str] = None  # solo si la referencia todavia no tiene codigo


class ReserveTransferIn(BaseModel):
    qty: int = Field(gt=0)
    location_id: str
    sku: Optional[str] = None  # obligatorio solo si el item de reserva todavia no tiene sku


class ReserveTransferResult(BaseModel):
    reserve: ReserveItemOut  # con qty 0 si se acabo (y ya no esta en la reserva)
    product: ProductOut
    movement: Optional[MovementOut] = None  # la entrada a la bodega, como en un escaneo
    movements: list[MovementOut] = []


# ---------- reportes ----------
class NeedOut(BaseModel):
    product: ProductOut
    order_qty: int  # cuanto pedir al proveedor (0: lo cubre la reserva)
    in_reserve: int = 0  # cuanto hay guardado en la reserva


class RestockOut(BaseModel):
    reserve: ReserveItemOut
    product: ProductOut
    suggest: int  # cuantas llevar a la bodega


class WeekFlowOut(BaseModel):
    week: str  # lunes de la semana, AAAA-MM-DD
    in_: int = Field(alias="in", serialization_alias="in")
    out: int

    model_config = ConfigDict(populate_by_name=True)


class DeadOut(BaseModel):
    product: ProductOut
    last_out: Optional[UtcDatetime] = None  # None: nunca ha salido


class CatalogItemOut(BaseModel):
    sku: str
    name: str
    size: str
    price: int
    image: Optional[str] = None


class CatalogStatusOut(BaseModel):
    enabled: bool
    codes: int  # cuantos codigos de la tienda hay en memoria
    error: Optional[str] = None  # por que fallo la ultima vez (si fallo)
    ok_at: Optional[float] = None  # cuando se leyo bien por ultima vez (segundos epoch)


class CatalogNearOut(CatalogItemOut):
    in_bodega: bool = False  # ese codigo bueno ya esta registrado en la bodega


class CatalogSizeOut(BaseModel):
    size: str
    sku: str
    price: int


class CatalogProductOut(BaseModel):
    name: str
    image: Optional[str] = None
    sizes: list[CatalogSizeOut]


class ValueOut(BaseModel):
    available: bool  # se pudo leer la tienda
    value: int  # bodega: prendas x precio de la tienda
    units_priced: int
    units_total: int
    reserve_value: int
    reserve_units_priced: int
    reserve_units_total: int


class DispatchLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    qty: int = Field(gt=0)


class DispatchSendIn(BaseModel):
    """Lo de paso que ya salio empacado: se descuenta de Despacho."""
    lines: list[DispatchLineIn] = Field(min_length=1)
    note: Optional[str] = Field(default=None, max_length=60)  # pedido, cliente, guia...


class DispatchSendOut(BaseModel):
    units: int
    lines: int


class DispatchOut(BaseModel):
    product: ProductOut
    qty: int  # cuantas hay de paso
    since: Optional[UtcDatetime] = None  # cuando llego la ultima
    # la remision con que llego la ultima, y lo que se anoto en ella
    doc_number: Optional[str] = None
    doc_supplier: Optional[str] = None
    doc_notes: Optional[str] = None


# ---------- de paso sin ser inventario (cajas sueltas, canastas...) ----------
ParcelKind = Literal["caja", "canasta", "bolsa", "otro"]


class ParcelIn(BaseModel):
    kind: ParcelKind = "caja"
    label: str = Field(default="", max_length=60)  # "otro": que es
    qty: int = Field(default=1, ge=1, le=999)
    owner: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=500)
    location_id: str = Field(default=DISPATCH, min_length=1, max_length=32)


class ParcelUpdateIn(BaseModel):
    kind: Optional[ParcelKind] = None
    label: Optional[str] = Field(default=None, max_length=60)
    qty: Optional[int] = Field(default=None, ge=1, le=999)
    owner: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=500)
    location_id: Optional[str] = Field(default=None, min_length=1, max_length=32)


class ParcelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    label: Optional[str] = None
    qty: int
    owner: Optional[str] = None
    notes: Optional[str] = None
    location_id: str
    location_name: str = ""
    user_id: Optional[int] = None
    user_name: str
    created_at: UtcDatetime
    done_at: Optional[UtcDatetime] = None
    done_by: Optional[str] = None


class TopOut(BaseModel):
    sku: str
    name: str
    size: str
    qty_out: int
