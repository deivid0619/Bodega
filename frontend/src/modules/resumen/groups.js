// El Resumen agrupado para que se lea rapido: los movimientos seguidos de una
// misma referencia (una remision, una tanda de escaneo) en una sola fila con
// sus tallas, y lo que hay que reponer por referencia.
import { refKey, sizeRank } from '../../core/utils'

const WINDOW = 15 * 60 * 1000 // lo de una misma tanda
const kindOf = (t) => (t === 'new' ? 'in' : t) // registrar una prenda nueva tambien es una entrada
const dayOf = (iso) => new Date(iso).toDateString()

// moves: lo que llega del servidor; se ordena del mas nuevo al mas viejo
// por la hora en que se hizo
export function groupMoves(moves) {
  const out = []
  const sorted = [...(moves || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  for (const m of sorted) {
    const g = out[out.length - 1]
    const t = new Date(m.created_at).getTime()
    const same = g && g.type === kindOf(m.type) && g.name === m.product_name && g.user === m.user_name
      && (g.note || '') === (m.note || '') && g.day === dayOf(m.created_at) && g.oldest - t <= WINDOW
    if (same) {
      g.items.push(m)
      g.oldest = t
    } else {
      out.push({ key: `g${m.id}`, type: kindOf(m.type), name: m.product_name, user: m.user_name, note: m.note,
                 day: dayOf(m.created_at), at: m.created_at, oldest: t, items: [m] })
    }
  }
  for (const g of out) {
    // cada talla una vez: se suma (en un conteo queda el ultimo numero)
    const sizes = new Map()
    for (const m of [...g.items].reverse()) {
      const k = m.product_size || 'Única'
      const s = sizes.get(k) || { size: k, qty: 0, after: m.after }
      s.qty += m.qty
      s.after = m.after
      sizes.set(k, s)
    }
    g.sizes = [...sizes.values()].sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
    g.qty = g.items.reduce((t, m) => t + m.qty, 0)
    g.locs = [...new Set(g.items.map((m) => (m.type === 'move' ? `${m.location_id} → ${m.to_location_id}` : m.location_id)))]
  }
  return out
}

// needs: las tallas por reponer, de la mas urgente a la menos (del servidor).
// Cada referencia con sus tallas: cuanto pedir y cuanto traer de la reserva.
export function groupNeeds(needs) {
  const by = new Map()
  for (const n of needs || []) {
    const p = n.product
    const k = refKey(p.name)
    const want = Math.max(0, p.min_qty * 2 - p.qty) // hasta el doble del minimo
    const bring = Math.min(n.in_reserve, want)
    const g = by.get(k) || { key: k, name: p.name, sizes: [], order: 0, bring: 0, out: 0 }
    g.sizes.push({ sku: p.sku, size: p.size || 'Única', qty: p.qty, min: p.min_qty, order: n.order_qty, bring, out: p.qty <= 0 })
    g.order += n.order_qty
    g.bring += bring
    g.out += p.qty <= 0 ? 1 : 0
    by.set(k, g)
  }
  for (const g of by.values()) g.sizes.sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
  return [...by.values()]
}
