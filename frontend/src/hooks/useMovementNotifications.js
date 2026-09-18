// Avisa (con un toast) cuando OTRA persona registra un movimiento
// mientras tienes la app abierta, respetando las preferencias de
// notificacion. No usa nada nuevo del backend: reaprovecha el mismo
// sondeo de /api/movements, comparando contra el ultimo id ya visto.
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ToastContext'
import { useNotificationPrefs } from '../context/NotificationPrefsContext'

const POLL_MS = 5000
const VERB = { in: 'Entraron', new: 'Registraron', out: 'Salieron', set: 'Conteo:' }
const PREF_KEY = { in: 'in', new: 'in', out: 'out', set: 'set' }

export function useMovementNotifications() {
  const { token, user } = useAuth()
  const showToast = useToast()
  const { prefs } = useNotificationPrefs()
  const lastId = useRef(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    if (!token) return
    let cancelled = false

    const poll = async () => {
      try {
        const rows = await api.get('/api/movements?limit=20')
        if (cancelled || !rows.length) return
        if (lastId.current === null) {
          // primera carga: solo marcamos desde donde empezar a avisar,
          // no mostramos el historial viejo como si fuera nuevo
          lastId.current = rows[0].id
          return
        }
        const fresh = rows.filter((m) => m.id > lastId.current).sort((a, b) => a.id - b.id)
        for (const m of fresh) {
          lastId.current = Math.max(lastId.current, m.id)
          if (m.user_name && m.user_name === user?.name) continue // no avisar tus propios movimientos
          if (!prefsRef.current[PREF_KEY[m.type]]) continue
          const qty = m.type === 'set' ? m.after : m.qty
          showToast(`${VERB[m.type] || 'Movimiento:'} ${qty} ${m.product_name} · ${m.user_name} · ${m.location_name}`, m.type === 'out' ? 'err' : 'ok')
        }
      } catch { /* si la red falla, se reintenta en el proximo sondeo */ }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [token, user, showToast])
}
