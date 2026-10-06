import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { refreshInventory, useProducts } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { Stepper, plural } from './Bits'
import { cleanCode, matchAll, matchLine, parseFactura } from '../lib/facturaParser'
import { readPhoto } from '../lib/ocr'

let nextId = 1

function toRow(line, m) {
  return { id: nextId++, ...line, sku: m.sku, product: m.product, how: m.how, include: false }
}

// incluida por defecto solo si se reconocio y hay con que descontar
function withDefault(row) {
  return { ...row, include: !!row.product && row.product.qty >= row.qty }
}

function PickStep({ onFile, error }) {
  const camera = useRef(null)
  const gallery = useRef(null)
  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f)
  }
  return (
    <>
      <SheetHeader title="Descontar una factura" subtitle="Toma una foto de la factura impresa. La app lee los códigos y las cantidades, tú revisas y confirmas." />
      {error && <p className="form-err" role="alert">{error}</p>}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
      <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => camera.current.click()}>
        <Icon name="camera" size={20} />Tomar foto de la factura
      </button>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => gallery.current.click()}>
        Elegir una foto guardada
      </button>
      <details className="doc-help">
        <summary>Recomendaciones para usarla bien</summary>
        <ul>
          <li>Que se vea toda la tabla de productos, derecha, con buena luz y sin sombras.</li>
          <li>Revisa cada línea antes de confirmar: si un código o una cantidad no se leyó bien, corrígelo.</li>
          <li>La foto se lee en tu celular: no se guarda ni sale de él.</li>
        </ul>
      </details>
    </>
  )
}

function ReadingStep({ preview, stage, progress }) {
  return (
    <>
      <SheetHeader title="Leyendo la factura…" subtitle={stage === 'reading' ? 'Buscando códigos y cantidades.' : 'Preparando el lector (la primera vez tarda un poco más).'} />
      <div className="doc-reading">
        {preview && <img src={preview} alt="" />}
        <div className="doc-scanline" aria-hidden="true" />
      </div>
      <div className="doc-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
      </div>
      <p className="mode-hint" style={{ textAlign: 'center' }}>{Math.round(progress * 100)}%</p>
    </>
  )
}

function Body({ onDone }) {
  const showToast = useToast()
  const { close } = useSheet()
  const { data: products } = useProducts()
  const [step, setStep] = useState('pick')
  const [stage, setStage] = useState('preparing')
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [number, setNumber] = useState('')
  const [rows, setRows] = useState([])
  const [dup, setDup] = useState(null)
  const [saving, setSaving] = useState(false)
  const known = products || []

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const onFile = async (file) => {
    setError('')
    setPreview(URL.createObjectURL(file))
    setProgress(0)
    setStage('preparing')
    setStep('reading')
    try {
      const text = await readPhoto(file, { onProgress: setProgress, onStage: setStage })
      const parsed = parseFactura(text)
      if (!parsed.lines.length) {
        setStep('pick')
        setError('No se encontraron líneas de productos. Toma la foto más derecha y más cerca de la tabla.')
        return
      }
      setNumber(parsed.number)
      const matches = matchAll(parsed.lines, known)
      setRows(parsed.lines.map((l, i) => withDefault(toRow(l, matches[i]))))
      setStep('review')
    } catch {
      setStep('pick')
      setError('No se pudo leer la foto. Revisa la conexión la primera vez (se descarga el lector) e intenta de nuevo.')
    }
  }

  // la misma factura no se puede descontar dos veces
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
    update(row.id, { code: line.code, sku: m.sku, product: m.product, how: m.how, include: !!m.product && m.product.qty >= row.qty })
  }

  const chosen = rows.filter((r) => r.include && r.product)
  const units = chosen.reduce((t, r) => t + r.qty, 0)
  const pending = rows.filter((r) => !r.include).length
  const blocked = chosen.some((r) => r.product.qty < r.qty)

  const confirm = async () => {
    setSaving(true)
    try {
      await api.post('/api/documents/factura', { number: number.trim(), lines: chosen.map((r) => ({ sku: r.sku, qty: r.qty })) })
      refreshInventory()
      showToast(`Factura ${number.trim().toUpperCase()}: ${plural(units, 'prenda descontada', 'prendas descontadas')}`)
      onDone?.()
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No se descontó nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'pick') return <PickStep onFile={onFile} error={error} />
  if (step === 'reading') return <ReadingStep preview={preview} stage={stage} progress={progress} />

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-out">Salida por factura</span></div>}
        title="Revisa antes de descontar"
        subtitle={`${plural(rows.length, 'línea leída', 'líneas leídas')} · ${pending ? `${pending} sin incluir` : 'todas incluidas'}`}
      />
      <label className="field" style={{ marginTop: 0 }}>
        <span className="field-label">Número de factura</span>
        <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="Ej. FEV21830" />
      </label>
      {dup && (
        <p className="form-err" role="alert">
          Esta factura ya se descontó el {new Date(dup.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} ({dup.user_name}). No se puede aplicar dos veces.
        </p>
      )}

      <div className="doc-lines">
        {rows.map((r) => {
          const short = r.product && r.product.qty < r.qty
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
                  {state === 'short' && `Solo hay ${r.product.qty} en la bodega.`}
                  {state === 'ok' && `Hay ${r.product.qty}${r.how === 'fixed' && r.read.replace(/\s/g, '') !== r.sku ? ` · se leyó ${r.read}` : ''}`}
                </small>
              </div>
              <Stepper
                value={r.qty}
                onMinus={() => update(r.id, { qty: Math.max(1, r.qty - 1) })}
                onPlus={() => update(r.id, { qty: r.qty + 1 })}
                disabledMinus={r.qty <= 1}
              />
            </div>
          )
        })}
      </div>

      <div className="doc-footer">
        <p className="mode-hint">Se descuenta todo junto: si algo falla, no se descuenta nada.</p>
        <button className="btn btn-lime btn-lg btn-block" disabled={!chosen.length || !number.trim() || !!dup || blocked || saving} onClick={confirm}>
          {saving ? 'Descontando…' : `Descontar ${plural(units, 'prenda', 'prendas')}`}
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
