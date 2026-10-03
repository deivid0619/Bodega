import { useState } from 'react'
import { useNotificationPrefs } from '../context/NotificationPrefsContext'
import Icon from './Icon'

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
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Avisos" aria-expanded={open}>
        <Icon name="bell" />
        {anyOn && <span className="pip" />}
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu">
            <div className="menu-head">
              <b>Avisos en vivo</b>
              <span>Cuando otra persona registre:</span>
            </div>
            {OPTIONS.map((o) => (
              <div key={o.key} className="menu-check">
                {o.label}
                <button
                  className="switch"
                  role="switch"
                  aria-checked={!!prefs[o.key]}
                  aria-label={`Avisar ${o.label.toLowerCase()}`}
                  onClick={() => setPref(o.key, !prefs[o.key])}
                />
              </div>
            ))}
            <p className="menu-note">Nunca te avisa de lo que registras tú.</p>
          </div>
        </>
      )}
    </div>
  )
}
