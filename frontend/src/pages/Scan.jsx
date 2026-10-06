import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { moveStock, refreshInventory, useLayout } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import NewProductModal from '../components/NewProductModal'
import FacturaSheet from '../components/FacturaSheet'
import RemisionSheet from '../components/RemisionSheet'
import ParcelSheet from '../components/ParcelSheet'
import Icon from '../components/Icon'
import { PageHead, Stepper } from '../components/Bits'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import Viewfinder, { PhotoRead } from '../components/Viewfinder'
import { beep } from '../lib/feedback'
import { fmtTime } from '../utils'

const MODES = [
  { m: 'in', label: 'Entrada', icon: 'boxIn', hint: 'Cada código suma prendas a su ubicación.' },
  { m: 'out', label: 'Salida', icon: 'boxOut', hint: 'Cada código descuenta prendas: ventas y despachos.' },
  { m: 'set', label: 'Conteo', icon: 'equals', hint: 'Cada código reemplaza el total por lo que contaste.' },
]
const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado' }

const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const delta = (m) => (m.type === 'in' || m.type === 'new' ? m.qty : m.type === 'out' ? -m.qty : 0)

// "Salió de P-A1 (3) y C-1-2 (1)", "Entró a C-1-3"...
function placesText(res) {
  const parts = res.movements?.length ? res.movements : [res.movement]
  const where = parts.map((m) => (parts.length > 1 ? `${m.location_id} (${m.qty})` : m.location_id)).join(' y ')
  const verb = { in: 'Entró a', out: 'Salió de', set: 'Contado en', new: 'Registrada en', move: 'Movida desde' }[res.movement.type] || 'En'
  return `${verb} ${where}`
}

