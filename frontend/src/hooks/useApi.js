// Hooks de datos compartidos. Usan sondeo (polling) simple en vez de
// WebSockets: cada pocos segundos se vuelve a pedir la lista, así que si
// otra persona escanea algo, tú lo ves aparecer solo. Es más simple que un
// socket y, para el ritmo de una bodega, es suficiente. El siguiente paso
// natural (ver README) es cambiar esto por Supabase Realtime.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'

const POLL_MS = 4000

export function usePolling(path, { enabled = true, interval = POLL_MS } = {}) {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!token || !enabled) return
    try {
      const res = await api.get(path)
      setData(res)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [path, token, enabled])

  useEffect(() => {
    load()
    if (!enabled) return
    timer.current = setInterval(load, interval)
    return () => clearInterval(timer.current)
  }, [load, enabled, interval])

  return { data, error, loading, reload: load }
}

export function useLayout() {
  return usePolling('/api/layout', { interval: 6000 })
}

export function useProducts(search, filter) {
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  if (filter && filter !== 'all') qs.set('filter', filter)
  const path = `/api/products${qs.toString() ? `?${qs}` : ''}`
  return usePolling(path)
}

export function useMovements(filter) {
  const qs = new URLSearchParams()
  if (filter && filter !== 'all') qs.set('type', filter)
  return usePolling(`/api/movements${qs.toString() ? `?${qs}` : ''}`)
}

export function useNeeds() {
  return usePolling('/api/reports/needs')
}

export function useTop() {
  return usePolling('/api/reports/top')
}

export function useReserve() {
  return usePolling('/api/reserve')
}
