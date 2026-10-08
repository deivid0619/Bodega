import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../core/api'
import { refreshInventory, revalidate, useLayout, useProducts } from '../../core/useApi'
import { useToast } from '../../ui/ToastContext'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { plural } from '../../ui/Bits'
import { fromMissing, outAvailable, outParts, outletIdsOf, pedidoLabel, placesOf } from '../../core/utils'
import FromPick from '../../ui/FromPick'
import { PhotoButtons, ProofPhoto, ReadMoreButton, ReadingStep, photoNote, readFactura, savePhotos } from './FacturaParts'

const label = (p, sku) => (p ? `${p.name}${p.size ? ` · ${p.size}` : ''}` : sku)

// Anexar la factura a un pedido que ya se desconto: su numero y su foto. Si
// la foto se lee, se compara con lo que se empaco. Anexar no cambia el
// inventario: solo si se elige, lo que la factura trae de mas se descuenta
// ahora y lo del pedido que no va vuelve a su lugar.
export function AttachBody({ pedido, onDone, onBack }) {
  const showToast = useToast()
  const { data: products } = useProducts()
  const { data: layout } = useLayout()
  const outlet = outletIdsOf(layout)
  const bySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const [step, setStep] = useState('pick') // pick | reading | compare
  const [stage, setStage] = useState('preparing')
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState(null)
  const [reads, setReads] = useState([]) // las fotos de cerca con las que se leyo
  const [proof, setProof] = useState(null) // la factura completa: la prueba que se guarda
  const [error, setError] = useState('')
  const [number, setNumber] = useState('')
  const [read, setRead] = useState(null) // lo que leyo la foto: { qty: Map sku -> cantidad, unknown: [codigos] }
  const [extra, setExtra] = useState({}) // sku -> { on, from }: lo que la factura trae de mas (on: se descuenta)
  const [back, setBack] = useState({}) // sku -> true: lo del pedido que no va y vuelve a su lugar
  const [dup, setDup] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // more: otra parte de la tabla, que se suma a lo ya leido
  const onFile = async (file, more = false) => {
    setError('')
    setPreview(URL.createObjectURL(file))
    setProgress(0)
    setStage('preparing')
    setStep('reading')
    try {
      const r = await readFactura(file, products || [], { onProgress: setProgress, onStage: setStage })
      const qty = new Map()
      const unknown = []
      r.lines.forEach((l, i) => {
        const m = r.matches[i]
        if (m.product) qty.set(m.sku, (qty.get(m.sku) || 0) + l.qty)
        else unknown.push(l.code || l.read)
      })
      if (more) {
        setStep('compare')
        if (!r.lines.length) {
          showToast('En esa foto no se leyeron líneas: tómala más cerca y derecha.', 'err')
          return
        }
        // lo que sale en las dos fotos (donde se montan) no se suma dos veces
        const was = read?.qty || new Map()
        const fresh = [...qty.keys()].filter((sku) => !was.has(sku)).length + unknown.filter((c) => !read?.unknown.includes(c)).length
        const merged = new Map(was)
        for (const [sku, n] of qty) merged.set(sku, Math.max(merged.get(sku) || 0, n))
        setRead({ qty: merged, unknown: [...new Set([...(read?.unknown || []), ...unknown])] })
        if (!number.trim() && r.number) setNumber(r.number)
        if (fresh) setReads((rs) => [...rs, file]) // una foto repetida no se guarda
        showToast(fresh ? `Se ${fresh === 1 ? 'sumó una prenda' : `sumaron ${fresh} prendas`} de esa parte` : 'Esa parte ya estaba leída: no se sumó nada.', fresh ? 'ok' : 'err')
        return
      }
      setReads([file])
      if (r.number) setNumber(r.number)
      setRead(r.lines.length ? { qty, unknown } : null)
      if (!r.lines.length) setError('La foto no dejó leer las líneas: se anexa sin comparar (la foto igual queda guardada).')
      setStep('compare')
    } catch {
      setStep(more ? 'compare' : 'pick')
      const msg = 'No se pudo leer la foto. Revisa la conexión la primera vez (se descarga el lector) e intenta de nuevo, o anéxala solo con el número.'
      if (more) showToast(msg, 'err')
      else setError(msg)
    }
  }
  // el numero, si no salio en la foto de cerca: de la foto completa
  const fillNumber = useCallback((n) => setNumber((cur) => (cur.trim() ? cur : n)), [])

  // la misma factura no puede quedar dos veces
  useEffect(() => {
    const n = number.trim()
    if (step !== 'compare' || n.length < 3) { setDup(null); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/documents?kind=factura&number=${encodeURIComponent(n)}`)
        .then((list) => setDup(list.find((d) => d.id !== pedido.id) || null))
        .catch(() => setDup(null))
    }, 300)
    return () => clearTimeout(t)
  }, [number, step, pedido.id])

  const packed = useMemo(() => {
    const m = new Map()
    for (const l of pedido.lines || []) m.set(l.sku, (m.get(l.sku) || 0) + l.qty)
    return m
  }, [pedido])
  const rows = useMemo(() => {
    if (!read) return []
    return [...new Set([...packed.keys(), ...read.qty.keys()])]
      .map((sku) => ({ sku, p: packed.get(sku) || 0, f: read.qty.get(sku) || 0, product: bySku.get(sku) }))
  }, [read, packed, bySku])
  const same = rows.filter((r) => r.p === r.f)
  const more = rows.filter((r) => r.f > r.p) // la factura trae mas: falto descontar
  const less = rows.filter((r) => r.p > r.f) // se empaco mas de lo que dice la factura
  const deduct = more.filter((r) => extra[r.sku]?.on)
  const short = deduct.find((r) => !r.product || outAvailable(r.product, outlet, extra[r.sku]?.from) < r.f - r.p)
  const missingFrom = deduct.filter((r) => r.product && fromMissing(extra[r.sku]?.from, r.f - r.p, placesOf(r.product, outlet))).length
  const returning = less.filter((r) => back[r.sku])

  const problem = !number.trim() ? 'Escribe el número de la factura.'
    : dup ? 'Esa factura ya está registrada.'
      : short ? `No alcanza para descontar ${label(short.product, short.sku)}: quítala o corrige.`
        : missingFrom ? 'Falta elegir de dónde sale lo que se descuenta.'
          : ''
  const changes = [deduct.length && `${deduct.length} se ${deduct.length === 1 ? 'descuenta' : 'descuentan'} ahora`,
                   returning.length && `${returning.length} ${returning.length === 1 ? 'vuelve' : 'vuelven'} a su lugar`].filter(Boolean)
  const summary = changes.length ? changes.join(' · ')
    : read ? 'Solo se anexa la factura: el inventario no cambia.'
      : `Se anexa tal cual se empacó (${plural(pedido.units, 'prenda', 'prendas')}): el inventario no cambia.`

  const confirm = async () => {
    setSaving(true)
    try {
      const lines = deduct.flatMap((r) => outParts(r.f - r.p, extra[r.sku]?.from || '', r.product)
        .map((x) => ({ sku: r.sku, qty: x.qty, ...(x.loc ? { location_id: x.loc } : {}) })))
      const res = await api.post(`/api/documents/${pedido.id}/factura`, {
        number: number.trim(), deduct: lines, returns: returning.map((r) => ({ sku: r.sku, qty: r.p - r.f })),
      })
      refreshInventory()
      // primero la factura completa y despues las de cerca
      const photos = [proof, ...reads].filter(Boolean)
      const saved = await savePhotos(res.document.id, photos)
      const doc = saved.doc || res.document
      revalidate('/api/documents')
      showToast(`Factura ${doc.number} anexada al pedido${photoNote(photos.length, saved.kept)}`, saved.kept === photos.length ? 'ok' : 'err')
      onDone?.(doc)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No se anexó nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  const eyebrow = <div className="sheet-eyebrow"><span className="tag tag-warn">Esperando factura</span></div>
  const who = `${pedidoLabel(pedido)} · ${plural(pedido.units, 'prenda', 'prendas')}${pedido.notes ? ` · ${pedido.notes}` : ''}`

  if (step === 'reading') return <ReadingStep preview={preview} stage={stage} progress={progress} />
  if (step === 'pick') {
    return (
      <>
        <SheetHeader eyebrow={eyebrow} title="Anexar la factura" subtitle={who} />
        {error && <p className="form-err" role="alert">{error}</p>}
        <PhotoButtons onFile={onFile} />
        <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 10 }} onClick={() => { setRead(null); setReads([]); setStep('compare') }}>
          Sin leer: escribir solo el número
        </button>
        <p className="mode-hint">Toma la foto de cerca, solo a la tabla: la app la compara con lo que se empacó y te dice si faltó o sobró algo. Después tomas la factura completa para guardarla dos meses. Anexar no cambia el inventario, a menos que tú lo elijas.</p>
        {onBack && <button type="button" className="link-btn" style={{ marginTop: 14 }} onClick={onBack}>Volver</button>}
      </>
    )
  }

  return (
    <>
      <SheetHeader eyebrow={eyebrow} title="Revisa y anexa" subtitle={who} />
      <label className="field" style={{ marginTop: 0 }}>
        <span className="field-label">Número de factura</span>
        <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="Ej. FEV21830" autoCapitalize="characters" spellCheck="false" />
      </label>
      {dup && (
        <p className="form-err" role="alert">
          La factura {dup.number} ya se registró el {new Date(dup.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} ({dup.user_name}).
        </p>
      )}
      {error && <p className="mode-hint">{error}</p>}

      {read ? (
        <div className="cmp-list">
          {[...more, ...less, ...same].map((r) => {
            const places = r.product ? placesOf(r.product, outlet) : []
            const x = extra[r.sku] || {}
            return (
              <div key={r.sku} className={`cmp-row ${r.f > r.p ? 'more' : r.p > r.f ? 'less' : 'ok'}`}>
                <div className="cmp-t">
                  <b>{label(r.product, r.sku)}</b>
                  <small>
                    <span className="mono">{r.sku}</span> · se empacaron {r.p} · la factura dice {r.f}
                  </small>
                </div>
                {r.p === r.f && <span className="cmp-ok"><Icon name="check" size={16} stroke={2.6} />Coincide</span>}
                {r.f > r.p && (
                  <div className="cmp-act">
                    <label className="cmp-switch">
                      <span>La factura trae {r.f - r.p} más: {x.on ? 'se descuenta ahora' : 'no se descuenta'}</span>
                      <button type="button" className="switch" role="switch" aria-checked={!!x.on} aria-label={`Descontar ahora ${r.f - r.p} de ${label(r.product, r.sku)}`}
                              onClick={() => setExtra((e) => ({ ...e, [r.sku]: { ...x, on: !x.on } }))} />
                    </label>
                    {x.on && !r.product && <small className="warn">No está en la bodega: no se puede descontar.</small>}
                    {x.on && r.product && places.length > 0 && (
                      <FromPick places={places} value={x.from} qty={r.f - r.p} onChange={(v) => setExtra((e) => ({ ...e, [r.sku]: { ...x, from: v } }))} />
                    )}
                  </div>
                )}
                {r.p > r.f && (
                  <div className="cmp-act">
                    <span className="cmp-q">Sobra {r.p - r.f} en el pedido</span>
                    <div className="seg two" role="group" aria-label={`Qué pasa con ${label(r.product, r.sku)}`}>
                      <button type="button" data-m="set" aria-pressed={!back[r.sku]} onClick={() => setBack((b) => ({ ...b, [r.sku]: false }))}>Se queda así</button>
                      <button type="button" data-m="in" aria-pressed={!!back[r.sku]} onClick={() => setBack((b) => ({ ...b, [r.sku]: true }))}>Vuelve a su lugar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {read.unknown.length > 0 && (
            <p className="mode-hint">No se reconocieron en la foto: {read.unknown.join(', ')}. No se tocan.</p>
          )}
        </div>
      ) : (
        <div className="card panel" style={{ marginTop: 14 }}>
          {[...packed].map(([sku, q]) => (
            <div className="need" key={sku}>
              <span className="need-t"><b>{label(bySku.get(sku), sku)}</b><small className="mono">{sku}</small></span>
              <span className="need-q dark"><b>{q}</b><span>{q === 1 ? 'salió' : 'salieron'}</span></span>
            </div>
          ))}
        </div>
      )}

      {read && <ReadMoreButton onFile={(f) => onFile(f, true)} />}

      <ProofPhoto file={proof} onChange={setProof} reads={reads.length} findNumber={number.trim() ? undefined : fillNumber} />

      <div className="doc-footer">
        <p className="mode-hint">{problem || summary}</p>
        <button type="button" className="btn btn-lime btn-lg btn-block" disabled={!!problem || saving} onClick={confirm}>
          {saving ? 'Anexando…' : 'Anexar factura'}
        </button>
        <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 8 }} onClick={() => { setError(''); setRead(null); setReads([]); setProof(null); setStep('pick') }}>
          {reads.length ? 'Empezar de nuevo' : 'Volver'}
        </button>
      </div>
    </>
  )
}

function Inner({ pedido, onDone }) {
  const { close } = useSheet()
  return <AttachBody pedido={pedido} onDone={(d) => { onDone?.(d); close() }} />
}

// Desde el detalle del pedido (Resumen): la misma pantalla en su propia hoja
export default function AttachSheet({ pedido, onClose, onDone }) {
  return (
    <Sheet modal onClose={onClose} label="Anexar la factura">
      <Inner pedido={pedido} onDone={onDone} />
    </Sheet>
  )
}
