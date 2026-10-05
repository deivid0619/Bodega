import { useState } from 'react'
import { ApiError } from '../api'
import { moveBetween } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { Stepper } from './Bits'

function Form({ product, from, locations, onMoved }) {
  const showToast = useToast()
  const { close } = useSheet()
  const here = product.stock?.find((s) => s.location_id === from)?.qty || 0
  const [qty, setQty] = useState(here)
  const [to, setTo] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!to) return setError('Elige a dónde las llevas.')
    close()
    try {
      const res = await moveBetween(product.sku, from, to, qty)
      onMoved?.(res)
      showToast(`${qty} ${product.name}${product.size ? ` ${product.size}` : ''} movidas a ${to}`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo mover. Revisa la conexión.', 'err')
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="code dark"><Icon name="pin" size={13} stroke={2.2} />{from}</span><Icon name="arrowRight" size={16} /><span className="code lime">{to || '¿?'}</span></div>}
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
        <label className="field">
          <span className="field-label">A dónde</span>
          <select className="input" value={to} onChange={(e) => { setTo(e.target.value); setError('') }}>
            <option value="">Elige la ubicación…</option>
            {locations.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={here === 0}>Mover {qty}</button>
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
