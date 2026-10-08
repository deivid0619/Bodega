// Cliente HTTP centralizado, igual que en Turify: una sola URL base leída
// de VITE_API_URL, y el token se agrega automáticamente si hay sesión.
const BASE = import.meta.env.VITE_API_URL || ''

let authToken = null
let onUnauthorized = null
// la cuenta del enlace "solo ver": no se manda ningun cambio (el servidor
// igual los rechaza)
let viewOnly = false
export const VIEW_ONLY = 'Esta cuenta es solo para ver: aquí no se puede cambiar nada.'

export function setAuthToken(token) {
  authToken = token
}

export function setViewOnly(on) {
  viewOnly = !!on
}

export const isViewOnly = () => viewOnly
// lo unico que guarda: entrar, y activar los avisos en su propio celular
const blocked = (method, path) => viewOnly && method !== 'GET' && !path.startsWith('/api/auth/') && !path.startsWith('/api/push/')

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, { method = 'GET', body, isForm } = {}) {
  if (blocked(method, path)) throw new ApiError(VIEW_ONLY, 403)
  const headers = {}
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json'
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })

  if (res.status === 401 && onUnauthorized) onUnauthorized()

  if (!res.ok) {
    let detail = `Error ${res.status}`
    try {
      const data = await res.json()
      // el servidor a veces responde la lista de campos que no son validos: un mensaje que se entienda
      detail = typeof data.detail === 'string' ? data.detail : data.detail ? 'Revisa los datos: hay algo que no es válido.' : detail
    } catch {
      // la respuesta no era JSON (por ejemplo, un error de red del proxy)
    }
    throw new ApiError(detail, res.status)
  }
  if (res.status === 204) return null
  const ctype = res.headers.get('content-type') || ''
  if (ctype.includes('text/csv')) return res.text()
  return res.json()
}

// Archivos (las fotos de remisiones y facturas): se suben tal cual y se
// traen como Blob, siempre con la sesion (nunca son publicas)
async function raw(path, { method = 'GET', body, type } = {}) {
  if (blocked(method, path)) throw new ApiError(VIEW_ONLY, 403)
  const headers = {}
  if (type) headers['Content-Type'] = type
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body })
  if (res.status === 401 && onUnauthorized) onUnauthorized()
  if (!res.ok) {
    let detail = `Error ${res.status}`
    try {
      const d = (await res.json()).detail
      detail = typeof d === 'string' ? d : d ? 'Revisa los datos: hay algo que no es válido.' : detail
    } catch {
      // no era JSON
    }
    throw new ApiError(detail, res.status)
  }
  return res
}

export const apiUpload = async (path, blob) => (await raw(path, { method: 'POST', body: blob, type: blob.type || 'image/jpeg' })).json()
export const apiBlob = async (path) => (await raw(path)).blob()

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
}

export { ApiError }
