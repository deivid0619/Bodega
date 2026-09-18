import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Modal from './Modal'

export default function NewReserveModal({ onClose, onCreated }) {
  const showToast = useToast()
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [qty, setQty] = useState(1)
  const [sku, setSku] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Escribe la referencia.')
      return
    }
    setBusy(true)
    try {
      const item = await api.post('/api/reserve', {
        name: name.trim().toUpperCase(), size: size.trim().toUpperCase(),
        qty: Number(qty), sku: sku.trim() || undefined,
      })
      showToast(`${item.name} ${item.size} guardada en reserva`)
      onCreated(item)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <h2>Nueva mercancía en reserva</h2>
      <p className="muted">Todavía sin ubicación — se guarda aparte hasta que la envíes a un perchero o canasta.</p>
      <form onSubmit={submit}>
        <label className="field">Referencia
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Chaqueta Fenix Black Fem" autoFocus />
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
        <label className="field">Código (SKU) — si ya lo sabes
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Opcional por ahora" autoCapitalize="characters" />
        </label>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar en reserva'}</button>
        </div>
      </form>
    </Modal>
  )
}
