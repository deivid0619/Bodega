import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setAuthToken, setUnauthorizedHandler } from '../api'

const AuthContext = createContext(null)
const STORAGE_KEY = 'bodega_token'

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAuthToken(null)
    setToken(null)
    setUser(null)
  }, [])

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
    setToken(data.access_token)
    setUser(data.user)
  }

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
    ready,
    isAdmin: user?.role === 'admin',
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
