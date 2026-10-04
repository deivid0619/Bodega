import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from './ToastContext'
import { moveStock } from '../hooks/useApi'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { ProductThumb, Stepper, StockMeter } from './Bits'

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

function Body({ sku, locations, onChanged, onLocate }) {
  const { isAdmin } = useAuth()
  const showToast = useToast()
  const { close } = useSheet()
  const [product, setProduct] = useState(null)
  const [form, setForm] = useState(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/api/products/${encodeURIComponent(sku)}`)
      .then((p) => {
        setProduct(p)
        setForm({ name: p.name, size: p.size, min_qty: p.min_qty, location_id: p.location_id })
      })
      .catch(() => showToast('No se pudo cargar ese código.', 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku])

  const bump = async (type) => {
    setProduct((p) => ({ ...p, qty: type === 'in' ? p.qty + 1 : Math.max(0, p.qty - 1) }))
    try {
      const res = await moveStock(sku, type, 1)
      setProduct((p) => ({ ...p, qty: res.product.qty, out_30d: res.product.out_30d }))
    } catch (e) {
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
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 3000)
      return
    }
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

  const low = product.min_qty > 0 && product.qty <= product.min_qty
  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="code">{product.sku}</span>{product.size && <span className="tag tag-out">Talla {product.size}</span>}</div>}
        title={product.name}
      />
      <div className="prod-hero">
        <ProductThumb src={product.image_url} alt={product.name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <button className="code dark" onClick={() => onLocate(product.location_id)}>
            <Icon name="pin" size={13} stroke={2.2} />{product.location_id}
          </button>
          <p className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>{product.location_name}</p>
        </div>
      </div>

      <div className="prod-stock">
        <div className="count">
          <b>{product.qty}</b>
          <span>en bodega{product.min_qty > 0 ? ` · mínimo ${product.min_qty}` : ''}</span>
        </div>
        <Stepper onMinus={() => bump('out')} onPlus={() => bump('in')} minusLabel="Registrar salida de 1" plusLabel="Registrar entrada de 1" disabledMinus={product.qty === 0} large>
          <span style={{ width: 8 }} />
        </Stepper>
      </div>
      <div className="prod-note">
        <span>{product.out_30d} {product.out_30d === 1 ? 'salió' : 'salieron'} en los últimos 30 días</span>
        {product.min_qty > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {low && <span className="tag tag-warn">Por reponer</span>}
            <StockMeter qty={product.qty} min={product.min_qty} />
          </span>
        )}
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
        <span className="field-label">Ubicación</span>
        <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} locations={locations} currentName={product.location_name} />
      </label>
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={() => onLocate(product.location_id)}><Icon name="warehouse" size={19} />Ver en 3D</button>
        <button className="btn btn-lime" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      {isAdmin && (
        <button className="btn btn-danger btn-block" style={{ marginTop: 8 }} onClick={remove}>
          {armed ? 'Toca otra vez para eliminar' : 'Eliminar este código'}
        </button>
      )}
    </>
  )
}

export default function ProductModal({ sku, locations, onClose, onChanged, onLocate }) {
  return (
    <Sheet modal onClose={onClose} label="Detalle de la prenda">
      <Body sku={sku} locations={locations} onChanged={onChanged} onLocate={onLocate} />
    </Sheet>
  )
}

export { LocationSelect }
