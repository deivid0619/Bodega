// Sin señal (1/2): lo ultimo que se vio queda guardado en el celular, para
// abrir la app y ver el inventario, la bodega y la reserva aunque no haya
// internet. Lo que se registra sin señal espera en outbox.js.

const PREFIX = 'bodega_cache:'
const USER = 'bodega_usuario'

// lo que se guarda (lo que hace falta para trabajar en la bodega)
export const CACHED = new Set(['/api/products', '/api/layout', '/api/reserve', '/api/reserve/restock', '/api/reports/needs',
  '/api/parcels', '/api/documents/counts'])

export function readCache(path) {
  if (!CACHED.has(path)) return null
  try {
    const s = localStorage.getItem(PREFIX + path)
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

export function writeCache(path, json) {
  if (!CACHED.has(path)) return
  try {
    localStorage.setItem(PREFIX + path, json)
  } catch { /* sin espacio: no se guarda, la app sigue */ }
}

// el usuario de la sesion (para abrir sin señal sin volver a entrar)
export function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER) || 'null')
  } catch {
    return null
  }
}

export function writeUser(user) {
  try {
    if (user) localStorage.setItem(USER, JSON.stringify(user))
    else localStorage.removeItem(USER)
  } catch { /* sin almacenamiento */ }
}

// al salir: nada de lo de esta cuenta queda en el celular
export function clearCache() {
  writeUser(null)
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch { /* sin almacenamiento */ }
}
