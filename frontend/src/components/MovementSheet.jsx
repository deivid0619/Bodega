import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import Sheet, { SheetHeader } from './Sheet'
import DocumentSheet from './DocumentSheet'
import Icon from './Icon'
import { plural } from './Bits'

const TYPE = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado' }
const DISPATCH = 'DESPACHO'
const FROM_RESERVE = 'Desde la reserva'
const TO_RESERVE = 'A la reserva'
const sign = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
// el codigo aparte solo si el nombre no lo dice ya ("Canasta C-1-2" ya lo trae)
const code = (id, name) => (id && id !== DISPATCH && !(name || '').includes(id) ? <span className="mono">{id}</span> : null)
const place = (id, name) => (id === DISPATCH ? 'Despacho (de paso)' : name && name !== id ? `${name}` : id)

// Lo que dice la nota, en palabras: de donde vino, a donde fue y con que
// documento. pair: el otro movimiento de un despacho directo desde la reserva
// (pasa por Despacho para quedar en el historial con su codigo).
function explain(m, pair) {
  const note = m.note || ''
  const where = place(m.location_id, m.location_name)
  if (note.startsWith('Despacho')) {
    return {
      title: pair ? 'Se despachó directo desde la reserva' : 'Se despachó',
      text: pair ? 'Salió empacado de la reserva, sin quedar en ninguna canasta.' : `Salió empacado de ${where}.`,
      detail: note.includes(':') ? note.slice(note.indexOf(':') + 1).trim() : null,
    }
  }
  if (note === FROM_RESERVE) {
    return m.location_id === DISPATCH && pair
      ? { title: 'Salió de la reserva para despacharse', text: 'Pasó por Despacho solo para quedar en el historial: en seguida se despachó.' }
      : { title: 'Vino de la reserva', text: `Quedó en ${where}.` }
  }
  if (note === TO_RESERVE) return { title: 'Volvió a la reserva', text: `Salió de ${where} y se sumó a la reserva.` }
  if (note.startsWith('Factura ')) return { title: `Se descontó con la factura ${note.slice(8)}`, text: `Salió de ${where}.`, doc: ['factura', note.slice(8)] }
  if (note.startsWith('Remisión ')) {
    const n = note.slice(9)
    return { title: n.startsWith('SN-') ? 'Entró con una remisión sin número' : `Entró con la remisión ${n}`, text: `Quedó en ${where}.`, doc: ['remision', n] }
  }
  if (note.startsWith('Conteo ')) return { title: `Conteo de ${note.slice(7)}`, text: `Al contar quedaron ${m.after} en total.` }
  if (m.type === 'move') return { title: 'Se movió de lugar', text: `De ${where} a ${place(m.to_location_id, m.to_location_name)}.` }
  if (m.type === 'new') return { title: 'Se registró en la bodega', text: `Quedó en ${where}.` }
  if (m.type === 'set') return { title: 'Se contó', text: `En ${where} quedó el número contado.` }
  if (m.type === 'in') return { title: 'Entró a la bodega', text: `Quedó en ${where}.`, detail: note || null }
  return { title: 'Salió de la bodega', text: `Salió de ${where}.`, detail: note || null }
}

function Detail({ m, pair }) {
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [docOpen, setDocOpen] = useState(false)
  const e = explain(m, pair)

  // la factura o la remision con que se hizo: se puede abrir
  useEffect(() => {
    if (!e.doc) return undefined
    let alive = true
    api.get(`/api/documents?kind=${e.doc[0]}&number=${encodeURIComponent(e.doc[1])}`)
      .then((list) => { if (alive) setDoc(list[0] || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [e.doc?.[0], e.doc?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const when = new Date(m.created_at)
  return (
    <>
      <SheetHeader
        eyebrow={
          <div className="sheet-eyebrow">
            <span className={`tag ${m.type === 'out' ? 'tag-out' : 'tag-in'}`}>{TYPE[m.type] || m.type}</span>
            <span className={`move-badge ${m.type}`}>{sign(m)}</span>
          </div>
        }
        title={`${m.product_name}${m.product_size ? ` · ${m.product_size}` : ''}`}
        subtitle={<span className="mono">{m.sku}</span>}
      />
      <div className="mv-what">
        <b>{e.title}</b>
        <span>{e.text}</span>
        {e.detail && <p className="mv-note">“{e.detail}”</p>}
        {doc && (
          <button type="button" className="link-btn" onClick={() => setDocOpen(true)}>
            Ver la {e.doc[0] === 'factura' ? 'factura' : 'remisión'}<Icon name="arrowRight" size={14} stroke={2.4} />
          </button>
        )}
      </div>
      <dl className="mv-facts">
        <div>
          <dt>{m.type === 'move' ? 'De' : m.type === 'out' ? 'Salió de' : 'En'}</dt>
          <dd>{place(m.location_id, m.location_name)} {code(m.location_id, m.location_name)}</dd>
        </div>
        {m.type === 'move' && (
          <div><dt>A</dt><dd>{place(m.to_location_id, m.to_location_name)} {code(m.to_location_id, m.to_location_name)}</dd></div>
        )}
        <div><dt>Cantidad</dt><dd>{m.type === 'set' ? `Quedaron ${m.after}` : plural(m.qty, 'prenda', 'prendas')}</dd></div>
        <div><dt>Total del código</dt><dd>Había {m.before} · quedaron {m.after}</dd></div>
        <div><dt>Quién</dt><dd>{m.user_name || '—'}</dd></div>
        <div><dt>Cuándo</dt><dd>{when.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} · {when.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</dd></div>
      </dl>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(`/?sku=${encodeURIComponent(m.sku)}`)}>
          <Icon name="warehouse" size={18} />Dónde está ahora
        </button>
        {m.location_id !== DISPATCH && m.type !== 'out' && (
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/?loc=${encodeURIComponent(m.type === 'move' ? m.to_location_id : m.location_id)}`)}>
            <Icon name="pin" size={18} />Ver el lugar
          </button>
        )}
      </div>
      {docOpen && doc && <DocumentSheet doc={doc} onClose={() => setDocOpen(false)} />}
    </>
  )
}

export default function MovementSheet({ movement, pair, onClose }) {
  return (
    <Sheet modal onClose={onClose} label="Detalle del movimiento">
      <Detail m={movement} pair={pair} />
    </Sheet>
  )
}

// el otro movimiento de un despacho directo desde la reserva: entra a
// Despacho "Desde la reserva" y sale "Despacho" casi al mismo tiempo
export function pairOf(m, list) {
  const t = new Date(m.created_at).getTime()
  return (list || []).find((x) => x.id !== m.id && x.sku === m.sku && x.location_id === DISPATCH && m.location_id === DISPATCH
    && Math.abs(new Date(x.created_at).getTime() - t) < 10_000
    && ((m.note === FROM_RESERVE && (x.note || '').startsWith('Despacho')) || ((m.note || '').startsWith('Despacho') && x.note === FROM_RESERVE))) || null
}
