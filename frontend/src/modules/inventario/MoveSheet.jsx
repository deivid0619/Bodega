import { useState } from 'react'
import { ApiError } from '../../core/api'
import { moveBetween, moveToReserve } from '../../core/useApi'
import { useToast } from '../../ui/ToastContext'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import LocationPicker from '../../ui/LocationPicker'
import { Stepper } from '../../ui/Bits'

// Mover prendas de una ubicacion: a otra ubicacion o a la reserva (guardadas
// aparte; desde la Reserva se traen de vuelta cuando haga falta)
function Form({ product, from, locations, onMoved }) {
  const showToast = useToast()
  const { close } = useSheet()
  const here = product.stock?.find((s) => s.location_id === from)?.qty || 0
  const [qty, setQty] = useState(here)
  const [to, setTo] = useState('')
  const [toReserve, setToReserve] = useState(false)
  const [error, setError] = useState('')
  const what = `${qty} ${product.name}${product.size ? ` ${product.size}` : ''}`

  const submit = async (e) => {
    e.preventDefault()
    if (!toReserve && !to) return setError('Elige a dónde las llevas.')
    close()
    try {
      if (toReserve) {
        const res = await moveToReserve(product.sku, from, qty)
        if (res.product) onMoved?.(res)
        showToast(`${what} pasaron a la reserva (salieron de ${from})`)
        return
      }
      const res = await moveBetween(product.sku, from, to, qty)
      onMoved?.(res)
      showToast(`${what} movidas a ${to}`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo mover. Revisa la conexión.', 'err')
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="code dark"><Icon name="pin" size={13} stroke={2.2} />{from}</span><Icon name="arrowRight" size={16} /><span className="code lime">{toReserve ? 'Reserva' : to || '¿?'}</span></div>}
        title="Mover prendas"
        subtitle={`${product.name}${product.size ? ` · talla ${product.size}` : ''} · hay ${here} en ${from}`}
      />
      <form onSubmit={submit}>
        <div className="field" style={{ marginTop: 0 }}>
          <span className="field-label">Cuántas</span>
          <div className="card scan-qty" style={{ marginTop: 0 }}>
            <div><b>{qty} de {here}</b><small>{qty === here ? 'Todas las de esta ubicación' : 'Quedan las demás aquí'}</small></div>
            <Stepper value={qty} onMinus={() => setQty((q) => Math.max(1, q - 1))} onPlus={() => setQty((q) => Math.min(here, q + 1))} disabledMinus={qty <= 1} large />
          </div>
        </div>
        <div className="field">
          <span className="field-label">A dónde</span>
          <div className="seg two move-dest" role="group" aria-label="A dónde las llevas">
            <button type="button" data-m="in" aria-pressed={!toReserve} onClick={() => { setToReserve(false); setError('') }}>
              <Icon name="pin" size={17} stroke={2.1} />Otra ubicación
            </button>
            <button type="button" data-m="out" aria-pressed={toReserve} onClick={() => { setToReserve(true); setError('') }}>
              <Icon name="reserve" size={17} stroke={2.1} />La reserva
            </button>
          </div>
          {toReserve ? (
            <span className="field-hint">Salen de {from} y quedan guardadas en la reserva. Desde la Reserva las traes de vuelta cuando haga falta.</span>
          ) : (
            <LocationPicker value={to} onChange={(v) => { setTo(v); setError('') }} ariaLabel="A dónde" placeholder="Elige la ubicación…"
                            groups={locations.map((g) => ({ ...g, options: g.options.filter((l) => l.id !== from) })).filter((g) => g.options.length)} />
          )}
        </div>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={here === 0}>{toReserve ? `Pasar ${qty} a la reserva` : `Mover ${qty}`}</button>
        </div>
      </form>
    </>
  )
}

export default function MoveSheet({ onClose, ...props }) {
  return (
    <Sheet modal onClose={onClose} label="Mover prendas">
      <Form {...props} />
    </Sheet>
  )
}
