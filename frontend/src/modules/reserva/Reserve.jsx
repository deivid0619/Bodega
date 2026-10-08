import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../core/api'
import { mutate, refreshInventory, revalidate, setReserveQty, useLayout, usePolling, useReserve, useRestock } from '../../core/useApi'
import { useToast } from '../../ui/ToastContext'
import { useConfirm } from '../../ui/ConfirmContext'
import { locationGroups } from '../../core/locationGroups'
import NewReserveModal from './NewReserveModal'
import ReserveTransferModal from './ReserveTransferModal'
import Icon from '../../ui/Icon'
import { Count, Empty, PageHead, ProductThumb, Stepper, plural } from '../../ui/Bits'

// Una talla agotada o en su minimo en la bodega que tiene prendas en la
// reserva: se lleva con un toque a su ubicacion principal.
function RestockCard({ task, onDone }) {
  const showToast = useToast()
  const confirm = useConfirm()
  const { product: p, reserve: r } = task
  const [qty, setQty] = useState(task.suggest)
  const [busy, setBusy] = useState(false)

  const bring = async () => {
    // se confirma antes: un toque sin querer no mueve nada
    if (!(await confirm({
      title: `¿Llevar ${plural(qty, 'prenda', 'prendas')} a ${p.location_id}?`,
      body: `${p.name}${p.size ? ` · talla ${p.size}` : ''}: salen de la reserva (quedan ${r.qty - qty}) y entran a la bodega en ${p.location_name || p.location_id}.`,
      confirmLabel: 'Sí, llevar',
      danger: false,
    }))) return
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
  // lo que se mando a Despacho y espera salir: se ve aqui mismo, no solo en Resumen
  const { data: passing } = usePolling('/api/reports/dispatch', { interval: 20000 })
  const passingUnits = (passing || []).reduce((t, d) => t + d.qty, 0)
  const { data: layout } = useLayout()
  const showToast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const total = useMemo(() => (items || []).reduce((s, i) => s + i.qty, 0), [items])
  // la que ya se llevo desaparece al instante, sin esperar el siguiente sondeo
  const tasks = (restock || []).filter((t) => !done.has(`${t.product.sku}:${t.product.qty}`))

  const zeros = (items || []).filter((i) => i.qty <= 0)

  // quitar una de la lista (con Deshacer, por si fue sin querer)
  const remove = async (item) => {
    const ok = await confirm({
      title: `¿Quitar ${item.name}${item.size ? ` ${item.size}` : ''} de la reserva?`,
      body: item.qty > 0
        ? `Se ${item.qty === 1 ? 'quita la prenda guardada' : `quitan las ${item.qty} prendas guardadas`} de esta referencia.`
        : 'Está en 0: solo se quita de la lista.',
      confirmLabel: 'Sí, quitar',
    })
    if (!ok) return
    mutate('/api/reserve', (list) => list.filter((i) => i.id !== item.id))
    try {
      await api.delete(`/api/reserve/${item.id}`)
      showToast(`Quitada de la reserva: ${item.name}${item.size ? ` ${item.size}` : ''}`, 'ok', {
        label: 'Deshacer',
        onClick: async () => {
          try {
            await api.post('/api/reserve', { sku: item.sku || undefined, name: item.name, size: item.size, qty: item.qty, image_url: item.image_url || undefined })
          } catch (e) {
            showToast(e instanceof ApiError ? e.message : 'No se pudo deshacer.', 'err')
          }
          refreshInventory()
        },
      })
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo quitar.', 'err')
    }
    revalidate('/api/reserve')
  }

  // las que se acabaron (en 0), todas de una vez
  const cleanZeros = async () => {
    const names = zeros.slice(0, 4).map((z) => `${z.name}${z.size ? ` ${z.size}` : ''}`).join(', ')
    const ok = await confirm({
      title: `¿Quitar las ${zeros.length} agotadas?`,
      body: `Están en 0: ${names}${zeros.length > 4 ? '…' : ''}.`,
      confirmLabel: 'Sí, quitarlas',
    })
    if (!ok) return
    // (en /api/reserve/restock cada fila trae su reserva: esas no se tocan)
    mutate('/api/reserve', (list) => list.filter((i) => i.reserve || i.qty > 0))
    try {
      const { removed } = await api.post('/api/reserve/clean')
      showToast(`${plural(removed, 'agotada quitada', 'agotadas quitadas')} de la reserva`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudieron quitar.', 'err')
    }
    revalidate('/api/reserve')
  }

  const bump = async (item, delta) => {
    const next = item.qty + delta
    if (next < 0) return
    try {
      await setReserveQty(item, next)
      // se acabo: se ofrece quitarla de la lista
      if (next === 0) {
        showToast(`${item.name}${item.size ? ` ${item.size}` : ''} quedó en 0`, 'ok', { label: 'Quitarla', onClick: () => remove({ ...item, qty: 0 }) })
      }
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

        {/* como una entrada: se escanea y la prenda se identifica sola */}
        <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => navigate('/scan?modo=reserva')}>
          <Icon name="scan" size={20} stroke={2.2} />Escanear para la reserva
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} stroke={2.4} />Agregar a mano (sin etiqueta)
        </button>

        {passingUnits > 0 && (
          <button type="button" className="res-passing" onClick={() => navigate('/summary#despacho')}>
            <Icon name="boxOut" size={20} />
            <span>
              <b>{plural(passingUnits, 'prenda', 'prendas')} en Despacho esperando salir</b>
              <small>Cuando salgan, despáchalas en Resumen › Por despachar (o devuélvelas a la reserva)</small>
            </span>
            <Icon name="arrowRight" size={18} />
          </button>
        )}

        <h2 className="h-sec">Lo que hay guardado</h2>
        {zeros.length > 1 && (
          <div className="res-zeros">
            <span>{plural(zeros.length, 'referencia se acabó', 'referencias se acabaron')} (en 0)</span>
            <button type="button" className="btn btn-ink btn-sm" onClick={cleanZeros}>
              <Icon name="trash" size={16} stroke={2} />Quitar las agotadas
            </button>
          </div>
        )}
        <div className="list">
          {!items ? (
            [0, 1].map((i) => <div key={i} className="skeleton" />)
          ) : items.length ? (
            items.map((item) => (
              <article className={`card res-card ${item.qty <= 0 ? 'empty' : ''}`} key={item.id}>
                <ProductThumb size="sm" src={item.image_url} alt={item.name} />
                <div style={{ minWidth: 0 }}>
                  <h3 className="res-name">{item.name}</h3>
                  <div className="res-meta">
                    <span className="tag tag-out">{item.size || 'Única'}</span>
                    {item.sku ? <span className="code">{item.sku}</span> : <span className="tag tag-warn">Sin código</span>}
                    {item.qty <= 0 && <span className="tag tag-warn">Se acabó</span>}
                  </div>
                </div>
                <button type="button" className="res-del" onClick={() => remove(item)} aria-label={`Quitar ${item.name} de la reserva`}>
                  <Icon name="trash" size={18} stroke={1.9} />
                </button>
                <div className="res-actions">
                  <Stepper value={item.qty} onMinus={() => bump(item, -1)} onPlus={() => bump(item, 1)} disabledMinus={item.qty === 0} />
                  {item.qty > 0 ? (
                    <button className="btn btn-ink btn-sm" onClick={() => setSending(item)}>
                      Sacar<Icon name="arrowRight" size={17} stroke={2.2} />
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(item)}>
                      <Icon name="trash" size={16} stroke={2} />Quitar de la reserva
                    </button>
                  )}
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