export default function Scan() {
  const { data: layout } = useLayout()
  const showToast = useToast()
  const [mode, setMode] = useState('in')
  const [qty, setQty] = useState(1)
  const [manual, setManual] = useState('')
  const [pendingSku, setPendingSku] = useState(null)
  const [lastMove, setLastMove] = useState(null)
  const [factura, setFactura] = useState(false)
  const [remision, setRemision] = useState(false)
  const [parcel, setParcel] = useState(false)
  const [session, setSession] = useState([])
  // lo que llevas registrado en esta sesion, por codigo (la lista de abajo
  // solo muestra lo ultimo; esto no se corta): asi no se pierde la cuenta
  const [tally, setTally] = useState({})
  const count = (parts, sign = 1, after) => setTally((t) => {
    const m = parts[parts.length - 1]
    const cur = t[m.sku] || { sku: m.sku, name: m.product_name, size: m.product_size, net: 0, n: 0, counted: false }
    return {
      ...t,
      [m.sku]: {
        ...cur,
        net: cur.net + sign * parts.reduce((s, p) => s + delta(p), 0),
        n: cur.n + sign,
        after: after ?? m.after,
        counted: cur.counted || m.type === 'set',
        at: Date.now(),
      },
    }
  })
  const tallyList = useMemo(() => Object.values(tally).filter((t) => t.n > 0).sort((a, b) => b.at - a.at), [tally])
  // '' = automatica (la ubicacion principal de cada codigo); null = aun sin decidir
  const [place, setPlace] = useState(null)

  const [params] = useSearchParams()
  const navigate = useNavigate()
  const groups = useMemo(() => (layout ? locationGroups(layout.elements) : []), [layout])
  useEffect(() => {
    if (place !== null || !groups.length) return
    const wanted = params.get('loc')
    const exists = wanted && groups.some((g) => g.options.some((l) => l.id === wanted))
    setPlace(exists ? wanted : '')
  }, [groups, place, params])
  const firstLoc = groups[0]?.options[0]?.id || ''

  const pendingRef = useRef(null)
  pendingRef.current = pendingSku

  // un solo viaje al servidor por codigo: si no existe, responde 404 y se
  // ofrece registrarlo
  const handleCode = async (raw) => {
    const sku = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
    if (!sku || pendingRef.current) return
    try {
      const res = await moveStock(sku, mode, qty, place || undefined)
      beep(true)
      setLastMove(res)
      const parts = res.movements?.length ? [...res.movements].reverse() : [res.movement]
      setSession((s) => [...parts, ...s].slice(0, 25))
      count(res.movements?.length ? res.movements : [res.movement])
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        beep(true)
        pendingRef.current = sku
        setPendingSku(sku)
        return
      }
      beep(false)
      showToast(e instanceof ApiError ? e.message : 'No hay conexión con el servidor. Intenta otra vez.', 'err')
    }
  }

  const scanner = useBarcodeScanner(handleCode)
  const { status, start, stop } = scanner
  const camOn = status === 'on'

  // con un formulario encima (prenda nueva, factura, remision, algo de paso) la camara y
  // la linterna se apagan; al cerrar la prenda nueva, se vuelve a abrir
  const resumeRef = useRef(false)
  const covered = !!pendingSku || factura || remision || parcel
  useEffect(() => {
    if (covered && camOn) {
      resumeRef.current = !!pendingSku
      stop()
    } else if (!covered && resumeRef.current) {
      resumeRef.current = false
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered])

  useEffect(() => () => { stop() }, [stop])

  const submitManual = () => {
    handleCode(manual)
    setManual('')
  }

  const undo = async (id) => {
    try {
      const product = await api.post(`/api/movements/${id}/undo`)
      refreshInventory()
      const undone = session.find((m) => m.id === id)
      if (undone) count([undone], -1, product.qty)
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

        <div className="doc-cards">
          <button className="doc-card in" onClick={() => setRemision(true)}>
            <span className="doc-ico"><Icon name="boxIn" size={22} /></span>
            <span className="doc-card-t"><b>Recibir remisión</b><small>Lo que llega del proveedor</small></span>
          </button>
          <button className="doc-card" onClick={() => setFactura(true)}>
            <span className="doc-ico"><Icon name="receipt" size={22} /></span>
            <span className="doc-card-t"><b>Descontar factura</b><small>Lo que salió en cajas</small></span>
          </button>
          <button className="doc-card light wide" onClick={() => setParcel(true)}>
            <span className="doc-ico"><Icon name="box" size={22} /></span>
            <span className="doc-card-t"><b>Anotar algo de paso</b><small>Caja suelta, canasta…: de quién es y qué hacer</small></span>
            <Icon name="arrowRight" size={18} />
          </button>
        </div>

        <div className="seg" role="toolbar" aria-label="Tipo de movimiento">
          {MODES.map((x) => (
            <button key={x.m} data-m={x.m} aria-pressed={mode === x.m} onClick={() => { setMode(x.m); if (x.m !== 'set' && qty < 1) setQty(1) }}>
              <Icon name={x.icon} size={18} stroke={2.1} />{x.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{current.hint}</p>
        {mode === 'set' && (
          <button className="link-btn count-link" onClick={() => navigate(`/count${place ? `?loc=${encodeURIComponent(place)}` : ''}`)}>
            ¿Vas a contar toda una ubicación? Usa el conteo por ubicación<Icon name="arrowRight" size={14} stroke={2.4} />
          </button>
        )}

        <Viewfinder scanner={scanner} />
        <button className={`btn btn-lg btn-block ${camOn ? 'btn-ink' : 'btn-lime'}`} style={{ marginTop: 12 }} onClick={() => (camOn ? stop() : start())}>
          <Icon name={camOn ? 'x' : 'camera'} size={20} />{camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
        </button>
        <PhotoRead scanner={scanner} onMiss={() => showToast('No encontré un código en la foto. Tómala más de cerca, derecha y con luz.', 'err')} />

        <div className={`card scan-qty ${mode !== 'set' && qty > 1 ? 'bulk' : ''}`}>
          <div>
            <b>{mode === 'set' ? 'Cantidad contada' : 'Prendas por escaneo'}</b>
            <small>
              {mode === 'set' ? 'Así queda el total de ese código'
                : qty > 1 ? `Ojo: cada lectura ${mode === 'out' ? 'descuenta' : 'suma'} ${qty}` : 'Normalmente 1'}
            </small>
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

        <label className="field">
          <span className="field-label">¿Dónde?</span>
          <select className="input" value={place || ''} onChange={(e) => setPlace(e.target.value)}>
            <option value="">Automática: la ubicación principal de cada código</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="field-hint">
            {mode === 'out'
              ? place ? `Las salidas se descuentan solo de ${place}.` : 'Sale primero de la ubicación principal y, si no alcanza, de donde haya.'
              : place ? `Lo que escanees ${mode === 'set' ? 'se cuenta' : 'entra'} en ${place}.` : `Cada código ${mode === 'set' ? 'se cuenta' : 'entra'} en su ubicación principal.`}
          </span>
        </label>

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
            <p className="result-left">
              {placesText(lastMove)} · quedan <b>{lastMove.product.qty}</b> en total
              {tally[lastMove.product.sku]?.n > 1 && <> · llevas <b>{signed(tally[lastMove.product.sku].net)}</b> en esta sesión</>}
            </p>
            <button className="undo" onClick={() => undo(mv.id)}><Icon name="undo" size={16} />Deshacer</button>
            <div className="result-size">{lastMove.product.size || 'U'}</div>
          </article>
        )}

        <h2 className="h-sec">En esta sesión {session.length > 0 && <small>{session.length}</small>}</h2>
        {tallyList.length > 0 && (
          <div className="card panel tally" aria-label="Lo que llevas por código">
            {tallyList.map((t) => (
              <div className="need" key={t.sku}>
                <div className="need-t">
                  <b>{t.name}{t.size ? ` · ${t.size}` : ''}</b>
                  <small><span className="mono">{t.sku}</span> · {t.n === 1 ? '1 registro' : `${t.n} registros`} · hay {t.after} en total</small>
                </div>
                <div className={`need-q ${t.net < 0 ? 'dark' : !t.net ? 'idle' : ''}`}>
                  <b>{t.net || !t.counted ? signed(t.net) : `=${t.after}`}</b><span>{t.net || !t.counted ? 'llevas' : 'contado'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
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

      {factura && <FacturaSheet onClose={() => setFactura(false)} />}
      {remision && <RemisionSheet onClose={() => setRemision(false)} />}
      {parcel && <ParcelSheet defaultLocation={place || undefined} onClose={() => setParcel(false)} />}
      {pendingSku && (
        <NewProductModal
          sku={pendingSku}
          defaultLocation={place || firstLoc}
          locations={groups}
          onClose={() => setPendingSku(null)}
          onCreated={(res) => {
            refreshInventory()
            setLastMove(res)
            setSession((s) => [res.movement, ...s].slice(0, 25))
            count([res.movement])
          }}
        />
      )}
    </section>
  )
}
