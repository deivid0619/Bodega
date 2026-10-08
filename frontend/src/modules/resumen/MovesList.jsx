import { useState } from 'react'
import Icon from '../../ui/Icon'
import { fmtTime, sizeRank } from '../../core/utils'
import { groupMoves } from './groups'

// Los movimientos agrupados: una fila por referencia y tanda (una remision,
// una pasada escaneando), con sus tallas, separados por dia. Tocar una fila
// con varias tallas las despliega; cada una abre su detalle.

const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', move: 'Traslado' }
const sign = (type, n) => (type === 'out' ? `−${n}` : type === 'move' ? `↔${n}` : `+${n}`)
const one = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const kind = (t) => (t === 'move' ? 't-move' : t) // la clase del color
const sizeQty = (g, s) => (g.type === 'set' ? `=${s.after}` : sign(g.type, s.qty))

function dayTitle(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer'
  const t = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// el ultimo movimiento (con el panel plegado), ya agrupado
export function lastGroupText(moves) {
  const g = groupMoves(moves)[0]
  if (!g) return null
  return {
    what: `${g.type === 'set' ? 'Conteo' : sign(g.type, g.qty)} ${g.name}`,
    sizes: `${g.sizes.length === 1 ? 'talla' : 'tallas'} ${g.sizes.map((s) => s.size).join(', ')}`,
    meta: `${g.user} · ${fmtTime(g.at)}`,
  }
}

export default function MovesList({ moves, onOpen }) {
  const groups = groupMoves(moves)
  const [shown, setShown] = useState(10)
  const [open, setOpen] = useState(() => new Set())
  const toggle = (key) => setOpen((s) => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const rows = []
  let day = null
  for (const g of groups.slice(0, shown)) {
    if (g.day !== day) {
      day = g.day
      rows.push(<li key={`d-${g.key}`} className="move-day" aria-hidden="true">{dayTitle(g.at)}</li>)
    }
    const many = g.items.length > 1
    const isOpen = open.has(g.key)
    const head = g.type === 'set' && many ? '=' : many ? sign(g.type, g.qty) : one(g.items[0])
    rows.push(
      <li key={g.key} className={`move ${kind(g.type)} openable group${isOpen ? ' open' : ''}`} role="button" tabIndex={0}
          aria-expanded={many ? isOpen : undefined}
          aria-label={many ? `${g.name}: ${g.sizes.length} tallas. Ver cada una` : `Ver el detalle: ${g.name}`}
          onClick={() => (many ? toggle(g.key) : onOpen(g.items[0]))}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), many ? toggle(g.key) : onOpen(g.items[0]))}>
        <div className="move-q">{head}</div>
        <div className="move-t">
          <b>{g.name}</b>
          <span className="move-sizes">
            {g.sizes.map((s) => <span key={s.size} className="msz">{s.size}<i>{sizeQty(g, s)}</i></span>)}
          </span>
          <small>{g.note || LABEL[g.type] || g.type} · {g.locs.slice(0, 2).join(', ')}{g.locs.length > 2 ? '…' : ''} · {g.user}</small>
        </div>
        <time dateTime={g.at} title={new Date(g.at).toLocaleString('es-CO')}>
          {fmtTime(g.at)}
          {many && <Icon name="arrowRight" size={14} stroke={2.4} className="move-chev" />}
        </time>
      </li>,
    )
    if (many && isOpen) {
      for (const m of [...g.items].sort((a, b) => sizeRank(a.product_size) - sizeRank(b.product_size))) { // S, M, L...
        rows.push(
          <li key={m.id} className={`move ${kind(m.type)} openable sub`} role="button" tabIndex={0} aria-label={`Ver el detalle: talla ${m.product_size || 'única'}`}
              onClick={() => onOpen(m)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(m))}>
            <div className="move-q">{one(m)}</div>
            <div className="move-t">
              <b>Talla {m.product_size || 'única'}</b>
              <small>{m.type === 'move' ? `${m.location_id} → ${m.to_location_id}` : m.location_id} · quedaron {m.after}</small>
            </div>
            <time dateTime={m.created_at}>{fmtTime(m.created_at)}</time>
          </li>,
        )
      }
    }
  }
  return (
    <>
      <ul className="moves card panel" style={{ marginTop: 8 }}>{rows}</ul>
      {groups.length > shown && (
        <button type="button" className="link-btn see-all" onClick={() => setShown((n) => n + 10)}>
          Ver más ({groups.length - shown})<Icon name="arrowRight" size={14} stroke={2.4} />
        </button>
      )}
    </>
  )
}
