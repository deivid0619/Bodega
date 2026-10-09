# Pantallas de la remisión

"Recibir una remisión" se abre desde Escanear. Los datos, las rutas y las reglas del servidor están en `backend/app/modules/remisiones/README.md`.

## Archivos

| Archivo | Qué es |
|---|---|
| `RemisionSheet.jsx` | La hoja completa, en pasos: foto → qué llegó → dónde queda → confirmar. Si se sale a medias, queda guardada (`draft.js`). Arma las líneas y llama a `POST /api/documents/remision`. Después sube la foto y manda los avisos elegidos. |
| `PickStep.jsx` | Primer paso: tomar la foto del papel (con recorte), elegir una guardada o seguir sin foto. |
| `RefPicker.jsx` | Buscar la referencia que llegó: en la bodega, en la reserva o en la tienda en línea. También permite escribir una nueva. |
| `SplitRow.jsx` | Repartir una talla en varias ubicaciones (o una parte a la reserva): ubicación + cuántas, por parte. Lo que no se reparte va a la ubicación de la referencia. |
| `SizeRow.jsx` | Una talla: cuántas llegaron, cuántas quedaron debiendo y el código si es nueva. |
| `draft.js` | La remisión a medias: se guarda en el celular mientras se llena (la foto en IndexedDB) y se sigue al abrirla otra vez. Se borra al confirmar o con «Descartar cambios». |
| `orderSummary.js` | La orden con todas sus entregas (OPR77, OPR77#2…): qué llegó de cada talla (sumado), qué sigue faltando (lo que dijo la última entrega) y dónde quedó. **Sin pantalla.** |
| `remisionPdf.js` | El PDF de la remisión con eso (jsPDF, se carga solo al pedirlo). Se arma en el celular y se descarga; no se guarda. El botón está en el detalle de la remisión (`documentos/DocumentSheet.jsx`). |
| `refs.js` | La lógica sin pantalla: las referencias conocidas, las tallas de la plantilla y las filas. **Se puede llevar tal cual a otra app.** |
| `remisiones.css` | Los estilos propios de la remisión (clases `.rem-*`). |

## Qué usa de afuera

| De | Qué |
|---|---|
| `core/` | `api` (llamadas a la API con la sesión), `useApi` (prendas, reserva y el plano con caché), `utils`, `locationGroups`, `feedback` (el pitido al escanear). |
| `ui/` | `Sheet`, `Icon`, `Bits` (`Stepper`, `plural`), `ToastContext`, `PhotoCrop` (recortar), `PhotoZoom` (foto en grande), `LocationPicker` (elegir ubicación buscando), `NearPick` (código parecido de la tienda). |
| `modules/escaneo` | `ScanBox` (escanear lo que llegó). |
| `modules/facturas` | `cleanCode` (limpiar un código escrito o leído). |
| `modules/documentos` | `saveDocPhoto` (subir la foto ya achicada). |
| `modules/avisos` | "Avisar a" (`useNotifyPick`, `sendNotice`, `itemsText`). |

Estilos generales (botones, campos, hojas, colores de Pigmalion): `src/styles/global.css`.

## Llevarla a otra app

- **React:** se copia esta carpeta junto con las piezas de `ui/` de la tabla de arriba. En `core/api.js` se cambia la dirección del servidor y cómo se manda la sesión.
- **Otra tecnología:** el flujo y las reglas están en el README del servidor. `refs.js` muestra cómo se arman las referencias y las tallas.
