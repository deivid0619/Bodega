import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from './ToastContext'
import Modal from './Modal'
import BarcodeBars from './BarcodeBars'

export default function ProductModal({ sku, locations, onClose, onChanged, onLocate }) {
  const { isAdmin } = useAuth()
  const showToast = useToast()
  const [product, setProduct] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState(null)

  const load = async () => {
    const p = await api.get(`/api/products/${encodeURIComponent(sku)}`)
    setProduct(p)
    setForm({ name: p.name, size: p.size, min_qty: p.min_qty, location_id: p.location_id })
  }

  useEffect(() => {
    load().catch(() => showToast('No se pudo cargar ese código.', 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku])

  const bump = async (type) => {
    try {
      const res = await api.post('/api/movements', { sku, type, qty: 1 })
      setProduct(res.product)
      onChanged()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo registrar.', 'err')
    }
  }

  const save = async () => {
    try {
      const p = await api.patch(`/api/products/${encodeURIComponent(sku)}`, {
        name: form.name,
        size: form.size,
        min_qty: Number(form.min_qty),
        location_id: form.location_id,
      })
      setProduct(p)
      onChanged()
      showToast('Cambios guardados')
      onClose()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo guardar.', 'err')
    }
  }

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    try {
      await api.delete(`/api/products/${encodeURIComponent(sku)}`)
      onChanged()
      showToast('Código eliminado')
      onClose()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo eliminar.', 'err')
    }
  }

  if (!product || !form) return <Modal open onClose={onClose}><p className="muted">Cargando…</p></Modal>

  return (
    <Modal open onClose={onClose}>
      <div className="label">
        <BarcodeBars code={product.sku} />
        <div className="sku">{product.sku}</div>
        <h3 className="name">{product.name}</h3>
      </div>
      <div className="stock">
        <button className="round" onClick={() => bump('out')} aria-label="Registrar salida de 1">−</button>
        <div><b>{product.qty}</b><span>en bodega</span></div>
        <button className="round" onClick={() => bump('in')} aria-label="Registrar entrada de 1">+</button>
      </div>
      <p className="muted" style={{ textAlign: 'center' }}>
        {product.out_30d} {product.out_30d === 1 ? 'salió' : 'salieron'} en los últimos 30 días.
      </p>
      <label className="field">Referencia
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <div className="two">
        <label className="field">Talla
          <input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
        </label>
        <label className="field">Stock mínimo
          <input type="number" min="0" inputMode="numeric" value={form.min_qty}
                 onChange={(e) => setForm({ ...form, min_qty: e.target.value })} />
        </label>
      </div>
      <label className="field">Ubicación
        <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
          {!locations.some((l) => l.id === form.location_id) && (
            <option value={form.location_id}>{product.location_name}</option>
          )}
          {locations.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="btn ghost" onClick={() => onLocate(product.location_id)}>Ver en la bodega</button>
        <button className="btn primary" onClick={save}>Guardar cambios</button>
      </div>
      {isAdmin && (
        <button className="btn danger" onClick={remove}>
          {confirmDelete ? 'Toca otra vez para eliminar' : 'Eliminar este código'}
        </button>
      )}
    </Modal>
  )
}
