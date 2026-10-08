# Bodega

Sistema de inventario para la bodega: distribución de la
bodega en 3D (armada a partir del recorrido en video), escaneo de códigos
para entradas/salidas/conteos, pedidos sugeridos y editor de la
distribución (canastas, estanterías, percheros, cajas). Pensado para que
varias personas lo usen al mismo tiempo desde el celular.

Este proyecto reemplaza el prototipo que vivía dentro de una conversación
de Claude (guardado en `localStorage` del navegador, sin usuarios, sin
cámara confiable) por una aplicación real con base de datos compartida y
cuentas por persona.

## Qué hace

- **Bodega 3D**: la distribución real (percheros, canastas, estanterías).
  Al tocar una ubicación se ve lo que hay, con «Escanear aquí» y «Contar».
- **Escanear**: entradas, salidas y conteos con la cámara, un lector USB o
  Bluetooth, o a mano. Un código nuevo se llena solo con el nombre, la
  talla, la foto y el precio de la tienda: el código de la etiqueta es el
  mismo de pigmalionmoto.com.
- **Una prenda en varias ubicaciones**, con traslados entre ellas.
- **Recibir una remisión**: la foto de la orden queda a la vista y se cuenta
  por talla lo que llegó. Va a la bodega, a la reserva o de paso, con notas,
  los pendientes del proveedor y las entregas parciales de una misma orden.
- **Descontar una factura**: foto de la factura impresa. La app lee los
  códigos y las cantidades en el mismo celular (Tesseract), se revisa y se
  descuenta todo junto. La misma factura no se aplica dos veces.
- **De paso**: lo que entra solo para despacharse y no es inventario. Las
  prendas con código quedan en Despacho y salen primero. Las cajas sueltas,
  canastas o bolsas se anotan con de quién son y qué hacer, y salen de la
  lista con «Ya salió».
- **Reserva**: mercancía guardada aparte, con la lista «Para llevar a la
  bodega» (lo agotado o en su mínimo que hay guardado).
- **Inventario**: cada referencia con lo que hay en la bodega, lo guardado en
  la reserva y el total de las dos.
- **Conteo por ubicación**: muestra lo que falta y lo que sobra, y corrige
  solo esa ubicación.
- **Resumen y reportes**:
  - por reponer (sin pedir lo que ya está en la reserva)
  - lo que más sale
  - entradas y salidas por semana
  - lo que no se mueve
  - valor a precio de tienda
  - historial y respaldo en CSV
- **Avisos al celular**, aunque la app esté cerrada. Cada persona elige
  cuáles quiere: entradas, salidas, conteos, bajo mínimo, y facturas y
  remisiones.
- **Empezar de cero** (administrador): deja la bodega vacía para empezar con
  los datos reales, después de descargar un respaldo.

## Arquitectura

```
frontend (React + Vite + Three.js)  →  backend (FastAPI)  →  PostgreSQL
        Netlify / Vercel / Render         Render / Railway     Supabase / Render
```

- **Ordenado por módulos** (remisiones, facturas, inventario, bodega,
  reserva, avisos...): cada módulo tiene su carpeta en el servidor
  (`backend/app/modules/`) y en la página (`frontend/src/modules/`), con
  un README. El de remisiones explica sus datos, rutas y reglas para
  llevarlo a otra app.
- **Backend**: FastAPI + SQLAlchemy + JWT. Mismo stack que Turify.
  - `modules/bodega/service.py`: agregar/mover/redimensionar/borrar muebles,
    protegiendo el inventario (nunca deja una prenda con existencias sin
    ubicación).
  - `modules/inventario/service.py`: entradas, salidas, conteos y deshacer, con
    `SELECT ... FOR UPDATE` para que dos personas escaneando el mismo
    código al mismo tiempo no se pisen los datos.
  - `modules/bodega/logic.py`: traduce cada mueble a sus ubicaciones concretas
    (p. ej. la pared de canastas C con 9 columnas y 8 filas → 72
    ubicaciones `C-1-1` … `C-8-9`). El frontend nunca recalcula esto por su
    cuenta: siempre usa los nombres e IDs que devuelve `GET /api/layout`,
    así que backend y visor 3D no se pueden desincronizar.
- **Frontend**: React + Vite. El visor 3D (`src/modules/bodega/WarehouseScene.js`)
  es una clase de Three.js aislada de React; React solo le pasa datos
  (`setLayout`, `setProducts`) y escucha eventos de toque/arrastre.
  Los datos compartidos (inventario, movimientos, pedidos) se refrescan
  con sondeo (polling) cada 4-6 segundos — ver "Limitaciones" abajo.
- **Base de datos**: SQLite por defecto (desarrollo), Postgres en
  producción (Supabase funciona igual que en Turify).

## Requisitos

- Python 3.12+, Node 20+, y opcionalmente Docker.

