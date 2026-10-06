import { useState } from 'react'
import { api, ApiError } from '../api'
import { refreshInventory, revalidate, usePolling } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { Empty, Stepper, plural } from './Bits'
import ParcelSheet, { ParcelsDoneSheet, markDone, parcelIcon, parcelName, waited } from './ParcelSheet'

// Una caja, canasta... anotada de paso: de quien es, que hacer y cuanto lleva.
export function ParcelRow({ p, onOpen, onDone }) {
  const w = waited(p.created_at)
  return (
    <div className="need parcel">
      <button type="button" className="parcel-main" onClick={onOpen}>
        <span className="parcel-ico"><Icon name={parcelIcon(p)} size={20} /></span>
        <span className="need-t">
          <b>{parcelName(p)}{p.owner ? ` · ${p.owner}` : ''}</b>
          {p.notes && <small className="note wrap">{p.notes}</small>}
          <small>{p.location_name || p.location_id} · <span className={w.late ? 'late' : ''}>{w.text}</span></small>
        </span>
      </button>
      <button type="button" className="btn btn-ink btn-sm parcel-out" onClick={onDone}>Ya salió</button>
    </div>
  )
}

// Despachar: lo que estaba de paso salio empacado. Se elige cuantas de cada
// una (todas, de entrada) y se descuentan juntas del inventario.
function DispatchForm({ passing }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [qty, setQty] = useState(() => Object.fromEntries(passing.map((d) => [d.product.sku, d.qty])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lines = passing.filter((d) => qty[d.product.sku] > 0)
  const units = lines.reduce((t, d) => t + qty[d.product.sku], 0)
  const set = (sku, n) => setQty((q) => ({ ...q, [sku]: n }))

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/api/reports/dispatch/out', {
        lines: lines.map((d) => ({ sku: d.product.sku, qty: qty[d.product.sku] })), note: note.trim() || undefined,
      })
      showToast(`Despachadas: ${plural(res.units, 'prenda', 'prendas')}. Ya no están en el inventario.`)
      refreshInventory()
      revalidate('/api/reports/dispatch')
      close()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo despachar. Intenta otra vez.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-out">Despacho</span></div>}
        title="Despachar"
        subtitle="Lo que ya salió empacado: se descuenta del inventario. Deja en 0 lo que todavía no sale."
      />
      <div className="card panel">
        {passing.map((d) => {
          const n = qty[d.product.sku]
          return (
            <div className={`need dispatch-row ${n ? '' : 'off'}`} key={d.product.sku}>
              <div className="need-t">
                <b>{d.product.name}{d.product.size ? ` · ${d.product.size}` : ''}</b>
                <small><span className="mono">{d.product.sku}</span> · {d.qty} de paso</small>
              </div>
              <Stepper value={n} small disabledMinus={!n} onMinus={() => set(d.product.sku, n - 1)}
                       onPlus={() => set(d.product.sku, Math.min(d.qty, n + 1))}
                       minusLabel={`Una menos de ${d.product.name}`} plusLabel={`Una más de ${d.product.name}`} />
            </div>
          )
        })}
      </div>
      <label className="field">
        <span className="field-label">Nota (opcional)</span>
        <input className="input" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="Ej. pedido de Juan, guía 1234" />
        <span className="field-hint">Queda en el historial de movimientos.</span>
      </label>
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="button" className="btn btn-ink btn-lg btn-block" style={{ marginTop: 14 }} disabled={!units || busy} onClick={send}>
        <Icon name="boxOut" size={20} />{busy ? 'Despachando…' : units ? `Despachar ${plural(units, 'prenda', 'prendas')}` : 'Elige qué salió'}
      </button>
    </>
  )
}

// Devolver a la reserva lo que esta en Despacho: lo que se llevo de mas o
// lo que al final no sale. Sale de Despacho y se suma a la reserva.
function ReturnForm({ d }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [qty, setQty] = useState(d.qty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const item = await api.post('/api/reserve/return', { sku: d.product.sku, qty })
      showToast(`${plural(qty, 'devuelta', 'devueltas')} a la reserva: ${d.product.name}${d.product.size ? ` ${d.product.size}` : ''} (allá hay ${item.qty})`)
      refreshInventory()
      revalidate('/api/reports/dispatch')
      close()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo devolver. Intenta otra vez.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Despacho → Reserva</span></div>}
        title="Devolver a la reserva"
        subtitle={`${d.product.name}${d.product.size ? ` · ${d.product.size}` : ''} · hay ${d.qty} en Despacho. Para lo que se llevó de más o lo que al final no sale.`}
      />
      <div className="card scan-qty">
        <div><b>Cuántas vuelven</b><small>Salen de Despacho y se suman a la reserva</small></div>
        <Stepper value={qty} large disabledMinus={qty <= 1} onMinus={() => setQty((n) => Math.max(1, n - 1))}
                 onPlus={() => setQty((n) => Math.min(d.qty, n + 1))} minusLabel="Una menos" plusLabel="Una más" />
      </div>
      {error && <p className="form-err" role="alert">{error}</p>}
      <button type="button" className="btn btn-lime btn-lg btn-block" style={{ marginTop: 14 }} disabled={busy} onClick={send}>
        <Icon name="reserve" size={20} />{busy ? 'Devolviendo…' : `Devolver ${plural(qty, 'prenda', 'prendas')}`}
      </button>
    </>
  )
}

