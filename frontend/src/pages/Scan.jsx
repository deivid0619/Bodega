import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useLayout } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import NewProductModal from '../components/NewProductModal'
import { LocationSelect } from '../components/ProductModal'
import Icon from '../components/Icon'
import { PageHead, Stepper } from '../components/Bits'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import { fmtTime } from '../utils'

const MODES = [
  { m: 'in', label: 'Entrada', icon: 'boxIn', hint: 'Cada código suma prendas a su ubicación.' },
  { m: 'out', label: 'Salida', icon: 'boxOut', hint: 'Cada código descuenta prendas: ventas y despachos.' },
  { m: 'set', label: 'Conteo', icon: 'equals', hint: 'Cada código reemplaza el total por lo que contaste.' },
]
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

const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : `+${m.qty}`)

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

  const [params] = useSearchParams()
  const groups = useMemo(() => (layout ? locationGroups(layout.elements) : []), [layout])
  useEffect(() => {
    if (newLoc || !groups.length) return
    const wanted = params.get('loc')
    const exists = wanted && groups.some((g) => g.options.some((l) => l.id === wanted))
    setNewLoc(exists ? wanted : groups[0].options[0]?.id || '')
  }, [groups, newLoc, params])

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

  const current = MODES.find((x) => x.m === mode)
  const mv = lastMove?.movement

  return (
    <section className="page" aria-label="Escanear">
      <div className="page-inner">
        <PageHead title="Escanear" lede="Apunta a la etiqueta y la prenda se registra sola." />

        <div className="seg" role="toolbar" aria-label="Tipo de movimiento">
          {MODES.map((x) => (
            <button key={x.m} data-m={x.m} aria-pressed={mode === x.m} onClick={() => { setMode(x.m); if (x.m !== 'set' && qty < 1) setQty(1) }}>
              <Icon name={x.icon} size={18} stroke={2.1} />{x.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{current.hint}</p>

        <div className="viewfinder">
          {status !== 'lib' && <video ref={videoRef} playsInline muted style={{ display: status === 'native' ? 'block' : 'none' }} />}
          <div id="cam-reader" ref={containerRef} style={{ display: status === 'lib' ? 'block' : 'none' }} />
          {status === 'off' && (
            <button className="vf-idle" onClick={start}>
              <Icon name="camera" size={34} stroke={1.7} />
              Toca para abrir la cámara
            </button>
          )}
          {status === 'fail' && (
            <div className="vf-fail">
              <Icon name="alert" size={28} />
              {message}
            </div>
          )}
          {status === 'native' && (
            <>
              <div className="vf-corners" aria-hidden="true"><i /><i /><i /><i /></div>
              <div className="vf-laser" aria-hidden="true" />
            </>
          )}
          {camOn && message && <p className="vf-msg">{message}</p>}
        </div>
        <button className={`btn btn-lg btn-block ${camOn ? 'btn-ink' : 'btn-lime'}`} style={{ marginTop: 12 }} onClick={() => (camOn ? stop() : start())}>
          <Icon name={camOn ? 'x' : 'camera'} size={20} />{camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
        </button>

        <div className="card scan-qty">
          <div>
            <b>{mode === 'set' ? 'Cantidad contada' : 'Prendas por escaneo'}</b>
            <small>{mode === 'set' ? 'Así queda el total de ese código' : 'Normalmente 1'}</small>
          </div>
          <Stepper
            onMinus={() => setQty((q) => Math.max(mode === 'set' ? 0 : 1, q - 1))}
            onPlus={() => setQty((q) => Math.min(9999, q + 1))}
            minusLabel="Menos"
            plusLabel="Más"
            large
          >
            <input aria-label="Cantidad" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(0, Math.floor(+e.target.value) || 0))} />
          </Stepper>
        </div>

        <div className="manual">
          <input
            className="input mono"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitManual())}
            placeholder="Código a mano"
            autoCapitalize="characters"
            spellCheck="false"
            enterKeyHint="done"
            aria-label="Código"
          />
          <button className="btn btn-ink" onClick={submitManual} disabled={!manual.trim()}>Registrar</button>
        </div>
        <p className="mode-hint">Con un lector USB o Bluetooth: toca el campo y escanea.</p>

        <label className="field">
          <span className="field-label">Ubicación para códigos nuevos</span>
          <LocationSelect value={newLoc} onChange={setNewLoc} locations={groups} currentName={newLoc} />
        </label>

        {lastMove && mv && (
          <article className="result rise" key={mv.id} aria-live="polite">
            <div className="result-top">
              <span className={`tag ${mv.type === 'out' ? 'tag-set' : 'tag-in'}`}>
                {mv.type === 'in' ? `Entrada +${mv.qty}` : mv.type === 'out' ? `Salida −${mv.qty}` : mv.type === 'new' ? `Nuevo +${mv.qty}` : `Conteo ${lastMove.product.qty}`}
              </span>
              <span className="code dark" style={{ background: 'rgba(255,255,255,.1)' }}><Icon name="pin" size={13} stroke={2.2} />{lastMove.product.location_id}</span>
            </div>
            <h3 className="result-name">{lastMove.product.name}</h3>
            <div className="result-code mono">{lastMove.product.sku}</div>
            <p className="result-left">Quedan <b>{lastMove.product.qty}</b> en {lastMove.product.location_name}</p>
            <button className="undo" onClick={() => undo(mv.id)}><Icon name="undo" size={16} />Deshacer</button>
            <div className="result-size">{lastMove.product.size || 'U'}</div>
          </article>
        )}

        <h2 className="h-sec">En esta sesión {session.length > 0 && <small>{session.length}</small>}</h2>
        {session.length ? (
          <ul className="moves card panel">
            {session.map((m) => (
              <li key={m.id} className={`move ${m.type}`}>
                <div className="move-q">{qtyText(m)}</div>
                <div className="move-t">
                  <b>{m.product_name}{m.product_size ? ` · ${m.product_size}` : ''}</b>
                  <small>{LABEL[m.type]} en {m.location_id} · quedan {m.after}</small>
                </div>
                <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('es-CO')}>{fmtTime(m.created_at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Lo que escanees aparece aquí, con opción de deshacer.</p>
        )}
      </div>

      {pendingSku && (
        <NewProductModal
          sku={pendingSku}
          defaultLocation={newLoc}
          locations={groups}
          onClose={() => setPendingSku(null)}
          onCreated={(res) => {
            setLastMove(res)
            setSession((s) => [res.movement, ...s].slice(0, 25))
          }}
        />
      )}
    </section>
  )
}
