// Donde guardar cada talla que llega en una remision, sin mezclar tallas en
// una canasta: donde ya hay de esa talla (la que tiene mas); si hoy no hay en
// ningun lado, su ubicacion de siempre; si es una talla nueva, con las otras
// tallas de la referencia, y se avisa que ahi se mezclan. Sin Despacho ni
// outlet. Sin pantalla.
import { refKey } from '../../core/utils'
import { whereToStore } from '../escaneo/whereToStore'

const DISPATCH = 'DESPACHO'

// p: la prenda de esa talla (o nada si es nueva); name: la referencia;
// products: todas (para las otras tallas). Devuelve { here, auto }: donde hay
// de esa talla y a donde va si no se elige otra (o null: hay que elegir).
export function sizePlace(p, name, products, outlet) {
  const ok = (id) => !!id && id !== DISPATCH && !outlet?.has(id)
  if (p) {
    const { here } = whereToStore(p, products, outlet)
    if (here.length) return { here, auto: { id: here[0].id, name: here[0].name, why: `ahí hay ${here[0].qty} de esta talla` } }
    if (ok(p.location_id)) return { here, auto: { id: p.location_id, name: p.location_name || p.location_id, why: 'su ubicación de siempre (hoy no hay)' } }
  }
  // sin lugar propio: con las otras tallas de la referencia
  const key = refKey(name)
  const by = new Map()
  for (const q of products || []) {
    if (refKey(q.name) !== key || q.sku === p?.sku) continue
    for (const s of q.stock || []) {
      if (!(s.qty > 0) || !ok(s.location_id)) continue
      const e = by.get(s.location_id) || { id: s.location_id, name: s.location_name || s.location_id, qty: 0 }
      e.qty += s.qty
      by.set(s.location_id, e)
    }
  }
  const mix = 'con las otras tallas: ahí se mezclan'
  const top = [...by.values()].sort((a, b) => b.qty - a.qty)[0]
  if (top) return { here: [], auto: { id: top.id, name: top.name, why: mix, mix: true } }
  const main = (products || []).find((q) => refKey(q.name) === key && q.sku !== p?.sku && ok(q.location_id))
  return { here: [], auto: main ? { id: main.location_id, name: main.location_name || main.location_id, why: mix, mix: true } : null }
}
