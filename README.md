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

## Arquitectura

```
frontend (React + Vite + Three.js)  →  backend (FastAPI)  →  PostgreSQL
        Netlify / Vercel / Render         Render / Railway     Supabase / Render
```

- **Backend**: FastAPI + SQLAlchemy + JWT. Mismo stack que Turify.
  - `layout_service.py`: agregar/mover/redimensionar/borrar muebles,
    protegiendo el inventario (nunca deja una prenda con existencias sin
    ubicación).
  - `inventory_service.py`: entradas, salidas, conteos y deshacer, con
    `SELECT ... FOR UPDATE` para que dos personas escaneando el mismo
    código al mismo tiempo no se pisen los datos.
  - `layout_logic.py`: traduce cada mueble a sus ubicaciones concretas
    (p. ej. la pared de canastas C con 9 columnas y 8 filas → 72
    ubicaciones `C-1-1` … `C-8-9`). El frontend nunca recalcula esto por su
    cuenta: siempre usa los nombres e IDs que devuelve `GET /api/layout`,
    así que backend y visor 3D no se pueden desincronizar.
- **Frontend**: React + Vite. El visor 3D (`src/three/WarehouseScene.js`)
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

- Frontend: http://localhost:5173
- Backend: http://localhost:8001/api/health (se publica en 8001, no 8000, para
  no chocar con otros proyectos que ya usen esa puerta en tu máquina — como
  Turify; el frontend sigue hablando con el backend por dentro de la red de
  Docker, así que esto no le afecta)
- Postgres queda arriba en el puerto 5433 (usuario/clave `bodega`/`bodega`).
  Se publica en 5433 y no 5432 por la misma razón que el backend: evitar
  choques con otros Postgres que ya tengas corriendo, como el de Turify.

La primera vez que arranca el backend, crea automáticamente:
- Un usuario **administrador**: correo `admin@bodega.local`, clave
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
uvicorn app.main:app --reload
```

Documentación interactiva de la API: http://localhost:8000/docs

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

Abre http://localhost:5173. Asegúrate de tener el backend corriendo en
`http://localhost:8000` (o cambia el proxy en `vite.config.js`).

## Desplegar en producción (Render, como Turify)

1. **Base de datos**: crea un proyecto en Supabase (o una base Postgres en
   Render) y copia el `DATABASE_URL`.
2. **Backend**: nuevo Web Service en Render apuntando a `backend/`, con
   `Dockerfile` como entorno. Variables de entorno: `DATABASE_URL`,
   `SECRET_KEY` (genera uno con
   `python -c "import secrets; print(secrets.token_hex(32))"`),
   `REGISTRATION_CODE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, y `CORS_ORIGINS`
   con la URL del frontend una vez la tengas.
3. **Frontend**: nuevo Static Site o Web Service en Render (o Vercel)
   apuntando a `frontend/`, con `VITE_API_URL` = la URL pública del
   backend (por ejemplo `https://bodega-api.onrender.com`).
4. Actualiza `CORS_ORIGINS` en el backend con la URL final del frontend.

## Limitaciones a propósito (y el siguiente paso natural)

- **Sincronización por sondeo, no en tiempo real**: cada pantalla vuelve a
  pedir sus datos cada 4-6 segundos, así que si dos personas están viendo
  la bodega al mismo tiempo, una puede tardar unos segundos en ver lo que
  hizo la otra (el propio movimiento se ve al instante). El siguiente paso
  natural es cambiarlo por Supabase Realtime o un WebSocket, igual a como
  ya está planeado para Turify.
- **Deshacer solo el último movimiento**: como en el prototipo original,
  por simplicidad. Se podría llevar un historial de deshacer más largo por
  usuario.
- **Sin fotos de producto**: solo código, referencia y talla. Si hace
  falta, se puede agregar subida de imágenes con Supabase Storage (mismo
  plan que ya tienes para Turify).
- **Roles simples**: solo admin/operador. Si crece el equipo, vale la pena
  un rol intermedio (por ejemplo, "puede registrar prendas nuevas pero no
  editar la distribución").

## Estructura del proyecto

```
backend/
  app/
    models.py            modelos de la base de datos
    schemas.py            forma de los datos de entrada/salida de la API
    layout_logic.py       muebles → ubicaciones concretas
    layout_service.py     agregar/mover/redimensionar/borrar muebles
    inventory_service.py  entradas/salidas/conteos/deshaces/pedidos
    security.py, deps.py  JWT y control de acceso
    routers/               auth, layout, products, movements, reports
  tests/test_flow.py      prueba de extremo a extremo con pytest

frontend/
  src/
    three/WarehouseScene.js   motor 3D (clase, sin dependencias de React)
    components/WarehouseCanvas.jsx   puente React ↔ Three.js
    pages/                     Login, Warehouse, Scan, Inventory, Orders, History
    hooks/useApi.js            sondeo de datos compartidos
    context/AuthContext.jsx    sesión y token JWT
```
