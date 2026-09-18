// Preferencias de notificaciones dentro de la app: cuales tipos de
// movimiento quiere ver cada persona cuando OTRO usuario los registra
// mientras tiene la app abierta. Es por dispositivo (localStorage), no
// se comparte entre personas ni entre celular/computador.
import { createContext, useCallback, useContext, useState } from 'react'

const KEY = 'bodega_notif_prefs'
const DEFAULTS = { in: true, out: true, set: false }

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

const NotificationPrefsContext = createContext(null)

export function NotificationPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load)

  const setPref = useCallback((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado, sin guardado */ }
      return next
    })
  }, [])

  return (
    <NotificationPrefsContext.Provider value={{ prefs, setPref }}>
      {children}
    </NotificationPrefsContext.Provider>
  )
}

export function useNotificationPrefs() {
  const ctx = useContext(NotificationPrefsContext)
  if (!ctx) throw new Error('useNotificationPrefs debe usarse dentro de <NotificationPrefsProvider>')
  return ctx
}
