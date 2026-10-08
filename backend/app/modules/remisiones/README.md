# Módulo de remisiones

Registra la mercancía que llega de un proveedor con su remisión (el papel), ya contada. La remisión se aplica **completa o nada**: si una línea falla, no entra nada.

- **Servidor:** este módulo (`router.py`, `schemas.py`).
- **Pantallas:** `frontend/src/modules/remisiones/` (ver su README).

## Qué hace

1. Se toma la foto del papel (opcional) y se recorta.
2. Se agrega lo que llegó, referencia por referencia y talla por talla. Se puede escanear la etiqueta, buscar en la bodega o en la tienda en línea, o escribirlo.
3. Se elige **dónde queda**:
   - **Bodega:** cada referencia en su ubicación. Una talla se puede repartir, por ejemplo 5 a la bodega y 15 a la reserva.
   - **Reserva:** todo queda guardado aparte.
   - **De paso (despacho):** llega solo para despacharse en unos días.
   - **Registro:** solo se guarda el papel; lo que llegó ya se había entrado escaneando y no se suma otra vez.
4. Se confirma. Entra todo junto, queda el documento y la foto se guarda dos meses como prueba.

## Rutas (API)

Todas requieren sesión (`Authorization: Bearer <token>`). La cuenta "solo ver" no puede registrar.

### `POST /api/documents/remision`

Recibe (`RemisionIn`):

```json
{
  "number": "OPR 1234",
  "supplier": "Taller",
  "date": "2026-10-07",
  "destination": "bodega",
  "location_id": null,
  "notes": "Llegó parcial, falta el color negro",
  "lines": [
    { "name": "CHAQUETA TOURING GRIS", "size": "M", "sku": "D-TRG03M", "qty": 5, "pending": 0, "location_id": "P-A2" },
    { "name": "CHAQUETA TOURING GRIS", "size": "M", "sku": "D-TRG03M", "qty": 15, "pending": 0, "to_reserve": true },
    { "name": "CHAQUETA TOURING GRIS", "size": "L", "sku": "D-TRG03L", "qty": 4, "pending": 2 }
  ]
}
```

| Campo | Qué es |
|---|---|
| `number` | Número del papel. Si viene vacío se pone uno automático `SN-mmdd-HHMMSS`. Otra entrega de la misma orden lleva `#2`, `#3` (`OPR123#2`). |
| `destination` | `bodega` \| `reserva` \| `despacho` \| `registro`. |
| `lines[].sku` | Código de la etiqueta. Sin código, esa talla queda en la reserva hasta que se le ponga. |
| `lines[].qty` | Lo que llegó y se contó. |
| `lines[].pending` | Lo que el proveedor quedó debiendo: **solo se anota, nunca se suma**. |
| `lines[].location_id` | Bodega: dónde se guarda esa referencia. Sin elegir, donde ya está cada talla. Si la talla es nueva, con sus otras tallas. |
| `lines[].to_reserve` | Bodega: esta parte de la talla va a la reserva (repartir). |

Responde `201` con (`DocumentResult`):

```json
{
  "document": {
    "id": 12, "kind": "remision", "number": "OPR1234", "units": 24, "pending": 2,
    "supplier": "Taller", "doc_date": "2026-10-07", "notes": "…", "mode": null,
    "lines": [ { "name": "…", "size": "M", "sku": "D-TRG03M", "qty": 5, "pending": 0, "dest": "bodega", "location_id": "P-A2" } ],
    "user_name": "Administrador", "created_at": "2026-10-07T19:41:00Z", "photo_count": 0
  },
  "products": [ /* cómo quedaron las prendas que se tocaron */ ]
}
```

Errores:

- **`409`:** esa remisión ya entró.
- **`400`:** no tiene cantidades, la ubicación no existe, falta elegir dónde guardar un código nuevo, o de paso sin código. En ese caso **no entró nada**.

### `GET /api/documents/recent-entries?skus=A,B&days=3`

Muestra lo que entró de esos códigos escaneando o a mano (sin remisión) en los últimos días. La pantalla lo usa para avisar: "esto ya entró: guárdala como solo registro".

### Rutas compartidas con los demás documentos (módulo `documentos`)

| Ruta | Para qué |
|---|---|
| `GET /api/documents?kind=remision&q=…&before=…&day=AAAA-MM-DD` | La lista, con búsqueda y páginas. |
| `POST /api/documents/{id}/photos` | Sube la foto del papel: el cuerpo es la imagen JPG, PNG o WebP, ya achicada. |
| `GET /api/documents/{id}/photos/{i}` | Ver o descargar una foto. Solo con sesión. |
| `GET /api/documents/calendar?month=AAAA-MM` | Lo que entró y salió cada día. |

## Reglas importantes

- **Todo o nada:** cada línea se aplica en la misma transacción. Si una falla, se deshace todo.
- **No dos veces:** la llave única de la tabla es (tipo, número). Una remisión repetida responde `409`.
- **Se agrupa:** la misma talla repetida se suma si va al mismo lugar. La llave es nombre, talla, código, ubicación y si va a la reserva.
- **Etiquetas mal impresas:** el código se corrige con la tabla `code_aliases` (`resolve_sku`).
- **Código nuevo:** se registra la prenda con la foto de la tienda si la hay. Va a la ubicación elegida o con sus otras tallas; si no hay ninguna, se pide elegir.
- **Historial:** cada entrada deja un movimiento con la nota `Remisión <número>`. Así se sabe de qué papel vino cada prenda.
- **Avisos:** el equipo recibe el aviso de siempre. Además, quien registra puede mandarle el aviso a las personas de los enlaces "solo ver" (`POST /api/notices`).

## Qué usa de los otros módulos

| Módulo | Qué |
|---|---|
| `inventario` | `resolve_sku`, `apply_movement` (entrada a una ubicación), `register_product` (código nuevo), `add_to_reserve`, `location_ids` |
| `documentos` | La tabla `documents`, `norm_number`, `already`, y las fotos (`photo_store`). |
| `catalogo` | `lookup` para la foto de un código nuevo. |
| `bodega` | `DISPATCH`, la ubicación virtual de lo que está de paso. |
| `avisos` | `push.notify`. |

Tablas que toca: `documents`, `products`, `stock`, `movements`, `reserve_items` y `code_aliases` (solo la lee).

## Cómo llevarlo a otra app

- **Si la otra app también es Python/FastAPI:** se copian `remisiones/` y `documentos/`, y se conectan las funciones de inventario de la tabla de arriba con las de esa app.
- **Si es otra tecnología:** lo más simple es que esa app **llame a estas rutas** (son JSON). La otra opción es rehacerla siguiendo las reglas de arriba. Lo mínimo que hay que respetar:
  - todo o nada;
  - el número único;
  - lo pendiente solo se anota;
  - lo que no tiene código va a la reserva.
- **Solo las pantallas:** ver `frontend/src/modules/remisiones/README.md`.
