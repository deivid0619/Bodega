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
import { PageHead, Stepper, plural } from '../components/Bits'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import Viewfinder, { PhotoRead } from '../components/Viewfinder'
import { beep } from '../lib/feedback'
import { fmtTime, outletIdsOf } from '../utils'

const MODES = [
  { m: 'in', label: 'Entrada', icon: 'boxIn', hint: 'Cada código suma prendas a su ubicación.' },
  { m: 'out', label: 'Salida', icon: 'boxOut', hint: 'Cada código descuenta prendas: ventas y despachos.' },
  { m: 'set', label: 'Conteo', icon: 'equals', hint: 'Cada código reemplaza el total por lo que contaste.' },
]
const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado' }

const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const delta = (m) => (m.type === 'in' || m.type === 'new' ? m.qty : m.type === 'out' ? -m.qty : 0)

// "Confirmar antes de guardar": lo escaneado queda en una lista en este
// celular (sobrevive a recargar) hasta que se confirma
const TO_CONFIRM_KEY = 'bodega_por_confirmar'
const CONFIRM_KEY = 'bodega_confirmar'
function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sin almacenamiento (modo privado): la lista vive solo en esta pantalla
  }
}

// "Salió de P-A1 (3) y C-1-2 (1)", "Entró a C-1-3"...
function placesText(res) {
  const parts = res.movements?.length ? res.movements : [res.movement]
  const where = parts.map((m) => (parts.length > 1 ? `${m.location_id} (${m.qty})` : m.location_id)).join(' y ')
  const verb = { in: 'Entró a', out: 'Salió de', set: 'Contado en', new: 'Registrada en', move: 'Movida desde' }[res.movement.type] || 'En'
  return `${verb} ${where}`
}

// donde quedo lo que se escaneo (no la ubicacion principal del codigo):
// "C-1-2", o "C-1-1 +1" si salio de varias
function movedAt(res) {
  const where = [...new Set((res.movements?.length ? res.movements : [res.movement]).map((m) => m.location_id))]
  return where.length > 1 ? `${where[0]} +${where.length - 1}` : where[0]
}

