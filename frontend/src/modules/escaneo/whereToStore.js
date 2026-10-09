// Al entrar una prenda: donde hay de esa talla (y cuantas) y donde conviene
// guardarla. Primero donde ya hay mas de esa talla; si no hay en ningun lado,
// donde estan las otras tallas de la referencia; si tampoco, su ubicacion
// principal. Sin Despacho (de paso) ni el outlet. Sin pantalla.
import { refKey } from '../../core/utils'

const DISPATCH = 'DESPACHO'
const usable = (s, outlet) => s.qty > 0 && s.location_id !== DISPATCH && !outlet?.has(s.location_id)

// p: la prenda (con stock y location_id); products: todas (para las otras tallas)
export function whereToStore(p, products, outlet) {
  const here = (p?.stock || []).filter((s) => usable(s, outlet))
    .map((s) => ({ id: s.location_id, name: s.location_name || s.location_id, qty: s.qty }))
    .sort((a, b) => b.qty - a.qty || (a.id === p.location_id ? -1 : b.id === p.location_id ? 1 : 0))
  if (here.length) {
    const top = here[0]
    return { here, best: { id: top.id, name: top.name, why: `ahí hay ${top.qty} de esta talla` } }
  }
  const key = refKey(p?.name)
  const by = new Map()
  for (const q of products || []) {
    if (q.sku === p.sku || refKey(q.name) !== key) continue
    for (const s of q.stock || []) {
      if (!usable(s, outlet)) continue
      const e = by.get(s.location_id) || { id: s.location_id, name: s.location_name || s.location_id, qty: 0 }
      e.qty += s.qty
      by.set(s.location_id, e)
    }
  }
  const others = [...by.values()].sort((a, b) => b.qty - a.qty)
  if (others.length) return { here, best: { id: others[0].id, name: others[0].name, why: `ahí están las otras tallas (${others[0].qty})` } }
  return { here, best: p?.location_id && p.location_id !== DISPATCH ? { id: p.location_id, name: p.location_name || p.location_id, why: 'su ubicación principal' } : null }
}
