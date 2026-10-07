import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { refreshInventory, revalidate, useLayout, usePolling, useProducts } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { SearchField, Stepper, plural } from './Bits'
import { cleanCode, matchLine } from '../lib/facturaParser'
import { saveDocPhoto } from '../lib/docPhotos'
import { beep } from '../lib/feedback'
import { asksFrom, fromMissing, outAvailable, outParts, outletIdsOf, pedidoLabel, placesOf } from '../utils'
import FromPick from './FromPick'
import ScanBox from './ScanBox'
import { AttachBody } from './AttachFactura'
import { PhotoButtons, ReadingStep, readFactura } from './FacturaParts'
import { useCrop } from './PhotoCrop'

let nextId = 1

function toRow(line, m) {
  return { id: nextId++, ...line, sku: m.sku, product: m.product, how: m.how, include: false }
}

// incluida por defecto solo si se reconocio y hay con que descontar (sin
// contar el outlet: una salida sin elegir de donde no lo toca)
function withDefault(row, outlet) {
  return { ...row, include: !!row.product && outAvailable(row.product, outlet, row.from) >= row.qty }
}

// Lo primero: ¿ya esta la factura? Si no, se arma el pedido y la factura se
// anexa despues. Abajo, los pedidos que siguen esperando la suya.
function StartStep({ onHave, onPedido, onAttach }) {
  const { data: waiting } = usePolling('/api/documents?kind=factura&status=espera&limit=50', { interval: 30000 })
  return (
    <>
      <SheetHeader title="Descontar factura" subtitle="¿Ya tienes la factura?" />
      <div className="doc-cards start-cards">
        <button type="button" className="doc-card in" onClick={onHave}>
          <span className="doc-ico"><Icon name="receipt" size={22} /></span>
          <span className="doc-card-t"><b>Ya tengo la factura</b><small>Foto, revisas y se descuenta</small></span>
        </button>
        <button type="button" className="doc-card" onClick={onPedido}>
          <span className="doc-ico"><Icon name="box" size={22} /></span>
          <span className="doc-card-t"><b>Todavía no: armar pedido</b><small>Escaneas lo que empacas; la factura se anexa después</small></span>
        </button>
      </div>
      {waiting?.length > 0 && (
        <>
          <h3 className="h-sec">Esperando factura <small>{waiting.length}</small></h3>
          <div className="card panel">
            {waiting.map((d) => (
              <button type="button" key={d.id} className="need doc-item" onClick={() => onAttach(d)}>
                <span className="need-t">
                  <b>{pedidoLabel(d)}</b>
                  <small>{[plural(d.units, 'prenda', 'prendas'), d.notes, d.user_name].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="wait-go">Anexar factura<Icon name="arrowRight" size={15} stroke={2.4} /></span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function PickStep({ onFile, error, onBack }) {
  return (
    <>
      <SheetHeader title="Descontar una factura" subtitle="Toma una foto de la factura impresa. La app lee los códigos y las cantidades, tú revisas y confirmas." />
      {error && <p className="form-err" role="alert">{error}</p>}
      <PhotoButtons onFile={onFile} />
      <details className="doc-help">
        <summary>Recomendaciones para usarla bien</summary>
        <ul>
          <li>Que se vea toda la tabla de productos, derecha, con buena luz y sin sombras.</li>
          <li>Revisa cada línea antes de confirmar: si un código o una cantidad no se leyó bien, corrígelo.</li>
          <li>Si ya descontaste esas prendas por otro lado, al revisar marca “Solo registro”: se guarda la factura sin descontar otra vez.</li>
          <li>La foto se guarda un mes como prueba de lo que salió (se puede ver y descargar en Resumen). Después se borra sola.</li>
        </ul>
      </details>
      <button type="button" className="link-btn" style={{ marginTop: 14 }} onClick={onBack}>Volver</button>
    </>
  )
}

const PEDIDO_KEY = 'bodega_pedido_borrador'

// Armar un pedido sin factura: se escanea (o se busca) lo que se va
// empacando y, al terminar, se descuenta todo junto. Queda esperando la
// factura. Lo armado se guarda en este celular por si se cierra la hoja.
function PedidoStep({ onSaved, onBack }) {
  const showToast = useToast()
  const { data: products } = useProducts()
  const { data: layout } = useLayout()
  const outlet = outletIdsOf(layout)
  const bySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(PEDIDO_KEY) || 'null') || {} } catch { return {} }
  }, [])
  const [lines, setLines] = useState(saved.lines || []) // [{ sku, qty, from }]
  const [notes, setNotes] = useState(saved.notes || '')
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState(null)
  const [saving, setSaving] = useState(false)
  const [orderPhoto, setOrderPhoto] = useState(null) // la foto del pedido del cliente (la de la factura va despues)
  const [orderPreview, setOrderPreview] = useState(null)
  const orderInput = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(PEDIDO_KEY, JSON.stringify({ lines, notes })) } catch { /* sin almacenamiento */ }
  }, [lines, notes])
  useEffect(() => () => { if (orderPreview) URL.revokeObjectURL(orderPreview) }, [orderPreview])
  const [cropEl, crop] = useCrop()
  const pickOrder = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const out = await crop(f)
    if (!out) return
    setOrderPhoto(out)
    setOrderPreview(URL.createObjectURL(out))
  }

  const add = (p) => {
    const had = lines.find((l) => l.sku === p.sku)?.qty || 0
    setLines((ls) => (ls.some((l) => l.sku === p.sku)
      ? ls.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l))
      : [...ls, { sku: p.sku, qty: 1, from: undefined }]))
    setFlash({ text: `+1 · ${p.name}${p.size ? ` · ${p.size}` : ''}${had ? ` (van ${had + 1})` : ''}`, at: Date.now() })
  }
  const onCode = async (raw) => {
    const code = cleanCode(raw)
    if (!code) return
    try {
      // una etiqueta con el codigo mal ya corregida la resuelve el servidor
      const p = bySku.get(code) || await api.get(`/api/products/${encodeURIComponent(code)}`)
      beep(true)
      add(p)
    } catch (e) {
      beep(false)
      setFlash({ err: true, at: Date.now(), text: e instanceof ApiError && e.status === 404 ? `${code}: no está en la bodega` : 'No hay conexión con el servidor.' })
    }
  }
  const update = (sku, patch) => setLines((ls) => ls.map((l) => (l.sku === sku ? { ...l, ...patch } : l)))
  const remove = (sku) => setLines((ls) => ls.filter((l) => l.sku !== sku))

  const term = q.trim().toUpperCase()
  const found = useMemo(() => {
    if (term.length < 2) return []
    const words = term.split(/\s+/)
    const code = term.replace(/\s+/g, '')
    return (products || []).filter((p) => p.sku.includes(code) || words.every((w) => p.name.includes(w))).slice(0, 6)
  }, [term, products])

  const units = lines.reduce((t, l) => t + l.qty, 0)
  const short = lines.find((l) => { const p = bySku.get(l.sku); return !p || outAvailable(p, outlet, l.from) < l.qty })
  const missingFrom = lines.filter((l) => { const p = bySku.get(l.sku); return p && fromMissing(l.from, l.qty, placesOf(p, outlet)) }).length
  const problem = !lines.length ? 'Escanea o busca lo que vas empacando.'
    : short ? `No alcanza: ${bySku.get(short.sku)?.name || short.sku}${bySku.get(short.sku)?.size ? ` · ${bySku.get(short.sku).size}` : ''}.`
      : missingFrom ? (missingFrom === 1 ? 'Falta elegir de dónde sale una prenda.' : `Falta elegir de dónde salen ${missingFrom} prendas.`)
        : ''

  const confirm = async () => {
    setSaving(true)
    try {
      const parts = lines.flatMap((l) => outParts(l.qty, l.from || '', bySku.get(l.sku))
        .map((x) => ({ sku: l.sku, qty: x.qty, ...(x.loc ? { location_id: x.loc } : {}) })))
      const res = await api.post('/api/documents/pedido', { lines: [...parts.filter((x) => x.location_id), ...parts.filter((x) => !x.location_id)], notes: notes.trim() })
      try { localStorage.removeItem(PEDIDO_KEY) } catch { /* sin almacenamiento */ }
      refreshInventory()
      // la foto del pedido del cliente queda con el pedido; la de la factura se suma al anexarla
      let kept = !orderPhoto
      if (orderPhoto) {
        try {
          await saveDocPhoto(res.document.id, orderPhoto)
          kept = true
        } catch {
          kept = false
        }
      }
      revalidate('/api/documents')
      showToast(`Pedido empacado: ${plural(units, 'prenda descontada', 'prendas descontadas')}. Queda esperando la factura.${
        orderPhoto ? (kept ? ' Foto del pedido guardada.' : ' La foto no se guardó: agrégala desde Resumen.') : ''}`, kept ? 'ok' : 'err')
      onSaved()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No se descontó nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-warn">Sin factura todavía</span></div>}
        title="Armar pedido"
        subtitle="Escanea o busca lo que vas empacando. Al terminar, toca “Pedido empacado” y se descuenta todo junto."
      />
      <ScanBox onCode={onCode} flash={flash} hint="Cada etiqueta suma una. Con un lector USB o Bluetooth: toca el campo y escanea." />
      <div style={{ marginTop: 14 }}>
        <SearchField value={q} onChange={setQ} placeholder="O busca la referencia o el código" />
        {found.length > 0 && (
          <div className="ref-results">
            {found.map((p) => (
              <button key={p.sku} type="button" className="ref-result" onClick={() => { add(p); setQ('') }}>
                {p.image_url ? <img src={p.image_url} alt="" /> : null}
                <span className="ref-result-t">
                  <b>{p.name}{p.size ? ` · ${p.size}` : ''}</b>
                  <small><span className="mono">{p.sku}</span> · hay {outAvailable(p, outlet)}</small>
                </span>
                <Icon name="plus" size={18} stroke={2.2} />
              </button>
            ))}
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <>
          <h3 className="h-sec">En el pedido <small>{plural(units, 'prenda', 'prendas')}</small></h3>
          <div className="doc-lines">
            {lines.map((l) => {
              const p = bySku.get(l.sku)
              const places = p ? placesOf(p, outlet) : []
              const avail = p ? outAvailable(p, outlet, l.from) : 0
              return (
                <div key={l.sku} className={`doc-line ${avail < l.qty ? 'short' : 'ok'}`}>
                  <button type="button" className="doc-check rm" aria-label="Quitar del pedido" onClick={() => remove(l.sku)}>
                    <Icon name="x" size={14} stroke={3} />
                  </button>
                  <div className="doc-line-t">
                    <b>{p ? `${p.name}${p.size ? ` · ${p.size}` : ''}` : l.sku}</b>
                    <small><span className="mono">{l.sku}</span> · {avail < l.qty ? `solo hay ${avail}` : `hay ${avail}`}</small>
                  </div>
                  <Stepper
                    value={l.qty}
                    onMinus={() => update(l.sku, { qty: Math.max(1, l.qty - 1) })}
                    onPlus={() => update(l.sku, { qty: l.qty + 1 })}
                    disabledMinus={l.qty <= 1}
                  />
                  {asksFrom(places) && <FromPick places={places} value={l.from} qty={l.qty} onChange={(v) => update(l.sku, { from: v })} />}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="field">
        <span className="field-label">Foto del pedido del cliente <small className="opt">si quieres</small></span>
        <input ref={orderInput} type="file" accept="image/*" hidden onChange={pickOrder} />
        {cropEl}
        {orderPreview ? (
          <div className="order-photo">
            <img src={orderPreview} alt="Foto del pedido del cliente" />
            <button type="button" className="link-btn" onClick={() => { setOrderPhoto(null); setOrderPreview(null) }}>Quitar</button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => orderInput.current.click()}>
            <Icon name="camera" size={18} />Tomar o elegir la foto
          </button>
        )}
        <span className="field-hint">Queda con el pedido; la foto de la factura se agrega al anexarla. Las dos se guardan un mes.</span>
      </div>

      <label className="field">
        <span className="field-label">Pedido o cliente <small className="opt">si quieres</small></span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Ej. pedido 1045 de la tienda, Ana Gómez" />
      </label>

      <div className="doc-footer">
        <p className="mode-hint">{problem || 'Se descuenta todo junto y queda “Esperando factura”: cuando te la pasen, la anexas desde aquí.'}</p>
        <button type="button" className="btn btn-lime btn-lg btn-block" disabled={!!problem || saving} onClick={confirm}>
          {saving ? 'Guardando…' : `Pedido empacado · descontar ${plural(units, 'prenda', 'prendas')}`}
        </button>
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={onBack}>Volver</button>
      </div>
    </>
  )
}

function Body({ onDone }) {
  const showToast = useToast()
  const { close } = useSheet()
  const { data: products } = useProducts()
  const { data: layout } = useLayout()
  const outlet = outletIdsOf(layout)
  const [step, setStep] = useState('start') // start | pick | reading | review | pedido | attach
  const [stage, setStage] = useState('preparing')
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState(null)
  const [photoFile, setPhotoFile] = useState(null) // la foto, para guardarla como prueba al confirmar
  const [error, setError] = useState('')
  const [number, setNumber] = useState('')
  const [rows, setRows] = useState([])
  const [dup, setDup] = useState(null)
  const [recordOnly, setRecordOnly] = useState(false) // ya se desconto por otro lado: solo el registro
  const [attach, setAttach] = useState(null) // el pedido al que se le anexa la factura
  const [saving, setSaving] = useState(false)
  const known = products || []

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const onFile = async (file) => {
    setError('')
    setPreview(URL.createObjectURL(file))
    setPhotoFile(file)
    setProgress(0)
    setStage('preparing')
    setStep('reading')
    try {
      const r = await readFactura(file, known, { onProgress: setProgress, onStage: setStage })
      if (!r.lines.length) {
        setStep('pick')
        setError('No se encontraron líneas de productos. Toma la foto más derecha y más cerca de la tabla.')
        return
      }
      setNumber(r.number)
      setRows(r.lines.map((l, i) => withDefault(toRow(l, r.matches[i]), outlet)))
      setStep('review')
    } catch {
      setStep('pick')
      setError('No se pudo leer la foto. Revisa la conexión la primera vez (se descarga el lector) e intenta de nuevo.')
    }
  }

  // la misma factura no se puede registrar dos veces
  useEffect(() => {
    const n = number.trim()
    if (step !== 'review' || n.length < 4) { setDup(null); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/documents?kind=factura&number=${encodeURIComponent(n)}`)
        .then((list) => setDup(list[0] || null))
        .catch(() => setDup(null))
    }, 300)
    return () => clearTimeout(t)
  }, [number, step])

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const recode = (row, code) => {
    const line = { ...row, code: cleanCode(code) }
    const claimed = new Set(rows.filter((r) => r.id !== row.id && r.product).map((r) => r.sku))
    const m = matchLine(line, known, claimed)
    update(row.id, { code: line.code, sku: m.sku, product: m.product, how: m.how, from: undefined,
                     include: !!m.product && outAvailable(m.product, outlet, undefined) >= row.qty })
  }

  // solo registro: van todas las reconocidas (ya se descontaron, aunque hoy no haya existencias)
  const toggleRecord = () => {
    const next = !recordOnly
    setRecordOnly(next)
    setRows((rs) => rs.map((r) => (next ? { ...r, include: !!r.product } : withDefault(r, outlet))))
  }

  const chosen = rows.filter((r) => r.include && r.product)
  const units = chosen.reduce((t, r) => t + r.qty, 0)
  const pending = rows.filter((r) => !r.include).length
  // solo registro: no se descuenta, asi que no importa cuanto hay ni de donde sale
  const blocked = !recordOnly && chosen.some((r) => outAvailable(r.product, outlet, r.from) < r.qty)
  // prendas que estan en varios lugares: hay que decir de cual salen
  const missingFrom = recordOnly ? 0 : chosen.filter((r) => fromMissing(r.from, r.qty, placesOf(r.product, outlet))).length

  const confirm = async () => {
    setSaving(true)
    try {
      let lines
      if (recordOnly) {
        lines = chosen.map((r) => ({ sku: r.sku, qty: r.qty }))
      } else {
        // primero lo que sale de una ubicacion elegida y despues lo de donde haya
        const parts = chosen.flatMap((r) => outParts(r.qty, r.from || '', r.product).map((x) => ({ sku: r.sku, qty: x.qty, ...(x.loc ? { location_id: x.loc } : {}) })))
        lines = [...parts.filter((x) => x.location_id), ...parts.filter((x) => !x.location_id)]
      }
      const res = await api.post('/api/documents/factura', { number: number.trim(), lines, record_only: recordOnly })
      refreshInventory()
      // la foto queda como prueba (un mes); si no sube, la factura igual quedo
      let kept = false
      if (photoFile) {
        try {
          await saveDocPhoto(res.document.id, photoFile)
          kept = true
        } catch {
          kept = false
        }
      }
      revalidate('/api/documents')
      showToast(`Factura ${number.trim().toUpperCase()}: ${recordOnly ? `registro de ${plural(units, 'prenda', 'prendas')} (no se descontó nada)` : plural(units, 'prenda descontada', 'prendas descontadas')}${
        photoFile ? (kept ? ' · foto guardada un mes' : ' · la foto no se guardó: agrégala desde Resumen') : ''}`, kept || !photoFile ? 'ok' : 'err')
      onDone?.()
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No se descontó nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'start') {
    return <StartStep onHave={() => setStep('pick')} onPedido={() => setStep('pedido')} onAttach={(d) => { setAttach(d); setStep('attach') }} />
  }
  if (step === 'pedido') return <PedidoStep onSaved={() => setStep('start')} onBack={() => setStep('start')} />
  if (step === 'attach' && attach) {
    return <AttachBody pedido={attach} onBack={() => setStep('start')} onDone={() => { onDone?.(); close() }} />
  }
  if (step === 'pick') return <PickStep onFile={onFile} error={error} onBack={() => { setError(''); setStep('start') }} />
  if (step === 'reading') return <ReadingStep preview={preview} stage={stage} progress={progress} />

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-out">{recordOnly ? 'Solo registro' : 'Salida por factura'}</span></div>}
        title={recordOnly ? 'Revisa antes de guardar' : 'Revisa antes de descontar'}
        subtitle={`${plural(rows.length, 'línea leída', 'líneas leídas')} · ${pending ? `${pending} sin incluir` : 'todas incluidas'}`}
      />
      <label className="field" style={{ marginTop: 0 }}>
        <span className="field-label">Número de factura</span>
        <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="Ej. FEV21830" />
      </label>
      {dup && (
        <p className="form-err" role="alert">
          Esta factura ya se registró el {new Date(dup.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} ({dup.user_name}). No se puede aplicar dos veces.
        </p>
      )}
      <div className="menu-check rem-toggle">
        <span>Solo registro<small>Ya descontaste estas prendas por otro lado: se guarda la factura y su foto sin descontar otra vez.</small></span>
        <button type="button" className="switch" role="switch" aria-checked={recordOnly} aria-label="Solo registro" onClick={toggleRecord} />
      </div>

      <div className="doc-lines">
        {rows.map((r) => {
          const places = r.product ? placesOf(r.product, outlet) : []
          const avail = r.product ? outAvailable(r.product, outlet, r.from) : 0
          const inOutlet = places.filter((x) => x.outlet).reduce((t, x) => t + x.qty, 0)
          const fromOutlet = places.find((x) => x.outlet && x.id === r.from)
          // lo del outlet solo cuenta si se eligio que sale de ahi
          const outletNote = !inOutlet ? '' : fromOutlet ? ` (con ${fromOutlet.qty} del outlet)` : ` · ${inOutlet} más en outlet`
          const short = !recordOnly && r.product && avail < r.qty
          const state = !r.product ? 'unknown' : short ? 'short' : 'ok'
          const shown = r.product ? r.sku : r.code
          return (
            <div key={r.id} className={`doc-line ${r.include ? '' : 'off'} ${state}`}>
              <button
                type="button"
                className="doc-check"
                aria-pressed={r.include}
                aria-label={r.include ? 'Quitar de la factura' : 'Incluir'}
                disabled={!r.product}
                onClick={() => update(r.id, { include: !r.include })}
              >
                <Icon name="check" size={15} stroke={3} />
              </button>
              <div className="doc-line-t">
                <input
                  className="doc-code"
                  defaultValue={shown}
                  key={`${r.id}-${r.sku}`}
                  onBlur={(e) => e.target.value.trim() !== shown && recode(r, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label="Código"
                  spellCheck="false"
                  autoCapitalize="characters"
                />
                <b>{r.product ? `${r.product.name}${r.product.size ? ` · ${r.product.size}` : ''}` : r.description}</b>
                <small>
                  {state === 'unknown' && 'No está en la bodega. Corrige el código o déjala por fuera.'}
                  {state === 'short' && `Solo hay ${avail} para sacar${inOutlet && !fromOutlet ? ` (y ${inOutlet} en outlet: elígelo abajo si salen de ahí)` : ''}.`}
                  {state === 'ok' && (recordOnly ? 'Solo se anota: no se descuenta' : `Hay ${avail}${outletNote}${r.how === 'fixed' && r.read.replace(/\s/g, '') !== r.sku ? ` · se leyó ${r.read}` : ''}`)}
                </small>
              </div>
              <Stepper
                value={r.qty}
                onMinus={() => update(r.id, { qty: Math.max(1, r.qty - 1) })}
                onPlus={() => update(r.id, { qty: r.qty + 1 })}
                disabledMinus={r.qty <= 1}
              />
              {!recordOnly && r.include && asksFrom(places) && (
                <FromPick places={places} value={r.from} qty={r.qty} onChange={(v) => update(r.id, { from: v })} />
              )}
            </div>
          )
        })}
      </div>

      <div className="doc-footer">
        {missingFrom > 0 && (
          <p className="to-confirm-ask">
            {missingFrom === 1 ? 'Falta elegir de dónde sale una prenda' : `Falta elegir de dónde salen ${missingFrom} prendas`}: está en varios lugares
          </p>
        )}
        <p className="mode-hint">{recordOnly ? 'Solo se guarda el registro con su foto: el inventario no cambia.' : 'Se descuenta todo junto: si algo falla, no se descuenta nada.'}</p>
        <button className="btn btn-lime btn-lg btn-block" disabled={!chosen.length || !number.trim() || !!dup || blocked || missingFrom > 0 || saving} onClick={confirm}>
          {saving ? 'Guardando…' : recordOnly ? `Guardar registro de ${plural(units, 'prenda', 'prendas')}` : `Descontar ${plural(units, 'prenda', 'prendas')}`}
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => { setRows([]); setStep('pick') }}>
          Tomar otra foto
        </button>
      </div>
    </>
  )
}

export default function FacturaSheet({ onClose, onDone }) {
  return (
    <Sheet modal onClose={onClose} label="Descontar una factura">
      <Body onDone={onDone} />
    </Sheet>
  )
}
