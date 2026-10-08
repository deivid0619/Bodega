// Datos compartidos con sondeo (polling): cada pocos segundos se vuelve a
// pedir la lista, asi lo que otra persona escanea aparece solo.
//
// Hay UNA cache por ruta para toda la app: si dos pantallas piden lo mismo,
// se hace una sola peticion. Las acciones (+1, -1, enviar...) actualizan la
// cache al instante y el servidor confirma por detras; con el servidor lejos,
// esperar cada respuesta hacia que todo se sintiera lento en el celular.
// Con la app en segundo plano no se consulta nada.
//
// Sin señal: lo ultimo que dijo el servidor queda guardado (offline.js) y se
// muestra al abrir; lo que se registra espera en outbox.js y se ve en la
// pantalla encima de lo guardado hasta que se sube.
import { useEffect, useReducer } from 'react'
import { api, isNetworkError, isViewOnly } from './api'
import { useAuth } from './AuthContext'
import { readCache, writeCache } from './offline'
import * as outbox from './outbox'

const store = new Map()
let ownerToken = null
let epoch = 0 // sube con cada cambio optimista: una respuesta vieja no lo pisa

function entry(path) {
  if (!store.has(path)) {
    // lo ultimo guardado en el celular, mientras llega lo del servidor (o si no hay señal)
    const cached = readCache(path)
    const data = cached ? withPending(path, cached) : null
    store.set(path, { data, json: data ? JSON.stringify(data) : '', error: null, subs: new Set(), refs: 0, timer: null, inflight: null })
  }
  return store.get(path)
}

// lo que se registro sin señal y todavia no se sube, encima de lo que dijo el servidor
function withPending(path, data) {
  if (!path.startsWith('/api/products') || !Array.isArray(data)) return data
  const ops = outbox.pendingOps()
  if (!ops.length) return data
  return data.map((p) => ops.reduce((acc, op) => (op.sku === acc.sku ? applyLocally(acc, op.type, op.qty, op.location_id) : acc), p))
}

function set(e, data) {
  const json = typeof data === 'string' ? data : JSON.stringify(data)
  if (json === e.json) return
  e.json = json
  e.data = data
  e.subs.forEach((f) => f())
}

function fetchPath(path) {
  const e = entry(path)
  if (e.inflight) return e.inflight
  const started = epoch
  e.inflight = api.get(path)
    .then((res) => {
      e.error = null
      writeCache(path, JSON.stringify(res)) // tal cual lo dijo el servidor
      if (started === epoch) set(e, withPending(path, res))
    })
    .catch((err) => {
      e.error = err
      e.subs.forEach((f) => f())
    })
    .finally(() => { e.inflight = null })
  return e.inflight
}

export function revalidate(prefix) {
  for (const [path, e] of store) if (path.startsWith(prefix) && e.refs > 0) fetchPath(path)
}

// Cambia en el acto todas las listas cuya ruta empieza por `prefix`.
export function mutate(prefix, updater) {
  if (isViewOnly()) return // solo ver: la pantalla no cambia (y el cambio no se manda)
  epoch++
  for (const [path, e] of store) {
    if (path.startsWith(prefix) && Array.isArray(e.data)) set(e, updater(e.data))
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') for (const [path, e] of store) if (e.refs > 0) fetchPath(path)
})

export function usePolling(path, { interval = 6000 } = {}) {
  const { token } = useAuth()
  const [, rerender] = useReducer((n) => n + 1, 0)
  if (token !== ownerToken) {
    // otra sesion: nada de los datos del usuario anterior
    for (const e of store.values()) clearInterval(e.timer)
    store.clear()
    ownerToken = token
  }
  const e = entry(path)

  useEffect(() => {
    if (!token) return undefined
    const en = entry(path)
    en.subs.add(rerender)
    en.refs++
    fetchPath(path)
    if (!en.timer) {
      en.timer = setInterval(() => {
        if (document.visibilityState === 'visible') fetchPath(path)
      }, interval)
    }
    return () => {
      en.subs.delete(rerender)
      en.refs--
      if (en.refs <= 0) {
        clearInterval(en.timer)
        en.timer = null
      }
    }
  }, [path, token, interval])

  return { data: e.data, error: e.error, loading: e.data == null && !e.error, reload: () => fetchPath(path) }
}

export function useLayout() {
  return usePolling('/api/layout', { interval: 30000 })
}

export function useProducts(search, filter) {
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  if (filter && filter !== 'all') qs.set('filter', filter)
  return usePolling(`/api/products${qs.toString() ? `?${qs}` : ''}`)
}

export function useMovements(filter) {
  const qs = new URLSearchParams({ limit: '60' })
  if (filter && filter !== 'all') qs.set('type', filter)
  return usePolling(`/api/movements?${qs}`, { interval: 8000 })
}

export function useNeeds() {
  return usePolling('/api/reports/needs', { interval: 10000 })
}

export function useTop() {
  return usePolling('/api/reports/top', { interval: 30000 })
}

