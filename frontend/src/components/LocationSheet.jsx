import { forwardRef, useState } from 'react'
import { ApiError } from '../api'
import { moveStock } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader } from './Sheet'
import MoveSheet from './MoveSheet'
import Icon from './Icon'
import { ProductThumb, Stepper, plural } from './Bits'

// Lo que hay EN esta ubicacion: un codigo puede estar aqui y en otras.
export function itemsAt(products, locationId) {
  const out = []
  for (const p of products) {
    const row = p.stock?.find((s) => s.location_id === locationId)
    if (row) out.push({ p, here: row.qty })
    else if (p.location_id === locationId) out.push({ p, here: 0 })
  }
  return out
}

const LocationSheet = forwardRef(function LocationSheet(
  { locationId, locationName, products, locations, highlightSku, onClose, onScanHere, onCount, onOpenProduct }, ref,
) {
  const showToast = useToast()
  const [moving, setMoving] = useState(null)
  const items = itemsAt(products, locationId)
    .sort((a, b) => (a.p.sku === highlightSku ? -1 : b.p.sku === highlightSku ? 1 : b.here - a.here))
  const units = items.reduce((t, i) => t + i.here, 0)
  const isLow = (p) => p.min_qty > 0 && p.qty <= p.min_qty
  const lowCount = items.filter((i) => isLow(i.p)).length

  const bump = async (sku, type) => {
    try {
      await moveStock(sku, type, 1, locationId)
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
        subtitle={items.length ? `${plural(units, 'prenda', 'prendas')} aquí · ${plural(items.length, 'código', 'códigos')}` : 'Vacía en el sistema'}
      />
      {items.length ? (
        <div>
          {items.map(({ p, here }) => {
            const low = isLow(p)
            const elsewhere = (p.stock || []).filter((s) => s.location_id !== locationId)
            return (
              <div className={`prow ${p.sku === highlightSku ? 'hl' : ''}`} key={p.sku}>
                {p.image_url ? <ProductThumb src={p.image_url} alt={p.name} size="sm" /> : <div className={`sz ${low ? 'low' : ''}`}>{p.size || 'U'}</div>}
                <button className="prow-info" onClick={() => onOpenProduct(p.sku)}>
                  <b>{p.name}</b>
                  <span className="prow-meta">
                    <span className="mono">{p.sku}</span>
                    {low && <span className="warn">· bajo mínimo</span>}
                  </span>
                  {elsewhere.length > 0 && (
                    <span className="prow-meta">
                      También en {elsewhere.slice(0, 2).map((s) => `${s.location_id} (${s.qty})`).join(', ')}{elsewhere.length > 2 ? '…' : ''}
                    </span>
                  )}
                </button>
                <div className="prow-actions">
                  <Stepper value={here} onMinus={() => bump(p.sku, 'out')} onPlus={() => bump(p.sku, 'in')} minusLabel="Registrar salida de 1" plusLabel="Registrar entrada de 1" disabledMinus={here === 0} />
                  {here > 0 && (
                    <button className="link-btn" onClick={() => setMoving(p)}><Icon name="arrowRight" size={14} stroke={2.2} />Mover</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '6px 0 4px' }}>Escanea prendas con esta ubicación elegida y aparecen aquí.</p>
      )}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onCount}>
          <Icon name="equals" size={19} />Contar
        </button>
        <button className="btn btn-lime" onClick={onScanHere}>
          <Icon name="scan" size={20} />Escanear aquí
        </button>
      </div>
      {moving && <MoveSheet product={moving} from={locationId} locations={locations} onClose={() => setMoving(null)} />}
    </Sheet>
  )
})

export default LocationSheet