// "Por despachar" del Resumen: lo que esta de paso esperando salir. Primero
// lo anotado (cajas, canastas...) y despues las prendas con codigo que
// entraron de paso con una remision, con la nota de esa remision.
export default function PassingSection() {
  const showToast = useToast()
  const { data: parcels } = usePolling('/api/parcels', { interval: 15000 })
  const { data: passing } = usePolling('/api/reports/dispatch', { interval: 20000 })
  const [open, setOpen] = useState(null) // 'new' o lo anotado que se esta viendo
  const [doneList, setDoneList] = useState(false)
  const [sending, setSending] = useState(false)
  const [returning, setReturning] = useState(null) // la prenda que vuelve a la reserva
  const units = (passing || []).reduce((s, d) => s + d.qty, 0)
  const count = [parcels?.length && plural(parcels.length, 'bulto', 'bultos'), units && plural(units, 'prenda', 'prendas')]
    .filter(Boolean).join(' · ')
  const add = <button className="btn btn-lime" onClick={() => setOpen('new')}><Icon name="plus" size={18} stroke={2.4} />Anotar algo de paso</button>

  return (
    <>
      <h2 className="h-sec" id="despacho">Por despachar {count && <small>{count}</small>}</h2>
      {!parcels || !passing ? (
        <div className="skeleton" />
      ) : !parcels.length && !passing.length ? (
        <Empty icon="boxOut" title="Nada esperando salir" action={add}>
          Cajas sueltas, canastas o lo que entre aparte: anótalo con de quién es y qué hacer.
        </Empty>
      ) : (
        <>
          <div className="card panel">
            {parcels.map((p) => <ParcelRow key={p.id} p={p} onOpen={() => setOpen(p)} onDone={() => markDone(p, showToast)} />)}
            {passing.map((d) => {
              const w = d.since ? waited(d.since) : null
              const doc = d.doc_number && (d.doc_number.startsWith('SN-') ? 'remisión sin número' : `remisión ${d.doc_number}`)
              return (
                <div className="need" key={d.product.sku}>
                  <div className="need-t">
                    <b>{d.product.name}{d.product.size ? ` · ${d.product.size}` : ''}</b>
                    {d.doc_notes && <small className="note wrap">{d.doc_notes}</small>}
                    <small>
                      <span className="mono">{d.product.sku}</span>
                      {w && <> · <span className={w.late ? 'late' : ''}>{w.text}</span></>}
                      {doc && ` con la ${doc}`}{d.doc_supplier ? ` · ${d.doc_supplier}` : ''}
                    </small>
                    <button type="button" className="link-btn return-link" onClick={() => setReturning(d)}>
                      <Icon name="reserve" size={14} stroke={2.2} />Devolver a la reserva
                    </button>
                  </div>
                  <div className="need-q idle"><b>{d.qty}</b><span>de paso</span></div>
                </div>
              )
            })}
          </div>
          <div className="btn-row">
            {passing.length > 0 && (
              <button className="btn btn-ink" onClick={() => setSending(true)}><Icon name="boxOut" size={18} />Despachar</button>
            )}
            {add}
          </div>
        </>
      )}
      <button type="button" className="link-btn see-all" onClick={() => setDoneList(true)}>
        Ver lo que ya salió<Icon name="arrowRight" size={14} stroke={2.4} />
      </button>
      {open && <ParcelSheet parcel={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      {doneList && <ParcelsDoneSheet onClose={() => setDoneList(false)} />}
      {returning && (
        <Sheet modal onClose={() => setReturning(null)} label="Devolver a la reserva">
          <ReturnForm d={returning} />
        </Sheet>
      )}
      {sending && passing?.length > 0 && (
        <Sheet modal onClose={() => setSending(false)} label="Despachar">
          <DispatchForm passing={passing} />
        </Sheet>
      )}
    </>
  )
}