export function useReserve() {
  return usePolling('/api/reserve', { interval: 8000 })
}

// lo que conviene traer de la reserva a la bodega
export function useRestock() {
  return usePolling('/api/reserve/restock', { interval: 20000 })
}

// ---------- acciones con respuesta inmediata ----------
const pendingBySku = new Map()
const queues = new Map()

// Los cambios de un mismo codigo viajan en fila (uno tras otro): la pantalla
// no espera, pero el servidor nunca recibe dos a la vez del mismo codigo.
function enqueue(key, task) {
  const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(task)
  queues.set(key, run)
  return run
}

// Lo que el servidor va a hacer, calculado aqui para mostrarlo al instante.
// Mismas reglas que el backend: entrada y conteo van a la ubicacion elegida
// o a la principal; una salida sin ubicacion sale primero de la principal.
export function applyLocally(p, type, n, loc) {
  const stock = (p.stock || []).map((s) => ({ ...s }))
  const row = (id) => {
    let r = stock.find((s) => s.location_id === id)
    if (!r) {
      r = { location_id: id, location_name: id, qty: 0 }
      stock.push(r)
    }
    return r
  }
  if (type === 'in' || type === 'set') {
    const r = row(loc || p.location_id)
    r.qty = type === 'in' ? r.qty + n : n
  } else if (type === 'out') {
    const order = loc ? [row(loc)] : [...stock].sort((a, b) => (a.location_id !== p.location_id) - (b.location_id !== p.location_id) || b.qty - a.qty)
    let left = n
    for (const r of order) {
      const take = Math.min(left, r.qty)
      r.qty -= take
      left -= take
      if (!left) break
    }
  }
  const kept = stock.filter((s) => s.qty > 0)
  return { ...p, stock: kept, qty: kept.reduce((t, s) => t + s.qty, 0) }
}

async function optimistic(sku, local, request) {
  mutate('/api/products', (list) => list.map((p) => (p.sku === sku ? local(p) : p)))
  return confirm(sku, request)
}

// manda el cambio (ya visible en pantalla) y, cuando no queda nada mas por
// confirmar de ese codigo, deja lo que diga el servidor
async function confirm(sku, request) {
  pendingBySku.set(sku, (pendingBySku.get(sku) || 0) + 1)
  try {
    const res = await enqueue(sku, request)
    const left = pendingBySku.get(sku) - 1
    pendingBySku.set(sku, left)
    if (res?.queued) return res // sin señal: lo de la pantalla se queda y se sube solo
    // con varios toques seguidos, solo la ultima respuesta trae el estado final
    // (una etiqueta corregida responde con el codigo bueno: tambien ese)
    if (left === 0) mutate('/api/products', (list) => list.map((p) => (p.sku === sku || p.sku === res.product?.sku ? res.product : p)))
    revalidate('/api/reports/needs')
    revalidate('/api/movements')
    return res
  } catch (err) {
    pendingBySku.set(sku, pendingBySku.get(sku) - 1)
    revalidate('/api/products')
    throw err
  }
}

// Entrada / salida / conteo de un codigo ya registrado, opcionalmente en una
// ubicacion. La pantalla cambia en el acto; si el servidor lo rechaza, se
// vuelve a lo que diga el servidor.
export function moveStock(sku, type, qty = 1, locationId) {
  return optimistic(
    sku,
    (p) => applyLocally(p, type, qty, locationId),
    () => postMovement({ sku, type, qty, ...(locationId ? { location_id: locationId } : {}) }),
  )
}

// La prenda como esta en la pantalla (lo guardado, con lo de sin señal)
export function cachedProduct(sku) {
  for (const [path, e] of store) {
    if (!path.startsWith('/api/products') || !Array.isArray(e.data)) continue
    const p = e.data.find((x) => x.sku === sku)
    if (p) return p
  }
  return (readCache('/api/products') || []).find((x) => x.sku === sku) || null
}

const VERB = { in: 'Entrada', out: 'Salida', set: 'Conteo' }

// Manda un movimiento; sin señal queda en la fila (se sube solo) y responde
// como el servidor, con lo que se ve en la pantalla
async function postMovement(body) {
  const id = outbox.newId()
  try {
    return await api.post('/api/movements', body, { requestId: id })
  } catch (err) {
    if (!isNetworkError(err)) throw err
    const p = cachedProduct(body.sku) || { sku: body.sku, name: body.sku, size: '', qty: 0, stock: [], location_id: body.location_id || '' }
    const loc = body.location_id || p.location_id
    outbox.enqueue({
      id, path: '/api/movements', body,
      label: `${VERB[body.type] || 'Movimiento'} ${body.type === 'set' ? `(quedan ${body.qty})` : body.qty} · ${p.name}${p.size ? ` ${p.size}` : ''} · ${loc}`,
      op: { sku: body.sku, type: body.type, qty: body.qty, location_id: body.location_id },
    })
    const delta = body.type === 'in' ? body.qty : body.type === 'out' ? -body.qty : 0
    return {
      queued: true,
      product: p,
      movement: {
        id: `q-${id}`, queued: true, sku: p.sku, type: body.type, qty: body.qty, before: p.qty - delta, after: p.qty,
        location_id: loc, location_name: loc, to_location_id: null, note: 'Sin señal: se sube solo',
        product_name: p.name, product_size: p.size || '', user_name: '', created_at: new Date().toISOString(),
      },
    }
  }
}

