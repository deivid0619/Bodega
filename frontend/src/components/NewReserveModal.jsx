import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'

function Form({ onCreated }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [qty, setQty] = useState(1)
  const [sku, setSku] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Escribe la referencia.')
    setBusy(true)
    try {
      const item = await api.post('/api/reserve', {
        name: name.trim().toUpperCase(), size: size.trim().toUpperCase(),
        qty: Number(qty), sku: sku.trim().toUpperCase() || undefined,
      })
      showToast(`${item.name} ${item.size} guardada en la reserva`)
      onCreated(item)
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader title="Agregar a la reserva" subtitle="Mercancía guardada aparte, sin ubicación todavía. Después la envías a un perchero o canasta." />
      <form onSubmit={submit}>
        <label className="field" style={{ marginTop: 0 }}>
          <span className="field-label">Referencia</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Chaqueta Fenix Black Fem" autoFocus />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Talla</span>
            <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Única" />
          </label>
          <label className="field">
            <span className="field-label">Cantidad</span>
            <input className="input" type="number" min="0" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Código (opcional)</span>
          <input className="input mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Si ya lo sabes" autoCapitalize="characters" />
        </label>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={busy}>{busy ? 'Guardando…' : 'Guardar en reserva'}</button>
        </div>
      </form>
    </>
  )
}

export default function NewReserveModal({ onClose, onCreated }) {
  return (
    <Sheet modal onClose={onClose} label="Agregar a la reserva">
      <Form onCreated={onCreated} />
    </Sheet>
  )
}
