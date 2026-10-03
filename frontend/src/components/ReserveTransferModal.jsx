import { useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import { LocationSelect } from './ProductModal'
import { Stepper } from './Bits'

function Form({ item, locations, onDone }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [qty, setQty] = useState(Math.min(1, item.qty) || 1)
  const [locationId, setLocationId] = useState(locations[0]?.options[0]?.id || '')
  const [sku, setSku] = useState(item.sku || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!item.sku && !sku.trim()) return setError('Esta referencia todavía no tiene código. Escribe el de la etiqueta.')
    if (!locationId) return setError('Elige dónde va a quedar.')
    setBusy(true)
    try {
      const res = await api.post(`/api/reserve/${item.id}/transfer`, {
        qty: Number(qty), location_id: locationId, sku: sku.trim().toUpperCase() || undefined,
      })
      showToast(`${qty} ${res.product.name} ${res.product.size} enviadas a ${res.product.location_id}`)
      onDone(res)
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo enviar a la bodega.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-out">Reserva → Bodega</span></div>}
        title="Enviar a la bodega"
        subtitle={`${item.name}${item.size ? ` · talla ${item.size}` : ''} · hay ${item.qty} en reserva`}
      />
      <form onSubmit={submit}>
        {!item.sku && (
          <label className="field" style={{ marginTop: 0 }}>
            <span className="field-label">Código de la etiqueta</span>
            <input className="input mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. PGPRGPO44ITS" autoCapitalize="characters" />
            <span className="field-hint">Queda guardado para la próxima vez que envíes esta referencia.</span>
          </label>
        )}
        <div className="field">
          <span className="field-label">Cantidad a enviar</span>
          <div className="card scan-qty" style={{ marginTop: 0 }}>
            <div><b>{qty} de {item.qty}</b><small>Se descuentan de la reserva</small></div>
            <Stepper
              value={qty}
              onMinus={() => setQty((q) => Math.max(1, q - 1))}
              onPlus={() => setQty((q) => Math.min(item.qty, q + 1))}
              disabledMinus={qty <= 1}
              large
            />
          </div>
        </div>
        <label className="field">
          <span className="field-label">Ubicación en la bodega</span>
          <LocationSelect value={locationId} onChange={setLocationId} locations={locations} currentName={locationId} />
        </label>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={busy}>{busy ? 'Enviando…' : `Enviar ${qty}`}</button>
        </div>
      </form>
    </>
  )
}

export default function ReserveTransferModal({ onClose, ...props }) {
  return (
    <Sheet modal onClose={onClose} label="Enviar a la bodega">
      <Form {...props} />
    </Sheet>
  )
}
