// Datos compartidos con sondeo (polling): cada pocos segundos se vuelve a
// pedir la lista, asi lo que otra persona escanea aparece solo.
//
// Hay UNA cache por ruta para toda la app: si dos pantallas piden lo mismo,
// se hace una sola peticion. Las acciones (+1, -1, enviar...) actualizan la
// cache al instante y el servidor confirma por detras; con el servidor lejos,
// esperar cada respuesta hacia que todo se sintiera lento en el celular.
// Con la app en segundo plano no se consulta nada.
import { useEffect, useReducer } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const store = new Map()
let ownerToken = null
let epoch = 0 // sube con cada cambio optimista: una respuesta vieja no lo pisa

function entry(path) {
  if (!store.has(path)) store.set(path, { data: null, json: '', error: null, subs: new Set(), refs: 0, timer: null, inflight: null })
  return store.get(path)
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
      if (started === epoch) set(e, res)
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
  pendingBySku.set(sku, (pendingBySku.get(sku) || 0) + 1)
  try {
    const res = await enqueue(sku, request)
    const left = pendingBySku.get(sku) - 1
    pendingBySku.set(sku, left)
    // con varios toques seguidos, solo la ultima respuesta trae el estado final
    if (left === 0) mutate('/api/products', (list) => list.map((p) => (p.sku === sku ? res.product : p)))
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
    () => api.post('/api/movements', { sku, type, qty, ...(locationId ? { location_id: locationId } : {}) }),
  )
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
}
