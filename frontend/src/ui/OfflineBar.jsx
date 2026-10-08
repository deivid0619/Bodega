import { useEffect, useState } from 'react'
import * as outbox from '../core/outbox'
import { redrawPending } from '../core/useApi'
import { fmtTime } from '../core/utils'
import Sheet, { SheetHeader } from './Sheet'
import Icon from './Icon'
import { plural } from './Bits'

// La barra de arriba cuando no hay señal o hay cambios por subir. Al tocarla,
// la lista: lo que espera (se sube solo) y lo que el servidor no acepto (para
// reintentar o quitar).
function Pending({ snap }) {
  const drop = (id) => {
    outbox.discard(id)
    redrawPending() // la pantalla deja de mostrarlo
  }
  return (
    <>
      <SheetHeader title="Por subir" subtitle="Lo que se registró sin señal queda guardado en el celular y se sube solo, en orden, cuando vuelve la señal." />
      {snap.failed.length > 0 && (
        <>
          <h3 className="h-sec">No se pudieron subir <small>{snap.failed.length}</small></h3>
          <div className="card panel">
            {snap.failed.map((it) => (
              <div className="need" key={it.id}>
                <span className="need-t"><b>{it.label}</b><small className="owed">{it.err}</small></span>
                <button type="button" className="link-btn" onClick={() => drop(it.id)}>Quitar</button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => outbox.retryFailed()}>
            Intentar otra vez
          </button>
        </>
      )}
      <h3 className="h-sec">Esperando señal <small>{snap.items.length}</small></h3>
      {snap.items.length ? (
        <div className="card panel">
          {snap.items.map((it) => (
            <div className="need" key={it.id}>
              <span className="need-t"><b>{it.label}</b><small>{fmtTime(new Date(it.at).toISOString())}</small></span>
              <button type="button" className="link-btn" onClick={() => drop(it.id)}>Quitar</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mode-hint">Nada pendiente.</p>
      )}
      {snap.items.length > 0 && (
        <button type="button" className="btn btn-lime btn-block" style={{ marginTop: 14 }} disabled={snap.flushing} onClick={() => outbox.flush()}>
          {snap.flushing ? 'Subiendo…' : 'Subir ahora'}
        </button>
      )}
    </>
  )
}

export default function OfflineBar() {
  const [snap, setSnap] = useState(outbox.snapshot)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [open, setOpen] = useState(false)
  useEffect(() => outbox.subscribe(setSnap), [])
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const n = snap.items.length
  const f = snap.failed.length
  if (online && !n && !f) return null
  const [tone, text] = f ? ['err', plural(f, 'cambio no se pudo subir', 'cambios no se pudieron subir')]
    : !online ? ['off', n ? `Sin señal · ${plural(n, 'cambio por subir', 'cambios por subir')}` : 'Sin señal · lo que registres se guarda en el celular']
      : snap.flushing ? ['sync', `Subiendo ${plural(n, 'cambio', 'cambios')}…`]
        : ['off', `${plural(n, 'cambio por subir', 'cambios por subir')} · se intenta cada poco`]
  return (
    <>
      <button type="button" className={`offline-bar ${tone}`} onClick={() => setOpen(true)} aria-live="polite">
        <Icon name={tone === 'sync' ? 'undo' : tone === 'err' ? 'alert' : 'offline'} size={16} stroke={2.2} />
        <span>{text}</span>
        <small>Ver</small>
      </button>
      {open && (
        <Sheet modal onClose={() => setOpen(false)} label="Por subir">
          <Pending snap={snap} />
        </Sheet>
      )}
    </>
  )
}
