import { useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { refreshInventory, setReserveQty, useLayout, useReserve, useRestock } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { locationGroups } from '../locationGroups'
import NewReserveModal from '../components/NewReserveModal'
import ReserveTransferModal from '../components/ReserveTransferModal'
import Icon from '../components/Icon'
import { Count, Empty, PageHead, ProductThumb, Stepper, plural } from '../components/Bits'

// Una talla agotada o en su minimo en la bodega que tiene prendas en la
// reserva: se lleva con un toque a su ubicacion principal.
function RestockCard({ task, onDone }) {
  const showToast = useToast()
  const { product: p, reserve: r } = task
  const [qty, setQty] = useState(task.suggest)
  const [busy, setBusy] = useState(false)

  const bring = async () => {
    setBusy(true)
    try {
      await api.post(`/api/reserve/${r.id}/transfer`, { qty, location_id: p.location_id, sku: p.sku })
      showToast(`${qty} ${p.name}${p.size ? ` ${p.size}` : ''} llevadas a ${p.location_id}`)
      onDone(p.sku)
      refreshInventory()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo llevar. Intenta otra vez.', 'err')
      setBusy(false)
    }
  }

  return (
    <article className="card task-card">
      <div className={`sz ${p.qty === 0 ? '' : 'low'}`}>{p.size || 'U'}</div>
      <div className="task-t">
        <h3>{p.name}</h3>
        <p>
          {p.qty === 0 ? <b className="warn">Agotada en la bodega</b> : <>Hay <b>{p.qty}</b> de mínimo {p.min_qty}</>}
          {' · '}{r.qty} en reserva
        </p>
      </div>
      <div className="task-actions">
        <Stepper
          value={qty}
          onMinus={() => setQty((q) => Math.max(1, q - 1))}
          onPlus={() => setQty((q) => Math.min(r.qty, q + 1))}
          disabledMinus={qty <= 1}
          minusLabel="Llevar una menos"
          plusLabel="Llevar una más"
        />
        <button className="btn btn-ink btn-sm" onClick={bring} disabled={busy}>
          Llevar a <span className="mono">{p.location_id}</span><Icon name="arrowRight" size={16} stroke={2.2} />
        </button>
      </div>
    </article>
  )
}

export default function Reserve() {
  const { data: items } = useReserve()
  const { data: restock } = useRestock()
  const { data: layout } = useLayout()
  const showToast = useToast()
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const total = useMemo(() => (items || []).reduce((s, i) => s + i.qty, 0), [items])
  // la que ya se llevo desaparece al instante, sin esperar el siguiente sondeo
  const tasks = (restock || []).filter((t) => !done.has(`${t.product.sku}:${t.product.qty}`))

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

        {tasks.length > 0 && (
          <>
            <h2 className="h-sec">Para llevar a la bodega <small>{plural(tasks.length, 'talla', 'tallas')}</small></h2>
            <p className="mode-hint" style={{ margin: '-4px 0 10px' }}>Están agotadas o en su mínimo en la bodega y aquí hay guardadas.</p>
            <div className="list">
              {tasks.map((t) => (
                <RestockCard
                  key={`${t.reserve.id}-${t.product.sku}`}
                  task={t}
                  onDone={() => setDone((s) => new Set(s).add(`${t.product.sku}:${t.product.qty}`))}
                />
              ))}
            </div>
          </>
        )}

        <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} stroke={2.4} />Agregar a la reserva
        </button>

        <h2 className="h-sec">Lo que hay guardado</h2>
        <div className="list">
          {!items ? (
            [0, 1].map((i) => <div key={i} className="skeleton" />)
          ) : items.length ? (
            items.map((item) => (
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
