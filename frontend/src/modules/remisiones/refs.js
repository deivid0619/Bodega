// La remision por dentro: las referencias conocidas (bodega, reserva y
// tienda) y las filas de tallas de cada una. Sin pantalla: se puede llevar a
// otra app tal cual.
import { sizeRank } from '../../core/utils'

// la plantilla de remision de Pigmalion trae estas tallas
export const TEMPLATE = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']
export const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, '')
export const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// referencias conocidas: lo que hay en la bodega y en la reserva, por nombre
export function buildRefs(products, reserve) {
  const map = new Map()
  const add = (name, size, sku, qty, where, rank) => {
    if (!map.has(name)) map.set(name, { name, sizes: new Map(), bodega: 0, reserva: 0 })
    const ref = map.get(name)
    const cur = ref.sizes.get(size) || { size, sku: null, rank: -1, have: 0, bodega: 0, reserva: 0 }
    // si una talla tiene dos codigos, gana el real (no de prueba) con mas prendas
    if (sku && rank > cur.rank) {
      cur.sku = sku
      cur.rank = rank
      cur.have = where === 'bodega' ? qty : 0
    }
    cur[where] += qty
    ref[where] += qty
    ref.sizes.set(size, cur)
  }
  for (const p of products) add(p.name, p.size || '', p.sku, p.qty, 'bodega', (p.demo ? 0 : 1e6) + p.qty)
  for (const i of reserve) add(i.name, i.size || '', i.sku, i.qty, 'reserva', 0)
  return [...map.values()]
}

let nextId = 1
export const blockId = () => nextId++
export const newRow = (size, info) => ({ size, sku: info?.sku || null, have: info?.have || 0, inReserve: info?.reserva || 0, qty: 0, pending: 0, code: '' })
export const rowsOf = (ref) => (ref.isNew
  ? TEMPLATE.map((s) => newRow(s))
  : [...ref.sizes.values()].sort((a, b) => sizeRank(a.size) - sizeRank(b.size)).map((s) => newRow(s.size, s)))

// una referencia de la tienda con todas sus tallas (y lo que ya hay de cada una)
export function shopRef(g, known) {
  return {
    name: g.name,
    shop: true,
    sizes: new Map(g.sizes.map((s) => {
      const p = known.get(s.sku)
      return [s.size, { size: s.size, sku: s.sku, have: p?.qty || 0, bodega: p?.qty || 0, reserva: 0 }]
    })),
  }
}
