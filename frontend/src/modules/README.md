# Módulos de la página

```
src/
  main.jsx, App.jsx   arranque y rutas de la app
  core/               lo común: api (sesión y llamadas), AuthContext, useApi (caché y
                      sondeo), utils, locationGroups, motion, install, feedback,
                      offline (lo último que se vio, guardado para abrir sin señal) y
                      outbox (lo que se registra sin señal y se sube solo después)
  ui/                 piezas de pantalla compartidas: Sheet, Icon, Bits, Modal,
                      ToastContext, ConfirmContext, NavBar, LocationPicker, PhotoCrop,
                      PhotoZoom, StagedSteps, FromPick, NearPick, OfflineBar
  modules/<modulo>/   cada parte de la app con sus pantallas y su lógica
  styles/global.css   estilos generales (cada módulo puede traer los suyos)
```

| Módulo | Pantallas y piezas |
|---|---|
| `auth` | Entrar (`Login`), enlaces "solo ver" (`ViewLink`) |
| `bodega` | La bodega 3D (`Warehouse`, `WarehouseScene`, `WarehouseCanvas`), una ubicación (`LocationSheet`) y el editor de muebles (`EditPanel`) |
| `inventario` | Inventario, ficha de la prenda (`ProductModal`), nueva prenda, mover entre ubicaciones y detalle de un movimiento |
| `escaneo` | Escanear (`Scan`): entradas, salidas, conteo y reserva; el lector (`useBarcodeScanner`, `Viewfinder`, `barcode`) y `ScanBox` |
| **`remisiones`** | Recibir una remisión (ver su README) |
| `facturas` | Descontar una factura (leerla con la cámara: `ocr`, `facturaParser`), armar un pedido y anexar la factura |
| `documentos` | Detalle de una remisión o factura con sus fotos (`DocumentSheet`), el calendario (`DocCalendar`) y subir fotos (`docPhotos`) |
| `conteo` | Contar una ubicación (`Count`) |
| `reserva` | La reserva (`Reserve`), llevar a la bodega o despachar, buscar la prenda (`ProductSearch`: bodega, reserva y tienda con sus tallas) o agregar a mano y "Abastecimiento disponible" (`RestockHint`) |
| `despacho` | Lo que está de paso (`Passing`, `ParcelSheet`) |
| `resumen` | Resumen, su índice, el estado de la tienda y "Empezar de cero" |
| `reportes` | Reportes (`Reports`) |
| `avisos` | La campana: avisos al celular (`PushBox`, `push`), avisos para los enlaces (`Notices`) y avisos en pantalla |

Un módulo puede usar piezas de otro (por ejemplo, la remisión usa `ScanBox` de escaneo). Cada README dice cuáles usa.