## Arrancar todo con un comando (Docker)

```bash
docker compose up --build
```

- Frontend: http://localhost:5190
- Backend: http://localhost:8090/api/health (puertos propios de Bodega, para
  no chocar con otros proyectos de tu máquina — Turify usa 5173, 5180, 8000 y
  8001; el frontend sigue hablando con el backend por dentro de la red de
  Docker, así que esto no le afecta)
- Postgres queda arriba en el puerto 5433 (usuario/clave `bodega`/`bodega`).
  Se publica en 5433 y no 5432 por la misma razón que el backend: evitar
  choques con otros Postgres que ya tengas corriendo, como el de Turify.

La primera vez que arranca el backend, crea automáticamente:
- Un usuario **administrador**: correo `admin@bodega.app`, clave
  `cambiar123` (cámbialos con las variables `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  antes del primer arranque).
- La distribución de la bodega tal como se ve en el video (pared de
  canastas C, percheros A/B/D, estantería H, canastas G, cajas).
- La prenda de ejemplo de la etiqueta (`P-WPM210200L`).

Cualquier persona nueva se registra con el **código de invitación**
(`REGISTRATION_CODE`, por defecto `bodega`) y entra como operador
(puede escanear y consultar, no puede editar la distribución ni borrar
código). Para dar permisos de administrador a alguien más, cámbiale el
`role` a `admin` directamente en la base de datos.

## Desarrollo local sin Docker

### Backend

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # ajusta lo que necesites; sqlite funciona sin tocar nada
uvicorn app.main:app --reload --port 8090
```

Documentación interactiva de la API: http://localhost:8090/docs

Pruebas (flujo completo: login, escanear, sobreventa bloqueada, deshacer,
editar la bodega, proteger el stock al achicar un mueble):

```bash
pytest -q
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # déjalo vacío: en desarrollo Vite ya hace de proxy para /api
npm run dev
```

Abre http://localhost:5190. Asegúrate de tener el backend corriendo en
`http://localhost:8090`. En VS Code, `Ctrl+Shift+B` ("Iniciar Bodega")
arranca los dos. Los puertos son fijos: si alguno está ocupado, no arranca y
avisa, en vez de saltar a otro puerto y mezclarse con otro proyecto.

## Desplegar en producción (para usarla desde el celular)

Con esto queda con una URL real, accesible desde cualquier celular con
internet, con los datos guardados en una base de datos de verdad (no en tu
computador). Son dos cuentas gratis y ~10 minutos.

### 1. Base de datos: Supabase

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto
   nuevo (elige una contraseña de base de datos y guárdala).
2. En el proyecto, ve a **Project Settings → Database → Connection string**
   y copia la que dice **URI** (modo "Transaction pooler" si te la ofrece,
   funciona mejor con la nube). Se ve algo así:
   `postgresql://postgres.xxxx:TU-CLAVE@aws-0-xxxx.pooler.supabase.com:6543/postgres`

### 2. Backend + frontend: Render (con el blueprint incluido)

1. Crea una cuenta en [render.com](https://render.com) (puedes entrar con
   tu cuenta de GitHub).
2. **New → Blueprint**, conecta el repo `deivid0619/Bodega`. Render lee
   [`render.yaml`](render.yaml) y arma dos servicios: `bodega-backend` y
   `bodega-frontend`.
3. Antes de confirmar, te va a pedir estas variables del backend:
   - `DATABASE_URL`: la de Supabase del paso anterior.
   - `SECRET_KEY`: un valor aleatorio largo (genera el tuyo con
     `python -c "import secrets; print(secrets.token_hex(32))"` — nunca
     lo subas al repo, solo pégalo aquí).
   - `REGISTRATION_CODE`: la palabra que van a usar tus compañeros para
     registrarse (cámbiala del valor por defecto `bodega`).
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`: tu cuenta de
     administrador real. **No dejes `cambiar123`.**
   - `CORS_ORIGINS`: déjalo vacío por ahora, lo completas en el paso 5.
   - Para el frontend te va a pedir `VITE_API_URL`: déjalo vacío también
     por ahora (ver paso 4).
4. Cuando el backend termine de desplegar, copia su URL (algo como
   `https://bodega-backend-xxxx.onrender.com`). Ve a
   `bodega-frontend → Environment`, pon `VITE_API_URL` con esa URL, y
   vuelve a desplegar el frontend (**Manual Deploy**).
5. Copia la URL del frontend (`https://bodega-frontend-xxxx.onrender.com`).
   Ve a `bodega-backend → Environment`, pon `CORS_ORIGINS` con esa URL, y
   vuelve a desplegar el backend.
6. Abre la URL del frontend desde el celular — ya es la app real, con
   login de verdad (no el modo sin login que usamos para desarrollar).

Si el importe del blueprint falla por algún detalle de Render, los mismos
servicios se pueden crear a mano (New → Web Service para el backend con
`Dockerfile`, New → Static Site para el frontend con
`npm install && npm run build` / carpeta `dist`) usando las mismas
variables de arriba.

## Limitaciones a propósito (y el siguiente paso natural)

- **Sincronización por sondeo, no en tiempo real**: cada pantalla vuelve a
  pedir sus datos cada pocos segundos (el inventario cada 6, los reportes
  cada 20 o 30), así que si dos personas están viendo
  la bodega al mismo tiempo, una puede tardar unos segundos en ver lo que
  hizo la otra (el propio movimiento se ve al instante). El siguiente paso
  natural es cambiarlo por Supabase Realtime o un WebSocket, igual a como
  ya está planeado para Turify.
- **Deshacer solo el último movimiento**: como en el prototipo original,
  por simplicidad. Se podría llevar un historial de deshacer más largo por
  usuario.
- **Fotos solo de la tienda**: la foto de cada prenda sale del catálogo de
  pigmalionmoto.com; no se suben fotos propias, y las de remisiones y
  facturas no se guardan. Si hace falta, se puede agregar subida de
  imágenes con Supabase Storage (mismo plan que ya tienes para Turify).
- **Roles simples**: solo admin/operador. Si crece el equipo, vale la pena
  un rol intermedio (por ejemplo, "puede registrar prendas nuevas pero no
  editar la distribución").

## Estructura del proyecto

```
backend/
  app/
    main.py               arranque: crea las tablas y junta las rutas de cada modulo
    core/                 lo comun: configuracion, base de datos, sesion (JWT),
                          permisos, migraciones y datos iniciales
    modules/              un modulo por carpeta (ver modules/README.md):
      auth/ inventario/ bodega/ reserva/ documentos/ remisiones/ facturas/
      conteo/ despacho/ reportes/ catalogo/ avisos/
                          cada uno con router.py (rutas), models.py (tablas),
                          schemas.py (datos) y service.py si tiene logica propia
    models.py, schemas.py reunen las tablas y los datos de todos los modulos
  tests/                  pruebas con pytest (flujo completo, documentos,
                          de paso, reportes, avisos...)

frontend/
  src/
    main.jsx, App.jsx     arranque y rutas de la app
    core/                 api (sesion y llamadas), AuthContext, useApi (sondeo
                          y cache), utils
    ui/                   piezas compartidas: hojas, iconos, botones, elegir
                          ubicacion, recortar foto...
    modules/              las mismas partes que el servidor (ver modules/README.md):
                          bodega (visor 3D), inventario, escaneo, remisiones,
                          facturas, documentos, conteo, reserva, despacho,
                          resumen, reportes, avisos, auth
    styles/global.css     estilos generales (cada modulo puede traer los suyos)
```

## Variables del servidor (`backend/.env`)

Copia `backend/.env.example` a `backend/.env` y ajusta los valores. En Render
van en **bodega-backend → Environment**. El archivo `.env` nunca se sube a
GitHub.

| Variable | Para qué sirve |
| --- | --- |
| `DATABASE_URL` | Base de datos: `sqlite:///./bodega.db` en local, la de Supabase (Postgres) en producción |
| `SECRET_KEY` | Firma las sesiones. Genera una propia: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Cuánto dura una sesión abierta (480 = 8 horas) |
| `REGISTRATION_CODE` | Código que se pide al crear una cuenta, para que no se registre cualquiera |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Administrador que se crea solo la primera vez que arranca la API |
| `CORS_ORIGINS` | Dominios del frontend que pueden llamar a la API, separados por coma |
| `CATALOG_URL` | Opcional. Catálogo público de la tienda (por defecto el de pigmalionmoto.com); vacío lo apaga |
| `VAPID_SUBJECT` | Opcional. Quién firma los avisos al celular (por defecto https://pigmalionmoto.com) |
| `SUPABASE_SERVICE_KEY` | Para guardar un mes las fotos de remisiones y facturas en Supabase Storage (bucket privado `documentos`, se crea solo). La llave secreta del proyecto (`sb_secret_…`, Supabase → Settings → API Keys → Secret keys; también sirve la `service_role` de antes). Solo en Render, nunca en el repositorio. Sin ella, en el computador van a `backend/fotos-documentos` y en producción no se guardan. El Resumen muestra si se están guardando |
| `SUPABASE_URL` | Opcional. La URL del proyecto (`https://….supabase.co`); si no se pone, se saca de `DATABASE_URL` |
| `PHOTO_DAYS` | Opcional. Cuántos días se guardan esas fotos (por defecto 30); después se borran solas |
| `SKIP_AUTH` | Solo desarrollo: `true` entra sin iniciar sesión. Nunca en producción |

En producción, `ADMIN_PASSWORD` y `REGISTRATION_CODE` deben ser distintos a
los de ejemplo: el repositorio es público.
