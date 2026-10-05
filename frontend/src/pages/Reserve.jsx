import { useMemo, useState } from 'react'
import { ApiError } from '../api'
import { refreshInventory, setReserveQty, useLayout, useReserve } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import NewReserveModal from '../components/NewReserveModal'
import ReserveTransferModal from '../components/ReserveTransferModal'
import Icon from '../components/Icon'
import { Count, Empty, PageHead, ProductThumb, Stepper, plural } from '../components/Bits'

export default function Reserve() {
  const { data: items } = useReserve()
  const { data: layout } = useLayout()
  const showToast = useToast()
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(null)
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const total = useMemo(() => (items || []).reduce((s, i) => s + i.qty, 0), [items])

  const bump = async (item, delta) => {
    const next = item.qty + delta
    if (next < 0) return
    try {
      await setReserveQty(item, next)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo ajustar.', 'err')
    }
  }

  return (
    <section className="page" aria-label="Bodega de reserva">
      <div className="page-inner">
        <PageHead title="Reserva" lede="Mercancía guardada aparte. De aquí se surte la bodega principal." />

        <div className="res-hero">
          <b>{items ? <Count value={total} /> : '–'}</b>
          <span>{total === 1 ? 'prenda' : 'prendas'} en reserva<br />{items ? plural(items.length, 'referencia', 'referencias') : ''}</span>
        </div>
        <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} stroke={2.4} />Agregar a la reserva
        </button>

        <h2 className="h-sec">Lo que hay guardado</h2>
        <div className="list">
          {!items ? (
            [0, 1].map((i) => <div key={i} className="skeleton" />)
          ) : items.length ? (
            items.map((item, i) => (
              <article className="card res-card" key={item.id}>
                <ProductThumb size="sm" />
                <div style={{ minWidth: 0 }}>
                  <h3 className="res-name">{item.name}</h3>
                  <div className="res-meta">
                    <span className="tag tag-out">{item.size || 'Única'}</span>
                    {item.sku ? <span className="code">{item.sku}</span> : <span className="tag tag-warn">Sin código</span>}
                  </div>
                </div>
                <div className="res-actions">
                  <Stepper value={item.qty} onMinus={() => bump(item, -1)} onPlus={() => bump(item, 1)} disabledMinus={item.qty === 0} />
                  <button className="btn btn-ink btn-sm" disabled={item.qty === 0} onClick={() => setSending(item)}>
                    Enviar a bodega<Icon name="arrowRight" size={17} stroke={2.2} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <Empty icon="reserve" title="La reserva está vacía">Agrega la mercancía que tengas guardada aparte para no perderle el rastro.</Empty>
          )}
        </div>
      </div>

      {adding && <NewReserveModal onClose={() => setAdding(false)} onCreated={refreshInventory} />}
      {sending && layout && (
        <ReserveTransferModal item={sending} locations={groups} onClose={() => setSending(null)} onDone={refreshInventory} />
      )}
    </section>
  )
}
