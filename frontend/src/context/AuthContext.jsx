import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, setAuthToken, setUnauthorizedHandler, setViewOnly } from '../api'

const AuthContext = createContext(null)
const STORAGE_KEY = 'bodega_token'
// SOLO DESARROLLO: con VITE_SKIP_AUTH=true no pide login (el backend debe
// tener SKIP_AUTH=true tambien). Nunca activar esto en produccion.
const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true'
// el enlace para ver sin editar: /?ver=LLAVE. La llave queda guardada en el
// celular: si la sesion vence, se vuelve a entrar sola (como una app)
const viewKey = () => new URLSearchParams(window.location.search).get('ver')
const VIEW_STORE = 'bodega_ver'
const storedKey = () => { try { return localStorage.getItem(VIEW_STORE) } catch { return null } }
const forgetKey = () => { try { localStorage.removeItem(VIEW_STORE) } catch { /* sin almacenamiento */ } }
export const LINK_ERROR = 'bodega_enlace_error'
export const WELCOME = 'bodega_bienvenida' // "Hola, Gabriel": se muestra una vez al entrar con el enlace
const noteError = (e) => { try { sessionStorage.setItem(LINK_ERROR, e?.message || 'Este enlace ya no funciona. Pide uno nuevo.') } catch { /* sin almacenamiento */ } }

// la llave de un enlace pegado entero (https://.../?ver=LLAVE) o solo la llave
export function keyFrom(text) {
  const t = String(text || '').trim()
  try {
    const k = new URL(t).searchParams.get('ver')
    if (k) return k
  } catch { /* no era una direccion */ }
  return t.includes('ver=') ? t.split('ver=')[1].split(/[&#\s]/)[0] : t
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => (SKIP_AUTH ? 'dev-skip-auth' : localStorage.getItem(STORAGE_KEY)))
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  // entrando con un enlace (el de la direccion, o el guardado si no hay sesion)
  const [linking, setLinking] = useState(() => !!viewKey() || (!localStorage.getItem(STORAGE_KEY) && !!storedKey()))
  const reentering = useRef(false)

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    if (SKIP_AUTH) return // sin login no hay de donde salir
    setAuthToken(null)
    setViewOnly(false)
    setToken(null)
    setUser(null)
  }, [])

  const applySession = useCallback((data) => {
    localStorage.setItem(STORAGE_KEY, data.access_token)
    setAuthToken(data.access_token)
    setViewOnly(data.user?.role === 'viewer')
    setToken(data.access_token)
    setUser(data.user)
  }, [])

  const enterView = useCallback(async (key, welcome = true) => {
    const data = await api.post('/api/auth/view', { key })
    try {
      localStorage.setItem(VIEW_STORE, key)
      if (welcome) sessionStorage.setItem(WELCOME, data.user?.name || '')
    } catch { /* sin almacenamiento */ }
    applySession(data)
  }, [applySession])

  // la sesion vencio: con un enlace guardado se vuelve a entrar sola; si el
  // enlace ya no existe, a la pantalla de entrada con el aviso
  const expired = useCallback(async () => {
    if (reentering.current) return
    const key = storedKey()
    if (!key) {
      clearSession()
      return
    }
    reentering.current = true
    setLinking(true)
    clearSession()
    try {
      await enterView(key, false)
    } catch (e) {
      forgetKey()
      noteError(e)
    } finally {
      reentering.current = false
      setLinking(false)
    }
  }, [clearSession, enterView])

  // salir a proposito: tambien se olvida el enlace
  const logout = useCallback(() => {
    forgetKey()
    clearSession()
  }, [clearSession])

  useEffect(() => {
    setViewOnly(user?.role === 'viewer')
  }, [user])

  useEffect(() => {
    setUnauthorizedHandler(expired)
  }, [expired])

  useEffect(() => {
    setAuthToken(token)
    if (!token) {
      setReady(true)
      return
    }
    api
      .get('/api/auth/me')
      .then(setUser)
      .catch(() => expired())
      .finally(() => setReady(true))
  }, [token, expired])

  // se abrio un enlace para ver (la llave sale de la direccion), o hay uno
  // guardado y no hay sesion: entra como "Solo ver"
  useEffect(() => {
    const fromUrl = viewKey()
    if (fromUrl) {
      const url = new URL(window.location.href)
      url.searchParams.delete('ver')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    const key = fromUrl || (!localStorage.getItem(STORAGE_KEY) && storedKey())
    if (!key) return
    enterView(key, !!fromUrl)
      .catch((e) => {
        if (!fromUrl) forgetKey()
        noteError(e)
      })
      .finally(() => setLinking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password })
    forgetKey()
    applySession(data)
  }

  const register = async (email, password, name, inviteCode) => {
    const data = await api.post('/api/auth/register', {
      email,
      password,
      name,
      invite_code: inviteCode,
    })
    forgetKey()
    applySession(data)
  }

  const value = {
    token,
    user,
    ready: ready && !linking,
    isAdmin: user?.role === 'admin',
    isViewer: user?.role === 'viewer',
    login,
    register,
    logout,
    enterView,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
