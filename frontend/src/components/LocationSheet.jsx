import { forwardRef } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader } from './Sheet'
import Icon from './Icon'
import { ProductThumb, Stepper, plural } from './Bits'

const LocationSheet = forwardRef(function LocationSheet(
  { locationId, locationName, products, highlightSku, onClose, onChanged, onScanHere, onOpenProduct }, ref,
) {
  const showToast = useToast()
  const items = products.filter((p) => p.location_id === locationId).sort((a, b) => (a.sku === highlightSku ? -1 : b.sku === highlightSku ? 1 : b.qty - a.qty))
  const units = items.reduce((a, p) => a + p.qty, 0)
  const lowCount = items.filter((p) => p.min_qty > 0 && p.qty <= p.min_qty).length

  const bump = async (sku, type) => {
    try {
      await api.post('/api/movements', { sku, type, qty: 1 })
      onChanged()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo registrar.', 'err')
    }
  }

  return (
    <Sheet ref={ref} onClose={onClose} size="half" label={`Ubicación ${locationId}`}>
      <SheetHeader
        eyebrow={
          <div className="sheet-eyebrow">
            <span className="code lime"><Icon name="pin" size={13} stroke={2.2} />{locationId}</span>
            {lowCount > 0 && <span className="tag tag-warn">{plural(lowCount, 'talla por reponer', 'tallas por reponer')}</span>}
          </div>
        }
        title={locationName}
        subtitle={items.length ? `${plural(units, 'prenda', 'prendas')} · ${plural(items.length, 'código', 'códigos')}` : 'Vacía en el sistema'}
      />
      {items.length ? (
        <div>
          {items.map((p) => {
            const low = p.min_qty > 0 && p.qty <= p.min_qty
            return (
              <div className={`prow ${p.sku === highlightSku ? 'hl' : ''}`} key={p.sku}>
                {p.image_url ? <ProductThumb src={p.image_url} alt={p.name} size="sm" /> : <div className={`sz ${low ? 'low' : ''}`}>{p.size || 'U'}</div>}
                <button className="prow-info" onClick={() => onOpenProduct(p.sku)}>
                  <b>{p.name}</b>
                  <span className="prow-meta">
                    <span className="mono">{p.sku}</span>
                    {p.image_url && p.size && <span>· {p.size}</span>}
                    {low && <span className="warn">· bajo mínimo</span>}
                  </span>
                </button>
                <Stepper value={p.qty} onMinus={() => bump(p.sku, 'out')} onPlus={() => bump(p.sku, 'in')} minusLabel="Registrar salida de 1" plusLabel="Registrar entrada de 1" disabledMinus={p.qty === 0} />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '6px 0 4px' }}>Escanea prendas con esta ubicación elegida y aparecen aquí.</p>
      )}
      <button className="btn btn-lime btn-block" style={{ marginTop: 16 }} onClick={onScanHere}>
        <Icon name="scan" size={20} />Escanear prendas para aquí
      </button>
    </Sheet>
  )
})

export default LocationSheet
