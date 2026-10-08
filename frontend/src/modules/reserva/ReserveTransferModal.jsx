import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../core/api'
import { useToast } from '../../ui/ToastContext'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import { LocationSelect } from '../inventario/ProductModal'
import { ProductThumb, Stepper, plural } from '../../ui/Bits'
import Icon from '../../ui/Icon'

// Sacar de la reserva: a una ubicacion de la bodega, o despachar (sale ya
// empacado, sin quedar en ninguna canasta). Desde una prenda en su minimo
// ("Traer de la reserva") llegan ya la ubicacion, la cantidad y el codigo.
function Form({ item, locations, onDone, defaultLocation, defaultQty, defaultSku }) {
  const showToast = useToast()
  const navigate = useNavigate()
  const { close } = useSheet()
  const [mode, setMode] = useState('bodega') // bodega | despachar
  const [qty, setQty] = useState(Math.min(defaultQty || 1, item.qty) || 1)
  // a la bodega va a una ubicacion de verdad: para lo que sale esta "Despachar"
  const places = locations.filter((g) => !g.options.some((o) => o.id === 'DESPACHO'))
  const [locationId, setLocationId] = useState(
    defaultLocation && places.some((g) => g.options.some((o) => o.id === defaultLocation)) ? defaultLocation : places[0]?.options[0]?.id || '')
  const [sku, setSku] = useState(item.sku || defaultSku || '')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const out = mode === 'despachar'

  const submit = async (e) => {
    e.preventDefault()
    if (!item.sku && !sku.trim()) return setError('Esta referencia todavía no tiene código. Escribe el de la etiqueta.')
    if (!out && !locationId) return setError('Elige dónde va a quedar.')
    setBusy(true)
    try {
      const code = sku.trim().toUpperCase() || undefined
      const what = `${plural(Number(qty), 'prenda', 'prendas')} ${item.name}${item.size ? ` ${item.size}` : ''}`
      if (out) {
        const res = await api.post(`/api/reserve/${item.id}/dispatch`, { qty: Number(qty), note: note.trim() || undefined, sku: code })
        showToast(`Despachadas: ${what}. Ya no están en la reserva${res.reserve.qty <= 0 ? ' (se acabó allá)' : ''}.`)
        onDone(res)
      } else {
        const res = await api.post(`/api/reserve/${item.id}/transfer`, { qty: Number(qty), location_id: locationId, sku: code })
        if (locationId === 'DESPACHO') {
          // de paso: quedan esperando en Resumen > Por despachar
          showToast(`${what} en Despacho: están en Resumen › Por despachar`, 'ok', { label: 'Ver', onClick: () => navigate('/summary#despacho') })
        } else {
          showToast(`${what} ${Number(qty) === 1 ? 'enviada' : 'enviadas'} a ${locationId}${res.reserve.qty <= 0 ? ' · se acabó en la reserva' : ''}`)
        }
        onDone(res)
      }
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : out ? 'No se pudo despachar.' : 'No se pudo enviar a la bodega.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-out">{out ? 'Reserva → Despacho' : 'Reserva → Bodega'}</span></div>}
        title="Sacar de la reserva"
        subtitle={`${item.name}${item.size ? ` · talla ${item.size}` : ''} · hay ${item.qty} en reserva`}
      />
      {item.image_url && (
        <div className="transfer-photo"><ProductThumb src={item.image_url} alt={item.name} size="lg" /></div>
      )}
      <form onSubmit={submit}>
        <div className="seg two" role="group" aria-label="Para dónde van">
          <button type="button" data-m="in" aria-pressed={!out} onClick={() => setMode('bodega')}>
            <Icon name="warehouse" size={18} stroke={2.1} />A la bodega
          </button>
          <button type="button" data-m="out" aria-pressed={out} onClick={() => setMode('despachar')}>
            <Icon name="boxOut" size={18} stroke={2.1} />Despachar
          </button>
        </div>
        <p className="mode-hint">
          {out
            ? 'Salen ya, empacadas: se descuentan de la reserva sin quedar en ninguna canasta.'
            : 'Se guardan en una canasta, perchero o estantería. Si todavía no sabes dónde van, déjalas en la reserva hasta saberlo.'}
        </p>
        {!item.sku && (
          <label className="field">
            <span className="field-label">Código de la etiqueta</span>
            <input className="input mono" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. PGPRGPO44ITS" autoCapitalize="characters" />
            <span className="field-hint">Queda guardado para la próxima vez.</span>
          </label>
        )}
        <div className="field">
          <span className="field-label">{out ? 'Cuántas salen' : 'Cantidad a enviar'}</span>
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
        {out ? (
          <label className="field">
            <span className="field-label">Nota (opcional)</span>
            <input className="input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="Ej. pedido de Juan, guía 1234" />
            <span className="field-hint">Queda en el historial de movimientos.</span>
          </label>
        ) : (
          <label className="field">
            <span className="field-label">Ubicación en la bodega</span>
            <LocationSelect value={locationId} onChange={setLocationId} locations={places} currentName={locationId} />
          </label>
        )}
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className={`btn ${out ? 'btn-ink' : 'btn-lime'}`} disabled={busy}>
            {busy ? (out ? 'Despachando…' : 'Enviando…') : out ? `Despachar ${qty}` : `Enviar ${qty}`}
          </button>
        </div>
      </form>
    </>
  )
}

export default function ReserveTransferModal({ onClose, ...props }) {
  return (
    <Sheet modal onClose={onClose} label="Sacar de la reserva">
      <Form {...props} />
    </Sheet>
  )
}
