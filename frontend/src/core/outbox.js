// Sin señal (2/2): lo que se registra sin señal (entradas, salidas, conteos y
// los + / −) espera aqui, guardado en el celular, y se sube solo cuando
// vuelve la señal, en el mismo orden. Cada cambio lleva su llave
// (X-Request-Id): si la señal se cae justo despues de que el servidor lo
// guardo, al reintentar no se cuenta dos veces. Lo que el servidor rechaza
// (ej. ya no alcanza) queda aparte para revisarlo.
import { api, isNetworkError } from './api'

const KEY = 'bodega_por_subir'
const RETRY_MS = 15000

let state = load() // { items: [{ id, path, body, label, at, op }], failed: [{ ...item, err }] }
let flushing = false
let timer = null
const listeners = new Set()
const synced = new Set()

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    return s && Array.isArray(s.items) ? { items: s.items, failed: s.failed || [] } : { items: [], failed: [] }
  } catch {
    return { items: [], failed: [] }
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch { /* sin espacio: queda en memoria mientras la app este abierta */ }
  const snap = snapshot()
  listeners.forEach((f) => f(snap))
}

export const snapshot = () => ({ items: state.items, failed: state.failed, flushing, online: navigator.onLine })
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`)

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// cuando se subio algo (para refrescar el inventario)
export function onSynced(fn) {
  synced.add(fn)
  return () => synced.delete(fn)
}

export function enqueue(item) {
  state = { ...state, items: [...state.items, { at: Date.now(), ...item }] }
  save()
  schedule()
}

// los movimientos que todavia no se suben: la pantalla los muestra encima de
// lo ultimo que dijo el servidor
export const pendingOps = () => state.items.map((i) => i.op).filter(Boolean)
export const isPending = (id) => state.items.some((i) => i.id === id)

export function discard(id) {
  state = { items: state.items.filter((i) => i.id !== id), failed: state.failed.filter((i) => i.id !== id) }
  save()
}

export function retryFailed() {
  state = { items: [...state.items, ...state.failed.map(({ err, ...i }) => i)], failed: [] }
  save()
  flush()
}

export async function flush() {
  if (flushing || !state.items.length) return
  flushing = true
  save()
  let done = 0
  try {
    while (state.items.length) {
      const it = state.items[0]
      try {
        await api.post(it.path, it.body, { requestId: it.id })
        done++
        state = { ...state, items: state.items.slice(1) }
      } catch (e) {
        if (isNetworkError(e) || e?.status === 401) break // sin señal o sin sesion: despues
        state = { items: state.items.slice(1), failed: [...state.failed, { ...it, err: e?.message || 'No se pudo guardar.' }] }
      }
      save()
    }
  } finally {
    flushing = false
    save()
    if (done) synced.forEach((f) => f(done))
    if (!state.items.length && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function schedule() {
  if (!timer) timer = setInterval(flush, RETRY_MS)
  setTimeout(flush, 300)
}

window.addEventListener('online', () => flush())
window.addEventListener('offline', () => save())
if (state.items.length) schedule()
