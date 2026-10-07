import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from './ToastContext'
import { useConfirm } from './ConfirmContext'
import { applyLocally, bumpStock, useLayout, useReserve } from '../hooks/useApi'
import { outletIdsOf, reserveIndex, stockSplit } from '../utils'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import MoveSheet from './MoveSheet'
import Icon from './Icon'
import { Count, ProductThumb, Stepper, StockMeter } from './Bits'
import RestockHint from './RestockHint'

function LocationSelect({ value, onChange, locations, currentName }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!locations.some((g) => g.options.some((l) => l.id === value)) && <option value={value}>{currentName}</option>}
      {locations.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function Body({ sku, locations, onChanged, onLocate, onShowAll }) {
  const { isAdmin } = useAuth()
  const showToast = useToast()
  const confirm = useConfirm()
  const { close } = useSheet()
  const navigate = useNavigate()
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  const [product, setProduct] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(null)

  useEffect(() => {
    api.get(`/api/products/${encodeURIComponent(sku)}`)
      .then((p) => {
        setProduct(p)
        setForm({ name: p.name, size: p.size, min_qty: p.min_qty, location_id: p.location_id })
      })
      .catch(() => showToast('No se pudo cargar ese código.', 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku])

  // cada toque se ve en el acto; lo del servidor solo se toma cuando llega
  // la respuesta del ultimo toque (antes cada respuesta devolvia el numero
  // a un valor viejo y parecia que se demoraba en sumar o restar)
  const taps = useRef(0)
  const bump = async (type, locationId) => {
    setProduct((p) => applyLocally(p, type, 1, locationId))
    taps.current += 1
    try {
      const res = await bumpStock(sku, type === 'in' ? 1 : -1, locationId)
      taps.current -= 1
      if (!taps.current && res) setProduct(res.product)
    } catch (e) {
      taps.current -= 1
      showToast(e instanceof ApiError ? e.message : 'No se pudo registrar.', 'err')
      api.get(`/api/products/${encodeURIComponent(sku)}`).then(setProduct).catch(() => {})
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const p = await api.patch(`/api/products/${encodeURIComponent(sku)}`, {
        name: form.name, size: form.size, min_qty: Number(form.min_qty), location_id: form.location_id,
      })
      setProduct(p)
      onChanged()
      showToast('Cambios guardados')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo guardar.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `¿Eliminar el código ${sku}?`,
      body: `${product.name}${product.size ? ` · ${product.size}` : ''}. Se borra de la bodega${product.qty > 0 ? ` con sus ${product.qty} prendas en todas sus ubicaciones` : ''}. No se puede deshacer.`,
      confirmLabel: 'Sí, eliminar',
    })
    if (!ok) return
    try {
      await api.delete(`/api/products/${encodeURIComponent(sku)}`)
      onChanged()
      showToast('Código eliminado')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo eliminar.', 'err')
    }
  }

  if (!product || !form) {
    return (
      <>
        <SheetHeader title="Cargando…" />
        <div className="skeleton" style={{ height: 120 }} />
      </>
    )
  }

  const split = stockSplit(product, reserveIndex(reserve), outletIdsOf(layout))
  const low = product.min_qty > 0 && split.bodega <= product.min_qty
  const places = product.stock?.some((s) => s.location_id === product.location_id)
    ? product.stock
    : [{ location_id: product.location_id, location_name: product.location_name, qty: 0 }, ...(product.stock || [])]
  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="code">{product.sku}</span>{product.size && <span className="tag tag-out">Talla {product.size}</span>}</div>}
        title={product.name}
      />
      <div className="prod-stock">
        <ProductThumb src={product.image_url} alt={product.name} size="lg" />
        <div className="count">
          <b><Count value={split.total} /></b>
          <span>{split.reserve > 0 ? 'entre bodega y reserva' : 'en total'}{product.min_qty > 0 ? ` · mínimo ${product.min_qty}` : ''}</span>
        </div>
      </div>
      <div className="prod-split">
        <div><span>En la bodega</span><b><Count value={split.bodega} /></b></div>
        {split.reserve > 0 ? (
          <button type="button" onClick={() => { close(); navigate('/reserve') }}><span>En la reserva</span><b><Count value={split.reserve} /></b></button>
        ) : (
          <div><span>En la reserva</span><b>0</b></div>
        )}
        {split.passing > 0 && <div><span>De paso</span><b>{split.passing}</b></div>}
        {split.outlet > 0 && <div className="outlet"><span>Outlet</span><b>{split.outlet}</b></div>}
      </div>
      <div className="prod-note">
        <span>{product.out_30d} {product.out_30d === 1 ? 'salió' : 'salieron'} en los últimos 30 días</span>
        {product.min_qty > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {low && <span className="tag tag-warn">Por reponer</span>}
            <StockMeter qty={split.bodega} min={product.min_qty} />
          </span>
        )}
      </div>

      <RestockHint product={product} />

      <h3 className="h-sec">Dónde está <small>{places.filter((s) => s.qty > 0).length || 'ninguna'} {places.filter((s) => s.qty > 0).length === 1 ? 'ubicación' : 'ubicaciones'}</small></h3>
      <div className="card panel">
        {places.map((s) => (
          <div className="loc-row" key={s.location_id}>
            <button className="code dark" onClick={() => onLocate(s.location_id)} aria-label={`Ver ${s.location_id} en 3D`}>
              <Icon name="pin" size={13} stroke={2.2} />{s.location_id}
            </button>
            <div className="loc-row-t">
              <b>{s.location_name}</b>
              {s.location_id === product.location_id && <small>Principal</small>}
            </div>
            <div className="prow-actions">
              <Stepper value={s.qty} onMinus={() => bump('out', s.location_id)} onPlus={() => bump('in', s.location_id)} minusLabel="Registrar salida de 1" plusLabel="Registrar entrada de 1" disabledMinus={s.qty === 0} />
              {s.qty > 0 && <button className="link-btn" onClick={() => setMoving(s.location_id)}><Icon name="arrowRight" size={14} stroke={2.2} />Mover</button>}
            </div>
          </div>
        ))}
      </div>

      <h3 className="h-sec">Datos de la prenda</h3>
      <label className="field" style={{ marginTop: 0 }}>
        <span className="field-label">Referencia</span>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Talla</span>
          <input className="input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Stock mínimo</span>
          <input className="input" type="number" min="0" inputMode="numeric" value={form.min_qty} onChange={(e) => setForm({ ...form, min_qty: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Ubicación principal</span>
        <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} locations={locations} currentName={product.location_name} />
        <span className="field-hint">Lo que escanees de este código entra aquí si no eliges otra ubicación.</span>
      </label>
      <div className="btn-row">
        {/* en el 3D se marcan todas las ubicaciones donde esta, no solo la principal */}
        <button className="btn btn-ghost" onClick={() => (onShowAll ? onShowAll(product) : onLocate(product.location_id))}>
          <Icon name="warehouse" size={19} />{places.filter((s) => s.qty > 0).length > 1 ? `Ver las ${places.filter((s) => s.qty > 0).length} en 3D` : 'Ver en 3D'}
        </button>
        <button className="btn btn-lime" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      {isAdmin && (
        <button className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={remove}>
          Eliminar este código
        </button>
      )}
      {moving && <MoveSheet product={product} from={moving} locations={locations} onMoved={(res) => setProduct(res.product)} onClose={() => setMoving(null)} />}
    </>
  )
}

export default function ProductModal({ sku, locations, onClose, onChanged, onLocate, onShowAll }) {
  return (
    <Sheet modal onClose={onClose} label="Detalle de la prenda">
      <Body sku={sku} locations={locations} onChanged={onChanged} onLocate={onLocate} onShowAll={onShowAll} />
    </Sheet>
  )
}

export { LocationSelect }
