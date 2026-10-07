import { forwardRef, useState } from 'react'
import { api, ApiError } from '../api'
import { bumpStock, usePolling } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader } from './Sheet'
import MoveSheet from './MoveSheet'
import ParcelSheet, { parcelIcon, parcelName, waited } from './ParcelSheet'
import Icon from './Icon'
import { ProductThumb, Stepper, plural } from './Bits'
import RestockHint from './RestockHint'

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
  { locationId, locationName, products, locations, highlightSku, outlet = false, canEditOutlet = false, onOutletChanged,
    onClose, onScanHere, onCount, onOpenProduct }, ref,
) {
  const showToast = useToast()
  const [moving, setMoving] = useState(null)
  const [outletNow, setOutletNow] = useState(null) // lo que se acaba de tocar, mientras llega el plano nuevo
  const isOutlet = outletNow ?? outlet
  const [parcelOpen, setParcelOpen] = useState(null) // 'new' o lo anotado que se esta viendo
  const { data: parcels } = usePolling('/api/parcels', { interval: 20000 })
  const here = (parcels || []).filter((x) => x.location_id === locationId)
  const items = itemsAt(products, locationId)
    .sort((a, b) => (a.p.sku === highlightSku ? -1 : b.p.sku === highlightSku ? 1 : b.here - a.here))
  const units = items.reduce((t, i) => t + i.here, 0)
  const isLow = (p) => p.min_qty > 0 && p.qty <= p.min_qty
  const lowCount = items.filter((i) => isLow(i.p)).length

  // una sola canasta, nivel o barra como outlet: lo que hay aqui no cuenta
  const setOutlet = async (on, undo = false) => {
    setOutletNow(on)
    try {
      await api.put(`/api/layout/locations/${encodeURIComponent(locationId)}/outlet`, { outlet: on })
      await onOutletChanged?.()
      if (!undo) {
        showToast(on ? `${locationId} es outlet: lo que hay aquí no cuenta` : `${locationId} vuelve a contar en el inventario`, 'ok',
          { label: 'Deshacer', onClick: () => setOutlet(!on, true) })
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo cambiar. Intenta otra vez.', 'err')
    }
    setOutletNow(null)
  }

  const bump = async (sku, type) => {
    try {
      await bumpStock(sku, type === 'in' ? 1 : -1, locationId)
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
            {isOutlet && <span className="tag tag-outlet">Outlet</span>}
            {lowCount > 0 && <span className="tag tag-warn">{plural(lowCount, 'talla por reponer', 'tallas por reponer')}</span>}
          </div>
        }
        title={locationName}
        subtitle={[
          items.length && `${plural(units, 'prenda', 'prendas')} aquí · ${plural(items.length, 'código', 'códigos')}`,
          here.length && plural(here.length, 'bulto de paso', 'bultos de paso'),
        ].filter(Boolean).join(' · ') || 'Vacía en el sistema'}
      />
      {here.length > 0 && (
        <div className="loc-parcels">
          {here.map((x) => {
            const w = waited(x.created_at)
            return (
              <button type="button" className="loc-parcel" key={x.id} onClick={() => setParcelOpen(x)}>
                <span className="parcel-ico"><Icon name={parcelIcon(x)} size={18} /></span>
                <span className="need-t">
                  <b>De paso · {parcelName(x)}{x.owner ? ` · ${x.owner}` : ''}</b>
                  {x.notes && <small className="note wrap">{x.notes}</small>}
                  <small><span className={w.late ? 'late' : ''}>{w.text}</span> · {x.user_name}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {items.length ? (
        <div>
          {items.map(({ p, here }) => {
            const low = isLow(p)
            const elsewhere = (p.stock || []).filter((s) => s.location_id !== locationId)
            return (
              <div className={`prow ${p.sku === highlightSku ? 'hl' : ''} ${low || here === 0 ? 'wrap' : ''}`} key={p.sku}>
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
                {(low || here === 0) && <RestockHint product={p} to={locationId} />}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted" style={{ padding: '6px 0 4px' }}>Escanea prendas con esta ubicación elegida y aparecen aquí.</p>
      )}
      {canEditOutlet ? (
        <div className="ctl outlet-ctl loc-outlet">
          <span>Outlet<small>Lo que haya en esta ubicación no cuenta en el inventario</small></span>
          <button type="button" className="switch" role="switch" aria-checked={isOutlet} aria-label={`Outlet ${locationId}`}
                  disabled={outletNow !== null} onClick={() => setOutlet(!isOutlet)} />
        </div>
      ) : isOutlet && (
        <p className="loc-outlet-note">Outlet: lo que hay aquí no cuenta en el inventario.</p>
      )}
      <button type="button" className="link-btn loc-note" onClick={() => setParcelOpen('new')}>
        <Icon name="plus" size={14} stroke={2.4} />Anotar algo de paso aquí
      </button>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onCount}>
          <Icon name="equals" size={19} />Contar
        </button>
        <button className="btn btn-lime" onClick={onScanHere}>
          <Icon name="scan" size={20} />Escanear aquí
        </button>
      </div>
      {moving && <MoveSheet product={moving} from={locationId} locations={locations} onClose={() => setMoving(null)} />}
      {parcelOpen && (
        <ParcelSheet
          parcel={parcelOpen === 'new' ? null : parcelOpen}
          defaultLocation={locationId}
          showMap={false}
          onClose={() => setParcelOpen(null)}
        />
      )}
    </Sheet>
  )
})

export default LocationSheet
