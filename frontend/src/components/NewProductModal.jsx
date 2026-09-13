import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Modal from './Modal'
import { guessSizeFromSku } from '../utils'

export default function NewProductModal({ sku, defaultLocation, locations, onClose, onCreated }) {
  const showToast = useToast()
  const [name, setName] = useState('')
  const [size, setSize] = useState(guessSizeFromSku(sku))
  const [qty, setQty] = useState(0)
  const [minQty, setMinQty] = useState(3)
  const [locationId, setLocationId] = useState(defaultLocation)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Escribe la referencia para poder registrarla.')
      return
    }
    setBusy(true)
    try {
      const res = await api.post('/api/products', {
        sku, name: name.trim().toUpperCase(), size: size.trim().toUpperCase(),
        location_id: locationId, qty: Number(qty), min_qty: Number(minQty),
      })
      showToast(`${res.product.name} ${res.product.size} registrada`)
      onCreated(res)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar la prenda.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2>Prenda nueva</h2>
      <p className="muted">El código <b>{sku}</b> no está registrado.</p>
      <form onSubmit={submit}>
        <label className="field">Referencia
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como aparece en la etiqueta" autoFocus />
          {error && <small className="err">{error}</small>}
        </label>
        <div className="two">
          <label className="field">Talla
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Única" />
          </label>
          <label className="field">Cantidad
            <input type="number" min="0" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        </div>
        <label className="field">Ubicación
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">Stock mínimo
          <input type="number" min="0" inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          <small>Si llega a este número aparece en Pedidos. 0 para no avisar.</small>
        </label>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar prenda'}</button>
        </div>
      </form>
    </Modal>
  )
}
