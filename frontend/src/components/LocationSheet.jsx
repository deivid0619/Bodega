import { api, ApiError } from '../api'
import { useToast } from './ToastContext'

export default function LocationSheet({ locationId, locationName, products, onClose, onChanged, onScanHere, onOpenProduct }) {
  const showToast = useToast()
  const items = products.filter((p) => p.location_id === locationId)
  const units = items.reduce((a, p) => a + p.qty, 0)

  const bump = async (sku, type) => {
    try {
      await api.post('/api/movements', { sku, type, qty: 1 })
      onChanged()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo registrar.', 'err')
    }
  }

  if (!locationId) return null

  return (
    <div className="sheet open">
      <div className="grab" />
      <div className="sh-head">
        <div>
          <h2>{locationName}</h2>
          <p>{units} {units === 1 ? 'prenda' : 'prendas'}{items.length ? `, ${items.length} ${items.length === 1 ? 'código' : 'códigos'}` : ''}</p>
        </div>
        <button className="x" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      {items.length ? (
        items.map((p) => (
          <div className={`row ${p.min_qty > 0 && p.qty <= p.min_qty ? 'low' : ''}`} key={p.sku}>
            <div className="sz">{p.size || 'U'}</div>
            <button className="info" onClick={() => onOpenProduct(p.sku)}>
              <b>{p.name}</b>
              <small>{p.sku}{p.min_qty > 0 && p.qty <= p.min_qty ? <em> bajo mínimo ({p.min_qty})</em> : null}</small>
            </button>
            <div className="pm">
              <button onClick={() => bump(p.sku, 'out')} aria-label="Registrar salida de 1">−</button>
              <output>{p.qty}</output>
              <button onClick={() => bump(p.sku, 'in')} aria-label="Registrar entrada de 1">+</button>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">Esta ubicación está vacía en el sistema.</p>
      )}
      <button className="btn dark big" onClick={onScanHere}>Escanear prendas nuevas para aquí</button>
    </div>
  )
}
