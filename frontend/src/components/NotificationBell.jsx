import { useEffect, useState } from 'react'
import { useNotificationPrefs } from '../context/NotificationPrefsContext'
import { useInstall } from '../install'
import { currentSubscription, disablePush, enablePush, pushSupported, savePushPrefs, testPush } from '../lib/push'
import { useToast } from './ToastContext'
import Icon from './Icon'

const OPTIONS = [
  { key: 'in', label: 'Entradas' },
  { key: 'out', label: 'Salidas' },
  { key: 'set', label: 'Conteos' },
  { key: 'low', label: 'Bajo mínimo' },
  { key: 'docs', label: 'Facturas y remisiones' },
]

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { prefs, setPref } = useNotificationPrefs()
  const install = useInstall()
  const showToast = useToast()
  const [push, setPush] = useState('checking') // checking | off | on | blocked | unsupported
  const [busy, setBusy] = useState(false)
  const anyOn = Object.values(prefs).some(Boolean)

  useEffect(() => {
    if (!open) return
    if (!pushSupported()) { setPush('unsupported'); return }
    if (Notification.permission === 'denied') { setPush('blocked'); return }
    currentSubscription().then((s) => setPush(s ? 'on' : 'off')).catch(() => setPush('off'))
  }, [open])

  const toggle = (key) => {
    const next = { ...prefs, [key]: !prefs[key] }
    setPref(key, next[key])
    if (push === 'on') savePushPrefs(next).catch(() => {})
  }

  const turnOn = async () => {
    setBusy(true)
    try {
      await enablePush(prefs)
      setPush('on')
      showToast('Listo: los avisos llegan a este celular')
    } catch (e) {
      if (e?.message === 'denied') setPush('blocked')
      else showToast(e?.message === 'default' ? 'No se activaron los avisos.' : 'No se pudieron activar los avisos en este navegador.', 'err')
    } finally {
      setBusy(false)
    }
  }
  const turnOff = async () => {
    setBusy(true)
    await disablePush()
    setPush('off')
    setBusy(false)
  }
  const tryIt = async () => {
    try {
      await testPush()
      showToast('Aviso de prueba enviado')
    } catch {
      showToast('No se pudo enviar el aviso de prueba.', 'err')
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Avisos" aria-expanded={open}>
        <Icon name="bell" />
        {anyOn && <span className="pip" />}
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu wide">
            <div className="menu-head">
              <b>Avisos</b>
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
                  onClick={() => toggle(o.key)}
                />
              </div>
            ))}
            <p className="menu-note">No te avisa de lo que haces tú, salvo cuando algo queda bajo el mínimo.</p>

            <div className="push-box">
              <b>En este celular</b>
              {push === 'checking' && <span>Revisando…</span>}
              {push === 'unsupported' && (
                <span>{install.ios && !install.standalone
                  ? 'En iPhone, primero instala la app: Compartir → Agregar a pantalla de inicio. Después actívalos aquí.'
                  : 'Este navegador no recibe avisos con la app cerrada.'}</span>
              )}
              {push === 'blocked' && <span>Bloqueados para Bodega. Actívalos en los ajustes del navegador para este sitio.</span>}
              {push === 'off' && (
                <>
                  <span>Te llegan aunque la app esté cerrada.</span>
                  <button className="btn btn-lime btn-sm btn-block" disabled={busy} onClick={turnOn}>
                    <Icon name="bell" size={17} />Recibir avisos aquí
                  </button>
                </>
              )}
              {push === 'on' && (
                <>
                  <span className="on"><Icon name="check" size={15} stroke={2.6} />Activos en este celular</span>
                  <div className="push-actions">
                    <button className="btn btn-quiet btn-sm" onClick={tryIt}>Probar</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={turnOff}>Apagar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
