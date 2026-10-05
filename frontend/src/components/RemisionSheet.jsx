import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../api'
import { refreshInventory, revalidate, useLayout, usePolling, useProducts, useReserve } from '../hooks/useApi'
import { locationGroups } from '../locationGroups'
import { cleanCode } from '../lib/facturaParser'
import { sizeRank } from '../utils'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { SearchField, Stepper, plural } from './Bits'

// la plantilla de remision de Pigmalion trae estas tallas
const TEMPLATE = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']
const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '')
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// referencias conocidas: lo que hay en la bodega y en la reserva, por nombre
function buildRefs(products, reserve) {
  const map = new Map()
  const add = (name, size, sku, qty, where, rank) => {
    if (!map.has(name)) map.set(name, { name, sizes: new Map(), bodega: 0, reserva: 0 })
    const ref = map.get(name)
    const cur = ref.sizes.get(size) || { size, sku: null, rank: -1, have: 0, bodega: 0, reserva: 0 }
    // si una talla tiene dos codigos, gana el real (no de prueba) con mas prendas
    if (sku && rank > cur.rank) {
      cur.sku = sku
      cur.rank = rank
      cur.have = where === 'bodega' ? qty : 0
    }
    cur[where] += qty
    ref[where] += qty
    ref.sizes.set(size, cur)
  }
  for (const p of products) add(p.name, p.size || '', p.sku, p.qty, 'bodega', (p.demo ? 0 : 1e6) + p.qty)
  for (const i of reserve) add(i.name, i.size || '', i.sku, i.qty, 'reserva', 0)
  return [...map.values()]
}

let nextId = 1
const newRow = (size, info) => ({ size, sku: info?.sku || null, have: info?.have || 0, inReserve: info?.reserva || 0, qty: 0, pending: 0, code: '' })

function PickStep({ onFile, onSkip }) {
  const camera = useRef(null)
  const gallery = useRef(null)
  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f)
  }
  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Entrada de mercancía</span></div>}
        title="Recibir una remisión"
        subtitle="Toma la foto de la orden de remisión para tenerla a la vista mientras cuentas lo que llegó."
      />
      <ul className="doc-tips">
        <li><Icon name="check" size={16} stroke={2.4} />Entra lo que cuentes, no lo que diga el papel.</li>
        <li><Icon name="check" size={16} stroke={2.4} />Lo que falte lo anotas como pendiente.</li>
        <li><Icon name="check" size={16} stroke={2.4} />La foto no sale de tu celular.</li>
      </ul>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
      <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => camera.current.click()}>
        <Icon name="camera" size={20} />Tomar foto de la remisión
      </button>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost" onClick={() => gallery.current.click()}>Elegir foto</button>
        <button className="btn btn-quiet" onClick={onSkip}>Sin foto</button>
      </div>
    </>
  )
}

// la foto en grande: tocar acerca o aleja, y con el dedo se recorre
function PhotoZoom({ src, onClose }) {
  const [big, setBig] = useState(true)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="zoom" role="dialog" aria-modal="true" aria-label="Foto de la remisión">
      <div className="zoom-scroll" onClick={() => setBig((b) => !b)}>
        <img src={src} alt="Remisión" style={{ width: big ? '230%' : '100%' }} />
      </div>
      <button className="zoom-close" onClick={onClose} aria-label="Cerrar la foto"><Icon name="x" size={22} stroke={2.2} /></button>
      <p className="zoom-hint">Toca para acercar o alejar · desliza para recorrerla</p>
    </div>,
    document.body,
  )
}

