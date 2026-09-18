import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Modal from './Modal'

export default function ReserveTransferModal({ item, locations, onClose, onDone }) {
  const showToast = useToast()
  const [qty, setQty] = useState(Math.min(1, item.qty) || 1)
  const [locationId, setLocationId] = useState(locations[0]?.options[0]?.id || '')
  const [sku, setSku] = useState(item.sku || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!item.sku && !sku.trim()) {
      setError('Este ítem todavía no tiene código — escribe el que trae la etiqueta.')
      return
    }
    if (!locationId) {
      setError('Elige dónde va a quedar.')
      return
    }
    setBusy(true)
    try {
      const res = await api.post(`/api/reserve/${item.id}/transfer`, {
        qty: Number(qty), location_id: locationId, sku: sku.trim() || undefined,
      })
      showToast(`${res.product.name} ${res.product.size}: ${qty} enviadas a ${res.product.location_name}`)
      onDone(res)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar a la bodega.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2>Enviar a la bodega</h2>
      <p className="muted">{item.name} {item.size} · hay {item.qty} en reserva</p>
      <form onSubmit={submit}>
        {!item.sku && (
          <label className="field">Código (SKU)
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Como aparece en la etiqueta" autoCapitalize="characters" />
            <small>Se guarda para la próxima vez que envíes esta referencia.</small>
          </label>
        )}
        <div className="two">
          <label className="field">Cantidad a enviar
            <input type="number" min="1" max={item.qty} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          <label className="field">Ubicación
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="login-err">{error}</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</button>
        </div>
      </form>
    </Modal>
  )
}
