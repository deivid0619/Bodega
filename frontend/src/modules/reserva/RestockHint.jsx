import { useMemo, useState } from 'react'
import { refreshInventory, useLayout, useReserve } from '../../core/useApi'
import { locationGroups } from '../../core/locationGroups'
import { outletIdsOf, reserveFor, reserveIndex, stockSplit } from '../../core/utils'
import ReserveTransferModal from './ReserveTransferModal'
import Icon from '../../ui/Icon'

// Lo que hay de una prenda en la reserva cuando en la bodega esta agotada o en
// su minimo (null si no hace falta o no hay)
export function useSupply(product) {
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  return useMemo(() => {
    if (!product) return null
    // lo de paso y el outlet no son de la bodega
    const have = stockSplit(product, null, outletIdsOf(layout)).bodega
    const short = have <= 0 || (product.min_qty > 0 && have <= product.min_qty)
    const items = reserveFor(product, reserveIndex(reserve))
    const inReserve = items.reduce((t, it) => t + it.qty, 0)
    if (!short || !inReserve) return null
    const item = items[0] // la guardada con su codigo, primero
    // como en "Por reponer": llevarla al doble del minimo, hasta lo que haya
    return { have, inReserve, item, suggest: Math.min(item.qty, Math.max(1, product.min_qty * 2 - have)) }
  }, [product, reserve, layout])
}

// "Abastecimiento disponible": la talla esta agotada o en su minimo y hay en
// la reserva. "Traer de la reserva" abre "Sacar de la reserva" con la
// ubicacion (to, o la principal) y la cantidad sugerida ya puestas.
export default function RestockHint({ product, to }) {
  const { data: layout } = useLayout()
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const r = useSupply(product)
  const [open, setOpen] = useState(false)
  if (!r) return null
  return (
    <>
      <div className="restock-hint" role="note">
        <span className="restock-t">
          <b>Abastecimiento disponible</b>
          <small>{r.have <= 0 ? 'Agotada en la bodega' : 'Está en el mínimo'} · hay {r.inReserve} en la reserva</small>
        </span>
        <button type="button" className="btn btn-lime btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
          <Icon name="reserve" size={16} stroke={2.2} />Traer de la reserva
        </button>
      </div>
      {open && (
        <ReserveTransferModal item={r.item} locations={groups} defaultLocation={to || product.location_id} defaultQty={r.suggest}
                              defaultSku={product.sku} onClose={() => setOpen(false)} onDone={refreshInventory} />
      )}
    </>
  )
}
