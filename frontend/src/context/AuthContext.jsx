import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setAuthToken, setUnauthorizedHandler, setViewOnly } from '../api'

const AuthContext = createContext(null)
const STORAGE_KEY = 'bodega_token'
// SOLO DESARROLLO: con VITE_SKIP_AUTH=true no pide login (el backend debe
// tener SKIP_AUTH=true tambien). Nunca activar esto en produccion.
const SKIP_AUTH = import.meta.env.VITE_SKIP_AUTH === 'true'
// el enlace para ver sin editar: /?ver=LLAVE
const viewKey = () => new URLSearchParams(window.location.search).get('ver')
export const LINK_ERROR = 'bodega_enlace_error'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => (SKIP_AUTH ? 'dev-skip-auth' : localStorage.getItem(STORAGE_KEY)))
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [linking, setLinking] = useState(() => !!viewKey())

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    if (SKIP_AUTH) return // sin login no hay de donde salir
    setAuthToken(null)
    setViewOnly(false)
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setViewOnly(user?.role === 'viewer')
  }, [user])

  useEffect(() => {
    setUnauthorizedHandler(logout)
  }, [logout])

  useEffect(() => {
    setAuthToken(token)
    if (!token) {
      setReady(true)
      return
    }
    api
      .get('/api/auth/me')
      .then(setUser)
      .catch(() => logout())
      .finally(() => setReady(true))
  }, [token, logout])

  const applySession = (data) => {
    localStorage.setItem(STORAGE_KEY, data.access_token)
    setAuthToken(data.access_token)
    setViewOnly(data.user?.role === 'viewer')
    setToken(data.access_token)
    setUser(data.user)
  }

  // se abrio el enlace para ver: entra como "Solo ver" y la llave sale de la direccion
  useEffect(() => {
    const key = viewKey()
    if (!key) return
    const url = new URL(window.location.href)
    url.searchParams.delete('ver')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    api.post('/api/auth/view', { key })
      .then(applySession)
      .catch((e) => {
        try { sessionStorage.setItem(LINK_ERROR, e?.message || 'Este enlace ya no funciona. Pide uno nuevo.') } catch { /* sin almacenamiento */ }
      })
      .finally(() => setLinking(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password })
    applySession(data)
  }

  const register = async (email, password, name, inviteCode) => {
    const data = await api.post('/api/auth/register', {
      email,
      password,
      name,
      invite_code: inviteCode,
    })
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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