// Se quito algo de la fila (sin subirlo): la pantalla vuelve a lo guardado
// con lo que sigue pendiente
export function redrawPending() {
  for (const [path, e] of store) {
    if (!path.startsWith('/api/products')) continue
    const cached = readCache(path)
    if (cached) set(e, withPending(path, cached))
    else if (e.refs > 0) fetchPath(path)
  }
}

// "Deshacer" de algo que todavia no se subio: se quita de la fila
export function undoQueued(movement) {
  const id = String(movement.id).slice(2)
  if (!outbox.isPending(id)) return false
  outbox.discard(id)
  const back = movement.type === 'in' ? 'out' : movement.type === 'out' ? 'in' : null
  if (back) mutate('/api/products', (list) => list.map((p) => (p.sku === movement.sku ? applyLocally(p, back, movement.qty, movement.location_id) : p)))
  else revalidate('/api/products')
  return true
}

// Toques seguidos en + / − de un mismo codigo y ubicacion se juntan en un
// solo movimiento (+5 en vez de cinco +1): la pantalla cambia con cada toque
// y al servidor va un solo envio cuando se deja de tocar. Con el servidor
// lejos cada envio tarda, y cinco en fila se sentian lentos.
const bumps = new Map()

export function bumpStock(sku, delta, locationId) {
  mutate('/api/products', (list) => list.map((p) => (p.sku === sku ? applyLocally(p, delta > 0 ? 'in' : 'out', Math.abs(delta), locationId) : p)))
  const key = `${sku}|${locationId || ''}`
  let b = bumps.get(key)
  if (!b) {
    b = { net: 0, waiters: [], timer: null }
    bumps.set(key, b)
    // mientras se junta, una respuesta vieja de ese codigo no pisa estos toques
    pendingBySku.set(sku, (pendingBySku.get(sku) || 0) + 1)
  }
  b.net += delta
  clearTimeout(b.timer)
  b.timer = setTimeout(() => flushBump(key, sku, locationId), 450)
  return new Promise((resolve, reject) => b.waiters.push({ resolve, reject }))
}

async function flushBump(key, sku, locationId) {
  const b = bumps.get(key)
  bumps.delete(key)
  pendingBySku.set(sku, pendingBySku.get(sku) - 1)
  if (!b.net) {
    // sumo y resto lo mismo: no hay nada que enviar
    if (!pendingBySku.get(sku)) revalidate('/api/products')
    b.waiters.forEach((w) => w.resolve(null))
    return
  }
  const body = { sku, type: b.net > 0 ? 'in' : 'out', qty: Math.abs(b.net), ...(locationId ? { location_id: locationId } : {}) }
  try {
    const res = await confirm(sku, () => postMovement(body))
    b.waiters.forEach((w) => w.resolve(res))
  } catch (err) {
    b.waiters.forEach((w) => w.reject(err))
  }
}

// Traslado entre ubicaciones (el total no cambia).
export function moveBetween(sku, from, to, qty) {
  return optimistic(
    sku,
    (p) => applyLocally(applyLocally(p, 'out', qty, from), 'in', qty, to),
    () => api.post(`/api/products/${encodeURIComponent(sku)}/move`, { from_location: from, to_location: to, qty }),
  )
}

export async function setReserveQty(item, qty) {
  const key = `reserve-${item.id}`
  mutate('/api/reserve', (list) => list.map((i) => (i.id === item.id ? { ...i, qty } : i)))
  pendingBySku.set(key, (pendingBySku.get(key) || 0) + 1)
  try {
    const res = await enqueue(key, () => api.patch(`/api/reserve/${item.id}`, { qty }))
    const left = pendingBySku.get(key) - 1
    pendingBySku.set(key, left)
    if (left === 0) mutate('/api/reserve', (list) => list.map((i) => (i.id === item.id ? res : i)))
    return res
  } catch (err) {
    pendingBySku.set(key, pendingBySku.get(key) - 1)
    revalidate('/api/reserve')
    throw err
  }
}

// tras registrar algo nuevo o mover entre bodega y reserva
export function refreshInventory() {
  revalidate('/api/products')
  revalidate('/api/reports/needs')
  revalidate('/api/movements')
  revalidate('/api/reserve')
  revalidate('/api/reports/dispatch') // lo que esta en Despacho esperando salir
}

// lo que se registro sin señal ya se subio: lo de la pantalla, del servidor
outbox.onSynced(() => refreshInventory())