// Lo que se acaba de registrar, encima de la camara: se ve sin dejar de
// apuntar. Antes el aviso quedaba debajo, fuera de la vista, y no se sabia
// si la lectura habia contado (o si conto dos veces)
function ScanHit({ hit, tally, onUndo }) {
  if (hit.err) {
    return (
      <>
        <span key={hit.at} className="vf-pulse err" aria-hidden="true" />
        <div key={`h${hit.at}`} className="vf-hit err" role="status" aria-live="assertive">
          <Icon name="alert" size={22} />
          <span className="vf-hit-t"><b>No se registró</b><small>{hit.err}</small></span>
        </div>
      </>
    )
  }
  const sign = hit.type === 'out' ? `−${hit.qty}` : hit.type === 'set' ? `=${hit.total}` : `+${hit.qty}`
  return (
    <>
      <span key={hit.at} className="vf-pulse" aria-hidden="true" />
      <div key={`h${hit.at}`} className={`vf-hit ${hit.pending ? 'pending' : ''}`} role="status" aria-live="polite">
        <b className={`vf-hit-q ${hit.type === 'out' ? 'out' : ''}`}>{sign}</b>
        <span className="vf-hit-t">
          <b>{hit.name}{hit.size ? ` · ${hit.size}` : ''}</b>
          {hit.pending ? (
            <small>Por confirmar · llevas {signed(hit.type === 'out' ? -hit.lineQty : hit.lineQty)}{hit.n > 1 ? ` (${hit.n} lecturas)` : ''}</small>
          ) : (
            <small>
              {tally && `${tally.n === 1 ? '1 vez' : `${tally.n} veces`} en esta sesión · llevas ${signed(tally.net)} · `}hay {hit.total}
            </small>
          )}
          {hit.short && <small className="vf-hit-warn">Solo hay {hit.have}: revisa antes de confirmar</small>}
          {hit.repeat && <small className="vf-hit-warn">Otra vez la misma prenda: ¿la contaste dos veces?</small>}
        </span>
        <button type="button" className="vf-hit-undo" onClick={onUndo}>{hit.pending ? 'Quitar' : 'Deshacer'}</button>
      </div>
    </>
  )
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
  const [hit, setHit] = useState(null) // lo ultimo registrado, para mostrarlo encima de la camara
  // la misma prenda otra vez en pocos segundos: puede ser la misma etiqueta contada dos veces
  const showHit = (res) => {
    const parts = res.movements?.length ? res.movements : [res.movement]
    const at = Date.now()
    setHit((prev) => ({
      id: res.movement.id, type: res.movement.type, qty: parts.reduce((s, m) => s + m.qty, 0),
      sku: res.product.sku, name: res.product.name, size: res.product.size, total: res.product.qty, at,
      repeat: !!prev && !prev.err && prev.sku === res.product.sku && at - prev.at < 8000,
    }))
  }
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

  // Confirmar antes de guardar (entradas y salidas): cada lectura va a la
  // lista "Por confirmar", ahi se corrige la cuenta y se guarda todo junto
  const [confirmFirst, setConfirmFirst] = useState(() => readStore(CONFIRM_KEY, true) !== false)
  const [toConfirm, setToConfirmState] = useState(() => {
    const v = readStore(TO_CONFIRM_KEY, [])
    return Array.isArray(v) ? v : []
  })
  const toConfirmRef = useRef(toConfirm)
  const setToConfirm = (list) => {
    toConfirmRef.current = list
    setToConfirmState(list)
    writeStore(TO_CONFIRM_KEY, list)
  }
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const outlet = useMemo(() => outletIdsOf(layout), [layout])
  const staged = confirmFirst && mode !== 'set'
  const toConfirmUnits = toConfirm.reduce((t, l) => t + l.qty, 0)
  const toConfirmTypes = new Set(toConfirm.map((l) => l.type))

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
    if (!sku || pendingRef.current || savingRef.current) return
    try {
      if (staged) {
        // no se guarda nada todavia: solo se busca la prenda para la lista
        const p = await api.get(`/api/products/${encodeURIComponent(sku)}`)
        beep(true)
        stage(p)
        return
      }
      const res = await moveStock(sku, mode, qty, place || undefined)
      beep(true)
      record(res)
      showHit(res)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        beep(true)
        pendingRef.current = sku
        setPendingSku(sku)
        return
      }
      beep(false)
      const msg = e instanceof ApiError ? e.message : 'No hay conexión con el servidor. Intenta otra vez.'
      setHit({ err: msg, at: Date.now() })
      showToast(msg, 'err')
    }
  }

  const record = (res) => {
    setLastMove(res)
    const parts = res.movements?.length ? [...res.movements].reverse() : [res.movement]
    setSession((s) => [...parts, ...s].slice(0, 25))
    count(res.movements?.length ? res.movements : [res.movement])
  }

  // una lectura a la lista: el mismo codigo (y tipo y lugar) se va sumando
  const stage = (p) => {
    const loc = place || ''
    const key = `${mode}|${p.sku}|${loc}`
    const list = toConfirmRef.current
    const old = list.find((l) => l.key === key)
    // en una salida, cuanto hay para sacar (sin ubicacion, el outlet no cuenta)
    const have = mode === 'out'
      ? (p.stock || []).reduce((t, st) => t + ((loc ? st.location_id === loc : !outlet.has(st.location_id)) ? st.qty : 0), 0)
      : null
    const line = { key, type: mode, sku: p.sku, name: p.name, size: p.size, loc, main: p.location_id,
                   qty: (old?.qty || 0) + qty, n: (old?.n || 0) + 1, have, edited: old?.edited }
    setToConfirm([line, ...list.filter((l) => l.key !== key)])
    const at = Date.now()
    setHit((prev) => ({
      pending: true, key, type: mode, qty, sku: p.sku, name: p.name, size: p.size, lineQty: line.qty, n: line.n,
      have, short: have != null && line.qty > have, at,
      repeat: !!prev && !prev.err && prev.sku === p.sku && at - prev.at < 8000,
    }))
  }

  // cambiar la cantidad a mano (o quitar la ultima lectura, reading = true)
  const setLineQty = (key, q, reading = false) => {
    const list = toConfirmRef.current
    setToConfirm(q > 0
      ? list.map((l) => (l.key === key ? { ...l, qty: q, err: null, ...(reading ? { n: Math.max(1, l.n - 1) } : { edited: true }) } : l))
      : list.filter((l) => l.key !== key))
    // lo de encima de la camara ya no dice cuantas llevas
    setHit((h) => (h?.pending && h.key === key ? null : h))
  }

  // "Quitar" encima de la camara: deshace la ultima lectura de esa prenda
  const unstage = (key, q) => {
    const l = toConfirmRef.current.find((x) => x.key === key)
    if (l) setLineQty(key, l.qty - q, true)
  }

  const confirmAll = async () => {
    if (savingRef.current || !toConfirmRef.current.length) return
    savingRef.current = true
    setSaving(true)
    setHit(null)
    const lines = [...toConfirmRef.current].reverse() // en el orden en que se escanearon
    const failed = []
    let units = 0
    for (const l of lines) {
      try {
        record(await moveStock(l.sku, l.type, l.qty, l.loc || undefined))
        units += l.qty
      } catch (e) {
        failed.unshift({ ...l, err: e instanceof ApiError ? e.message : 'No hay conexión con el servidor.' })
      }
    }
    setToConfirm(failed)
    setLastMove(null)
    savingRef.current = false
    setSaving(false)
    if (!failed.length) showToast(`Guardado: ${plural(units, 'prenda', 'prendas')}`)
    else showToast(`${units ? `Se guardaron ${units}. ` : ''}${plural(failed.length, 'código no se pudo', 'códigos no se pudieron')} guardar: revisa la lista`, 'err')
  }

  const discardAll = () => {
    const prev = toConfirmRef.current
    setToConfirm([])
    setHit(null)
    showToast('Lista descartada: no se guardó nada', 'ok', {
      label: 'Deshacer',
      onClick: () => {
        const now = toConfirmRef.current
        setToConfirm([...now, ...prev.filter((l) => !now.some((x) => x.key === l.key))])
      },
    })
  }

  const toggleConfirm = () => {
    const on = !confirmFirst
    writeStore(CONFIRM_KEY, on)
    setConfirmFirst(on)
    setHit(null)
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
      if (hit?.id === id) setHit(null)
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
        <PageHead title="Escanear" lede={staged ? 'Apunta a la etiqueta: queda en la lista hasta que confirmes.' : 'Apunta a la etiqueta y la prenda se registra sola.'} />

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
        {mode !== 'set' && (
          <div className="card ctl confirm-ctl">
            <span>
              Confirmar antes de guardar
              <small>{confirmFirst ? 'Lo escaneado queda en una lista: revisas la cuenta y confirmas' : 'Cada lectura se guarda al instante'}</small>
            </span>
            <button type="button" className="switch" role="switch" aria-checked={confirmFirst} aria-label="Confirmar antes de guardar" onClick={toggleConfirm} />
          </div>
        )}
        {mode === 'set' && (
          <button className="link-btn count-link" onClick={() => navigate(`/count${place ? `?loc=${encodeURIComponent(place)}` : ''}`)}>
            ¿Vas a contar toda una ubicación? Usa el conteo por ubicación<Icon name="arrowRight" size={14} stroke={2.4} />
          </button>
        )}

        <Viewfinder
          scanner={scanner}
          overlay={hit && <ScanHit hit={hit} tally={hit.sku && tally[hit.sku]} onUndo={() => (hit.pending ? unstage(hit.key, hit.qty) : undo(hit.id))} />}
        />
        <button className={`btn btn-lg btn-block ${camOn ? 'btn-ink' : 'btn-lime'}`} style={{ marginTop: 12 }} onClick={() => (camOn ? stop() : start())}>
          <Icon name={camOn ? 'x' : 'camera'} size={20} />{camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
        </button>
        <PhotoRead scanner={scanner} onMiss={() => showToast('No encontré un código en la foto. Tómala más de cerca, derecha y con luz.', 'err')} />

        {toConfirm.length > 0 && (
          <div className="card to-confirm" aria-label="Por confirmar">
            <div className="to-confirm-head">
              <div>
                <b>Por confirmar</b>
                <small>{plural(toConfirmUnits, 'prenda', 'prendas')} · {plural(toConfirm.length, 'código', 'códigos')} · aún no se guarda nada</small>
              </div>
              <button type="button" className="btn btn-lime" onClick={confirmAll} disabled={saving}>
                <Icon name="check" size={18} stroke={2.4} />
                {saving ? 'Guardando…' : toConfirmTypes.size > 1 ? 'Confirmar' : toConfirmTypes.has('out') ? 'Confirmar salida' : 'Confirmar entrada'}
              </button>
            </div>
            {toConfirm.map((l) => (
              <div className={`need to-confirm-row ${l.err ? 'err' : ''}`} key={l.key}>
                <div className="need-t">
                  <b>{l.name}{l.size ? ` · ${l.size}` : ''}</b>
                  <small>
                    <span className={`to-confirm-type ${l.type}`}>{l.type === 'out' ? 'Salida' : 'Entrada'}</span>
                    {l.type === 'out' ? ' de ' : ' en '}{l.loc || (l.type === 'out' ? 'donde haya' : l.main)} · {l.edited ? 'cantidad ajustada' : plural(l.n, 'lectura', 'lecturas')}
                  </small>
                  {l.err ? <small className="to-confirm-msg">{l.err}</small>
                    : l.have != null && l.qty > l.have && <small className="to-confirm-msg">Solo hay {l.have}</small>}
                </div>
                <Stepper value={l.qty} small disabledMinus={l.qty <= 1 || saving}
                         onMinus={() => setLineQty(l.key, l.qty - 1)} onPlus={() => setLineQty(l.key, l.qty + 1)}
                         minusLabel={`Quitar 1 de ${l.name}`} plusLabel={`Sumar 1 a ${l.name}`} />
                <button type="button" className="to-confirm-x" onClick={() => setLineQty(l.key, 0)} disabled={saving} aria-label={`Quitar ${l.name} de la lista`}>
                  <Icon name="x" size={16} stroke={2.4} />
                </button>
              </div>
            ))}
            <button type="button" className="link-btn to-confirm-discard" onClick={discardAll} disabled={saving}>Descartar todo</button>
          </div>
        )}

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
          <button className="btn btn-ink" onClick={submitManual} disabled={!manual.trim()}>{staged ? 'Agregar' : 'Registrar'}</button>
        </div>
        <p className="mode-hint">Con un lector USB o Bluetooth: toca el campo y escanea.</p>


        {lastMove && mv && (
          <article className="result rise" key={mv.id} aria-live="polite">
            <div className="result-top">
              <span className={`tag ${mv.type === 'out' ? 'tag-set' : 'tag-in'}`}>
                {mv.type === 'in' ? `Entrada +${mv.qty}` : mv.type === 'out' ? `Salida −${mv.qty}` : mv.type === 'new' ? `Nuevo +${mv.qty}` : `Conteo ${lastMove.product.qty}`}
              </span>
              <span className="code dark" style={{ background: 'rgba(255,255,255,.1)' }}><Icon name="pin" size={13} stroke={2.2} />{movedAt(lastMove)}</span>
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
            showHit(res)
          }}
        />
      )}
    </section>
  )
}
