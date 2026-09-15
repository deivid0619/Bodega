import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useLayout } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import BarcodeBars from '../components/BarcodeBars'
import NewProductModal from '../components/NewProductModal'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { fmtTime } from '../utils'

const HINTS = {
  in: 'Cada código suma la cantidad a la bodega.',
  out: 'Cada código descuenta la cantidad (ventas y despachos).',
  set: 'Cada código reemplaza el total guardado por la cantidad que contaste.',
}
const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo' }

function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1400 : 220
    g.gain.value = 0.07
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
  } catch { /* audio no disponible en este navegador */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 35 : [60, 40, 60])
}

export default function Scan() {
  const { data: layout } = useLayout()
  const showToast = useToast()
  const [mode, setMode] = useState('in')
  const [qty, setQty] = useState(1)
  const [manual, setManual] = useState('')
  const [pendingSku, setPendingSku] = useState(null)
  const [lastMove, setLastMove] = useState(null)
  const [session, setSession] = useState([])
  const [newLoc, setNewLoc] = useState('')

  const groups = layout ? locationGroups(layout.elements) : []
  useEffect(() => {
    if (!newLoc && groups.length) setNewLoc(groups[0].options[0]?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  const handleCode = async (raw) => {
    const sku = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
    if (!sku || pendingSku) return
    try {
      await api.get(`/api/products/${encodeURIComponent(sku)}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        beep(true)
        setPendingSku(sku)
        return
      }
      showToast('No se pudo consultar ese código.', 'err')
      return
    }
    try {
      const res = await api.post('/api/movements', { sku, type: mode, qty })
      beep(true)
      setLastMove(res)
      setSession((s) => [res.movement, ...s].slice(0, 25))
    } catch (e) {
      beep(false)
      showToast(e instanceof ApiError ? e.message : 'No se pudo registrar el movimiento.', 'err')
    }
  }

  const { status, message, videoRef, containerRef, start, stop } = useBarcodeScanner(handleCode)
  const camOn = status === 'native' || status === 'lib'
  // el recuadro sigue visible en 'fail' para poder mostrar el aviso de
  // error (si no, el mensaje queda escrito pero oculto por el CSS)
  const camVisible = status !== 'off'

  useEffect(() => () => { stop() }, [stop])

  const submitManual = () => {
    handleCode(manual)
    setManual('')
  }

  const undo = async (id) => {
    try {
      await api.post(`/api/movements/${id}/undo`)
      setSession((s) => s.filter((m) => m.id !== id))
      if (lastMove?.movement?.id === id) setLastMove(null)
      showToast('Movimiento deshecho')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Solo se puede deshacer el último movimiento.', 'err')
    }
  }

  return (
    <section className="view" aria-label="Escanear">
      <div className="seg">
        {['in', 'out', 'set'].map((m) => (
          <button key={m} data-m={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m !== 'set' && qty < 1) setQty(1) }}>
            {m === 'in' ? 'Entrada' : m === 'out' ? 'Salida' : 'Conteo'}
          </button>
        ))}
      </div>
      <p className="hint">{HINTS[mode]}</p>
      <div className="qtyrow">
        <label htmlFor="qty">{mode === 'set' ? 'Cantidad contada' : 'Prendas por escaneo'}</label>
        <div className="stepper">
          <button onClick={() => setQty((q) => Math.max(mode === 'set' ? 0 : 1, q - 1))} aria-label="Menos">−</button>
          <input id="qty" type="number" inputMode="numeric" value={qty}
                 onChange={(e) => setQty(Math.max(0, Math.floor(+e.target.value) || 0))} />
          <button onClick={() => setQty((q) => Math.min(9999, q + 1))} aria-label="Más">+</button>
        </div>
      </div>

      <div className={`cam ${camVisible ? 'on' : ''} ${status === 'fail' ? 'fail' : ''}`}>
        {status !== 'lib' && <video ref={videoRef} playsInline muted />}
        <div id="cam-reader" ref={containerRef} />
        {camOn && status === 'native' && <div className="aim" />}
        <p className="cam-msg">{message}</p>
      </div>
      <button className="btn primary big" onClick={() => (camOn ? stop() : start())}>
        {camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
      </button>

      <div className="manual">
        <input value={manual} onChange={(e) => setManual(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitManual())}
               placeholder="Escribe o escanea el código" autoCapitalize="characters" spellCheck="false" enterKeyHint="done" />
        <button className="btn dark" onClick={submitManual}>Registrar</button>
      </div>
      <p className="hint">Con un lector USB o Bluetooth: toca el campo y escanea, se registra solo.</p>

      <label className="field">Ubicación para prendas nuevas
        <select value={newLoc} onChange={(e) => setNewLoc(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>

      {lastMove && (
        <article className="label scan">
          <div className="diamonds" aria-hidden="true"><i /><i /><i /><i /></div>
          <BarcodeBars code={lastMove.product.sku} />
          <div className="sku">{lastMove.product.sku}</div>
          <h3 className="name">{lastMove.product.name}</h3>
          <div className="res">
            <span className={`tag ${lastMove.movement.type}`}>
              {lastMove.movement.type === 'in' ? `Entrada +${lastMove.movement.qty}`
                : lastMove.movement.type === 'out' ? `Salida −${lastMove.movement.qty}`
                : lastMove.movement.type === 'new' ? `Registro nuevo +${lastMove.movement.qty}`
                : `Conteo ${lastMove.product.qty}`}
            </span>
            <span>Quedan <b>{lastMove.product.qty}</b> en {lastMove.product.location_name}</span>
          </div>
          <button className="undo" onClick={() => undo(lastMove.movement.id)}>Deshacer</button>
          <div className="bigsize">{lastMove.product.size || 'U'}</div>
        </article>
      )}

      <h2>En esta sesión</h2>
      {session.length ? (
        <ul className="sess">
          {session.map((m) => (
            <li key={m.id} className={`mv ${m.type}`}>
              <div className="q">{m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : `+${m.qty}`}</div>
              <div className="t">
                <b>{m.product_name}{m.product_size ? ` ${m.product_size}` : ''}</b>
                <small>{LABEL[m.type]} en {m.location_name}, quedan {m.after}</small>
              </div>
              <time>{fmtTime(m.created_at)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aún no has escaneado nada en esta sesión.</p>
      )}

      {pendingSku && (
        <NewProductModal
          sku={pendingSku}
          defaultLocation={newLoc}
          locations={groups}
          onClose={() => setPendingSku(null)}
          onCreated={(res) => {
            setPendingSku(null)
            setLastMove(res)
            setSession((s) => [res.movement, ...s].slice(0, 25))
          }}
        />
      )}
    </section>
  )
}
