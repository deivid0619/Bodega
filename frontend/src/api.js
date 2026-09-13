// Cliente HTTP centralizado, igual que en Turify: una sola URL base leída
// de VITE_API_URL, y el token se agrega automáticamente si hay sesión.
const BASE = import.meta.env.VITE_API_URL || ''

let authToken = null
let onUnauthorized = null

export function setAuthToken(token) {
  authToken = token
}

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
      detail = data.detail || detail
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

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
}

export { ApiError }
