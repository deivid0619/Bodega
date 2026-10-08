"""Lo que llega al descontar una factura, empacar un pedido o anexarle la factura."""
from pydantic import BaseModel, Field

from app.modules.documentos.schemas import DocumentLineIn


class FacturaIn(BaseModel):
    number: str = Field(min_length=1, max_length=40)
    lines: list[DocumentLineIn] = Field(min_length=1)
    record_only: bool = False  # solo registro: ya se desconto por otro lado, no se toca el inventario


class PedidoIn(BaseModel):
    """Un pedido empacado antes de tener la factura: se descuenta ya."""
    lines: list[DocumentLineIn] = Field(min_length=1)
    notes: str = Field(default="", max_length=500)  # de quien es, el numero del pedido en la tienda...


class AttachIn(BaseModel):
    """La factura de un pedido: su numero, lo que trae la factura y no estaba
    en el pedido (se descuenta ahora) y lo del pedido que no va (vuelve)."""
    number: str = Field(min_length=1, max_length=40)
    deduct: list[DocumentLineIn] = Field(default_factory=list)
    returns: list[DocumentLineIn] = Field(default_factory=list)