function RefPicker({ refs, known, onPick, onCancel }) {
  const [q, setQ] = useState('')
  const [shop, setShop] = useState([])
  const term = q.trim().toUpperCase()
  // referencias de la tienda que aun no estan (todas) en la bodega
  useEffect(() => {
    if (term.length < 3) { setShop([]); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/catalog/search?q=${encodeURIComponent(term)}&limit=6`)
        .then((list) => setShop(list.filter((g) => !g.sizes.every((s) => known.has(s.sku)))))
        .catch(() => setShop([]))
    }, 250)
    return () => clearTimeout(t)
  }, [term, known])
  const fromShop = (g) => ({
    name: g.name,
    shop: true,
    sizes: new Map(g.sizes.map((s) => {
      const p = known.get(s.sku)
      return [s.size, { size: s.size, sku: s.sku, have: p?.qty || 0, bodega: p?.qty || 0, reserva: 0 }]
    })),
  })
  const results = useMemo(() => {
    if (term.length < 2) return []
    const code = norm(term)
    const words = term.split(/\s+/)
    const hits = refs.filter((r) => words.every((w) => r.name.includes(w)) || [...r.sizes.values()].some((s) => s.sku && s.sku.includes(code)))
    return hits.sort((a, b) => b.bodega + b.reserva - (a.bodega + a.reserva)).slice(0, 6)
  }, [term, refs])
  const exact = results.some((r) => r.name === term)
  return (
    <div className="rem-pick">
      <SearchField value={q} onChange={setQ} placeholder="Referencia o código de una talla" />
      {(results.length > 0 || term.length >= 3) && (
        <div className="ref-results">
          {results.map((r) => (
            <button key={r.name} type="button" className="ref-result" onClick={() => onPick(r)}>
              <span className="ref-result-t">
                <b>{r.name}</b>
                <small>
                  {plural(r.sizes.size, 'talla', 'tallas')} · {r.bodega} en bodega{r.reserva ? ` · ${r.reserva} en reserva` : ''}
                </small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          ))}
          {shop.map((g) => (
            <button key={`tienda-${g.name}`} type="button" className="ref-result shop" onClick={() => onPick(fromShop(g))}>
              {g.image ? <img src={g.image} alt="" /> : null}
              <span className="ref-result-t">
                <b>{g.name}</b>
                <small>De la tienda · tallas {g.sizes.map((s) => s.size || 'única').join(', ')}</small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          ))}
          {term.length >= 3 && !exact && (
            <button type="button" className="ref-result new" onClick={() => onPick({ name: term.replace(/\s+/g, ' '), sizes: new Map(), isNew: true })}>
              <span className="ref-result-t">
                <b>Referencia nueva: {term.replace(/\s+/g, ' ')}</b>
                <small>Todavía no está en la bodega</small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          )}
        </div>
      )}
      {onCancel && <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={onCancel}>Cancelar</button>}
    </div>
  )
}

function SizeRow({ row, dest, showPending, prevPending, known, onChange }) {
  const code = cleanCode(row.code)
  const other = code && known.get(code)
  const noCode = !row.sku && !code
  return (
    <div className="rem-row">
      <div className="sz">{row.size || 'U'}</div>
      <div className="rem-row-t">
        {row.sku ? (
          <small><span className="mono">{row.sku}</span> · hay {row.have}{row.inReserve ? ` · ${row.inReserve} en reserva` : ''}</small>
        ) : (
          <small className={row.qty > 0 && dest === 'bodega' ? 'warn' : ''}>
            {row.qty > 0 && dest === 'bodega' && noCode ? 'Sin código: queda en la reserva' : 'Talla sin código todavía'}
          </small>
        )}
        {prevPending > 0 && <small className="due">Debían {prevPending} de la entrega anterior</small>}
      </div>
      <Stepper
        onMinus={() => onChange((r) => ({ qty: Math.max(0, r.qty - 1) }))}
        onPlus={() => onChange((r) => ({ qty: r.qty + 1 }))}
        disabledMinus={row.qty === 0}
        minusLabel={`Una menos de talla ${row.size || 'única'}`}
        plusLabel={`Una más de talla ${row.size || 'única'}`}
      >
        <input
          type="number"
          inputMode="numeric"
          aria-label={`Llegaron de talla ${row.size || 'única'}`}
          value={row.qty || ''}
          placeholder="0"
          onChange={(e) => onChange({ qty: Math.max(0, Math.min(9999, Math.floor(+e.target.value) || 0)) })}
        />
      </Stepper>
      {!row.sku && row.qty > 0 && dest === 'bodega' && (
        <div className="rem-row-code">
          <input
            className="rem-code"
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="Código de la etiqueta (opcional)"
            aria-label={`Código de la talla ${row.size || 'única'}`}
            autoCapitalize="characters"
            spellCheck="false"
          />
          {other && <small className="warn">Ese código ya es de {other.name}{other.size ? ` · ${other.size}` : ''}.</small>}
        </div>
      )}
      {showPending && (
        <div className="rem-pend">
          <span>Pendientes</span>
          <Stepper
            value={row.pending}
            onMinus={() => onChange((r) => ({ pending: Math.max(0, r.pending - 1) }))}
            onPlus={() => onChange((r) => ({ pending: r.pending + 1 }))}
            disabledMinus={row.pending === 0}
            minusLabel="Un pendiente menos"
            plusLabel="Un pendiente más"
            small
          />
        </div>
      )}
    </div>
  )
}

function Body() {
  const showToast = useToast()
  const { close } = useSheet()
  const { data: products } = useProducts()
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  const { data: recent } = usePolling('/api/documents?kind=remision&limit=50', { interval: 60000 })
  const refs = useMemo(() => buildRefs(products || [], reserve || []), [products, reserve])
  const known = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const inBodega = useMemo(() => new Set((products || []).map((p) => p.name)), [products])
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const suppliers = useMemo(() => [...new Set((recent || []).map((d) => d.supplier).filter(Boolean))], [recent])

  const [step, setStep] = useState('pick')
  const [photo, setPhoto] = useState(null)
  const [zoom, setZoom] = useState(false)
  const [number, setNumber] = useState('')
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(localToday)
  const [blocks, setBlocks] = useState([])
  const [picking, setPicking] = useState(true)
  const [showPending, setShowPending] = useState(false)
  const [dest, setDest] = useState('bodega')
  const [place, setPlace] = useState('')
  const [history, setHistory] = useState(null)
  const [delivery, setDelivery] = useState(0)
  const [addingSize, setAddingSize] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo) }, [photo])

  // entregas anteriores de la misma orden (OPR77, OPR77#2...)
  const base = norm(number).split('#')[0]
  useEffect(() => {
    setDelivery(0)
    if (base.length < 2) { setHistory(null); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/documents?kind=remision&base=${encodeURIComponent(base)}&limit=20`)
        .then(setHistory)
        .catch(() => setHistory(null))
    }, 300)
    return () => clearTimeout(t)
  }, [base])

  const effective = delivery ? `${base}#${delivery}` : norm(number)
  const dup = (history || []).find((d) => d.number === effective)
  const nextDelivery = 1 + Math.max(1, ...(history || []).map((d) => (d.number.includes('#') ? parseInt(d.number.split('#')[1], 10) || 1 : 1)))
  const prevPending = useMemo(() => {
    const last = history?.[0]
    const m = new Map()
    if (last && (delivery || norm(number).includes('#'))) for (const l of last.lines || []) if (l.pending) m.set(`${l.name}|${l.size}`, l.pending)
    return m
  }, [history, delivery, number])

  const pickRef = (ref) => {
    const rows = ref.isNew
      ? TEMPLATE.map((s) => newRow(s))
      : [...ref.sizes.values()].sort((a, b) => sizeRank(a.size) - sizeRank(b.size)).map((s) => newRow(s.size, s))
    setBlocks((bs) => [...bs, { id: nextId++, name: ref.name, isNew: !!ref.isNew, shop: !!ref.shop, rows }])
    setPicking(false)
  }
  // dos toques seguidos suman dos: cada cambio parte del valor actual
  const setRow = (bid, size, patch) =>
    setBlocks((bs) => bs.map((b) => (b.id !== bid ? b : {
      ...b, rows: b.rows.map((r) => (r.size === size ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)),
    })))
  const addSize = (bid, raw) => {
    const s = String(raw || '').trim().toUpperCase().replace(/^T(?=\w)/, '')
    setAddingSize(null)
    if (!s) return
    setBlocks((bs) => bs.map((b) => (b.id !== bid || b.rows.some((r) => r.size === s) ? b : { ...b, rows: [...b.rows, newRow(s)] })))
  }
  const removeBlock = (bid) => {
    setBlocks((bs) => {
      const left = bs.filter((b) => b.id !== bid)
      if (!left.length) setPicking(true)
      return left
    })
  }

  const lines = blocks.flatMap((b) => b.rows
    .filter((r) => r.qty > 0 || r.pending > 0)
    .map((r) => ({ name: b.name, size: r.size, sku: r.sku || cleanCode(r.code) || null, qty: r.qty, pending: r.pending, isNew: b.isNew })))
  const units = lines.reduce((t, l) => t + l.qty, 0)
  const pend = lines.reduce((t, l) => t + l.pending, 0)
  const toReserve = dest === 'reserva' ? units : lines.filter((l) => !l.sku).reduce((t, l) => t + l.qty, 0)
  const toBodega = units - toReserve
  const clash = lines.some((l) => l.sku && known.get(l.sku) && known.get(l.sku).name !== l.name)
  // un codigo nuevo se guarda junto a las otras tallas; si la referencia no tiene ninguna en la bodega, hay que elegir
  const withKnown = new Set(blocks.filter((b) => b.rows.some((r) => r.sku && known.has(r.sku))).map((b) => b.name))
  const needsPlace = dest === 'bodega' && !place && lines.some((l) => l.sku && l.qty > 0 && !known.get(l.sku) && !inBodega.has(l.name) && !withKnown.has(l.name))

  const problem = !effective ? 'Escribe el número de la remisión u OPR.'
    : dup ? 'Esta remisión ya entró.'
      : !blocks.length ? 'Elige la referencia que llegó.'
        : !units && !pend ? 'Pon cuántas llegaron de cada talla.'
          : clash ? 'Un código escrito es de otra referencia.'
            : needsPlace ? 'Elige en qué ubicación guardar los códigos nuevos.'
              : ''

  const confirm = async () => {
    setSaving(true)
    try {
      const res = await api.post('/api/documents/remision', {
        number: effective, supplier: supplier.trim(), date: date || undefined, destination: dest,
        location_id: dest === 'bodega' && place ? place : undefined,
        lines: lines.map(({ name, size, sku, qty, pending }) => ({ name, size, sku: sku || undefined, qty, pending })),
      })
      refreshInventory()
      revalidate('/api/documents')
      const d = res.document
      showToast(`Remisión ${d.number}: ${plural(d.units, 'prenda entró', 'prendas entraron')}${d.pending ? ` · ${d.pending} pendientes` : ''}`)
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No entró nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'pick') {
    return (
      <PickStep
        onFile={(f) => { setPhoto(URL.createObjectURL(f)); setStep('form') }}
        onSkip={() => setStep('form')}
      />
    )
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Entrada de mercancía</span></div>}
        title="Revisa lo que llegó"
        subtitle="Cuenta las prendas y pon lo que contaste."
      />
      {photo && (
        <button type="button" className="rem-photo" onClick={() => setZoom(true)} aria-label="Ver la foto en grande">
          <img src={photo} alt="" />
          <span><Icon name="search" size={15} stroke={2.2} />Ampliar</span>
        </button>
      )}

      <label className="field" style={{ marginTop: photo ? 14 : 0 }}>
        <span className="field-label">Número de la remisión u OPR</span>
        <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej. OPR 1234" autoCapitalize="characters" spellCheck="false" />
      </label>
      {dup && !delivery && (
        <div className="form-err" role="alert">
          Ya entró el {new Date(dup.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} ({dup.user_name}) con {plural(dup.units, 'prenda', 'prendas')}.
          <button type="button" className="btn btn-ink btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => setDelivery(nextDelivery)}>
            Es otra entrega de la misma orden
          </button>
        </div>
      )}
      {delivery > 0 && (
        <p className="rem-delivery">
          <span className="tag tag-out">Entrega {delivery}</span> de la orden <b className="mono">{base}</b>
          <button type="button" className="link-btn" onClick={() => setDelivery(0)}>Quitar</button>
        </p>
      )}
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Proveedor</span>
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} list="rem-suppliers" placeholder="Taller o persona" />
          <datalist id="rem-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span className="field-label">Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <h3 className="h-sec">Lo que llegó</h3>
      {blocks.map((b) => (
        <section className="rem-block" key={b.id} aria-label={b.name}>
          <div className="rem-block-head">
            <b>{b.name}{b.isNew && <span className="tag tag-warn" style={{ marginLeft: 8 }}>Nueva</span>}{b.shop && <span className="tag tag-set" style={{ marginLeft: 8 }}>Tienda</span>}</b>
            <button type="button" className="link-btn" onClick={() => removeBlock(b.id)}>Quitar</button>
          </div>
          {b.rows.map((r) => (
            <SizeRow
              key={r.size}
              row={r}
              dest={dest}
              showPending={showPending}
              prevPending={prevPending.get(`${b.name}|${r.size}`) || 0}
              known={known}
              onChange={(patch) => setRow(b.id, r.size, patch)}
            />
          ))}
          {addingSize === b.id ? (
            <form className="rem-add" onSubmit={(e) => { e.preventDefault(); addSize(b.id, e.currentTarget.elements.size.value) }}>
              <input name="size" className="rem-code" placeholder="Talla, ej. 5XL o 32" autoFocus autoCapitalize="characters" />
              <button className="btn btn-ink btn-sm">Agregar</button>
            </form>
          ) : (
            <button type="button" className="link-btn rem-more" onClick={() => setAddingSize(b.id)}>
              <Icon name="plus" size={14} stroke={2.4} />Otra talla
            </button>
          )}
        </section>
      ))}
      {picking ? (
        <RefPicker refs={refs} known={known} onPick={pickRef} onCancel={blocks.length ? () => setPicking(false) : null} />
      ) : (
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
          <Icon name="plus" size={18} stroke={2.2} />Otra referencia en esta remisión
        </button>
      )}

      <div className="menu-check rem-toggle">
        <span>Quedaron unidades pendientes<small>Lo que el proveedor quedó debiendo</small></span>
        <button type="button" className="switch" role="switch" aria-checked={showPending} aria-label="Anotar pendientes" onClick={() => setShowPending((v) => !v)} />
      </div>

      <h3 className="h-sec">Dónde queda</h3>
      <div className="seg two" role="toolbar" aria-label="Dónde queda la mercancía">
        <button type="button" data-m="in" aria-pressed={dest === 'bodega'} onClick={() => setDest('bodega')}>
          <Icon name="warehouse" size={18} stroke={2.1} />Bodega
        </button>
        <button type="button" data-m="out" aria-pressed={dest === 'reserva'} onClick={() => setDest('reserva')}>
          <Icon name="reserve" size={18} stroke={2.1} />Reserva
        </button>
      </div>
      {dest === 'bodega' ? (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field-label">Ubicación</span>
          <select className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">Automática: donde ya está cada talla</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="field-hint">Las tallas sin código quedan en la reserva hasta que les pongas el código.</span>
        </label>
      ) : (
        <p className="mode-hint">Todo queda en la reserva. Desde ahí lo envías a la bodega cuando haga falta.</p>
      )}

      <div className="doc-footer">
        <p className="mode-hint">
          {problem || [toBodega && `${toBodega} a la bodega`, toReserve && `${toReserve} a la reserva`, pend && plural(pend, 'pendiente', 'pendientes')].filter(Boolean).join(' · ')}
        </p>
        <button className="btn btn-lime btn-lg btn-block" disabled={!!problem || saving} onClick={confirm}>
          {saving ? 'Guardando…' : units ? `Confirmar entrada de ${plural(units, 'prenda', 'prendas')}` : 'Guardar remisión'}
        </button>
      </div>
      {zoom && photo && <PhotoZoom src={photo} onClose={() => setZoom(false)} />}
    </>
  )
}

export default function RemisionSheet({ onClose }) {
  return (
    <Sheet modal onClose={onClose} label="Recibir una remisión">
      <Body />
    </Sheet>
  )
}
