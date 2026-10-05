import { useState } from 'react'
import { usePolling } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Icon from './Icon'
import { Empty, plural } from './Bits'
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

// "Por despachar" del Resumen: lo que esta de paso esperando salir. Primero
// lo anotado (cajas, canastas...) y despues las prendas con codigo que
// entraron de paso con una remision, con la nota de esa remision.
export default function PassingSection() {
  const showToast = useToast()
  const { data: parcels } = usePolling('/api/parcels', { interval: 15000 })
  const { data: passing } = usePolling('/api/reports/dispatch', { interval: 20000 })
  const [open, setOpen] = useState(null) // 'new' o lo anotado que se esta viendo
  const [doneList, setDoneList] = useState(false)
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
                  </div>
                  <div className="need-q idle"><b>{d.qty}</b><span>de paso</span></div>
                </div>
              )
            })}
          </div>
          <div className="btn-row">{add}</div>
        </>
      )}
      <button type="button" className="link-btn see-all" onClick={() => setDoneList(true)}>
        Ver lo que ya salió<Icon name="arrowRight" size={14} stroke={2.4} />
      </button>
      {open && <ParcelSheet parcel={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      {doneList && <ParcelsDoneSheet onClose={() => setDoneList(false)} />}
    </>
  )
}
