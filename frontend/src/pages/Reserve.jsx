import { useState } from 'react'
import { api, ApiError } from '../api'
import { useReserve, useLayout } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import NewReserveModal from '../components/NewReserveModal'
import ReserveTransferModal from '../components/ReserveTransferModal'

export default function Reserve() {
  const { data: items, reload } = useReserve()
  const { data: layout } = useLayout()
  const showToast = useToast()
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(null) // item en proceso de enviar a bodega
  const groups = locationGroups(layout?.elements)

  const bump = async (item, delta) => {
    const next = item.qty + delta
    if (next < 0) return
    try {
      await api.patch(`/api/reserve/${item.id}`, { qty: next })
      reload()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo ajustar.', 'err')
    }
  }

  return (
    <div className="view">
      <h2>Bodega de reserva</h2>
      <p className="muted">Mercancía guardada aparte, todavía sin ubicación en un perchero o canasta.</p>
      <button className="btn primary big" onClick={() => setAdding(true)}>Agregar mercancía a la reserva</button>

      {items?.length ? (
        items.map((item) => (
          <div className="reserve-card" key={item.id}>
            <div className="reserve-info">
              <b>{item.name}</b>
              <small>
                {item.size || 'Única'} · {item.sku || 'sin código todavía'}
              </small>
            </div>
            <div className="pm">
              <button onClick={() => bump(item, -1)} aria-label="Restar 1">−</button>
              <output>{item.qty}</output>
              <button onClick={() => bump(item, 1)} aria-label="Sumar 1">+</button>
            </div>
            <button className="btn dark" disabled={item.qty === 0} onClick={() => setSending(item)}>
              Enviar a bodega
            </button>
          </div>
        ))
      ) : (
        <div className="empty">
          La reserva está vacía. Agrega la mercancía que tengas guardada aparte.
        </div>
      )}

      {adding && (
        <NewReserveModal onClose={() => setAdding(false)} onCreated={() => { setAdding(false); reload() }} />
      )}
      {sending && layout && (
        <ReserveTransferModal
          item={sending}
          locations={groups}
          onClose={() => setSending(null)}
          onDone={() => { setSending(null); reload() }}
        />
      )}
    </div>
  )
}
