import { useState } from 'react'
import { useNotificationPrefs } from '../context/NotificationPrefsContext'

const OPTIONS = [
  { key: 'in', label: 'Entradas' },
  { key: 'out', label: 'Salidas' },
  { key: 'set', label: 'Conteos' },
]

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { prefs, setPref } = useNotificationPrefs()
  const anyOn = Object.values(prefs).some(Boolean)

  return (
    <div className="bell-wrap">
      <button className={`bell ${anyOn ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="Preferencias de notificación">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      </button>
      {open && (
        <>
          <div className="bell-scrim" onClick={() => setOpen(false)} />
          <div className="bell-menu">
            <p className="bell-title">Avisarme cuando alguien más registre:</p>
            {OPTIONS.map((o) => (
              <label key={o.key} className="bell-opt">
                <input type="checkbox" checked={!!prefs[o.key]} onChange={(e) => setPref(o.key, e.target.checked)} />
                {o.label}
              </label>
            ))}
            <p className="bell-hint">Nunca te avisa de lo que tú mismo registras.</p>
          </div>
        </>
      )}
    </div>
  )
}
