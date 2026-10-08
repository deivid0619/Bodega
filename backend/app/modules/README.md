# Módulos del servidor

Cada módulo tiene su carpeta con:

- `router.py`: sus rutas de la API;
- `models.py`: sus tablas;
- `schemas.py`: los datos que entran y salen;
- `service.py` (cuando tiene lógica propia).

Lo común a todos está en `app/core/`: configuración, base de datos, sesión, permisos y migraciones.

`app/models.py` y `app/schemas.py` solo reúnen las tablas y los datos de todos los módulos. Así el código puede seguir escribiendo `models.Product` o `schemas.RemisionIn`, y SQLAlchemy conoce todas las tablas.

| Módulo | Qué hace | Rutas |
|---|---|---|
| `auth` | Entrar, crear cuenta, el usuario actual y los enlaces "solo ver" (uno por persona) | `/api/auth/*` |
| `inventario` | Las prendas (un código por talla), cuánto hay en cada ubicación, movimientos, deshacer y códigos de etiqueta mal impresos | `/api/products/*`, `/api/movements/*` |
| `bodega` | El cuarto y sus muebles en 3D, las ubicaciones y el outlet | `/api/layout/*` |
| `reserva` | La bodega de reserva: guardar, escanear, llevar a la bodega o despachar | `/api/reserve/*` |
| `documentos` | Lo común a los papeles: la lista, el calendario y las fotos (dos meses) | `/api/documents`, `/calendar`, `/counts`, `/{id}/photos` |
| **`remisiones`** | Lo que llega de un proveedor (ver su README) | `POST /api/documents/remision`, `/recent-entries` |
| `facturas` | Descontar una factura, el pedido que espera su factura, anexarla o deshacerlo | `POST /api/documents/factura`, `/pedido`, `/{id}/factura`, `DELETE /{id}` |
| `conteo` | Contar una ubicación y ajustar lo que no cuadra | `POST /api/documents/conteo` |
| `despacho` | Lo que está de paso sin ser inventario (cajas, bolsas…) | `/api/parcels/*` |
| `reportes` | Qué pedir, flujo semanal, lo que no se mueve, valor, lo que más sale, exportar y datos de prueba | `/api/reports/*` |
| `catalogo` | La tienda en línea (precios, fotos y códigos parecidos) | `/api/catalog/*` |
| `avisos` | Avisos al celular y avisos para los enlaces "solo ver" | `/api/push/*`, `/api/notices/*` |

Las rutas son las mismas de antes de ordenar el código por módulos, así que la app publicada no nota el cambio.
