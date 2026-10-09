// Una orden de remision con todas sus entregas (OPR77, OPR77#2...): que
// llego de cada referencia y talla (sumado), que sigue faltando y donde quedo.
// Para el PDF de la remision. Sin pantalla: se puede llevar a otra app.
import { sizeRank } from '../../core/utils'

// a donde quedo una linea que llego
function placeOf(line, record, locName) {
  if (record) return 'Solo registro'
  if (line.dest === 'reserva') return 'Reserva'
  if (line.dest === 'despacho') return 'De paso'
  return locName(line.location_id) || line.location_id || 'Bodega'
}

// el numero de la orden: OPR77#2 -> OPR77 (sin numero: cada una es su propia orden)
export const orderBase = (number) => (String(number || '').startsWith('SN-') ? number : String(number || '').split('#')[0])

// deliveries: las remisiones de la orden (en cualquier orden).
// Lo que falta de una talla es lo que dijo la ultima entrega que la nombra.
export function orderSummary(deliveries, locName = (id) => id) {
  const docs = [...(deliveries || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const refs = new Map() // nombre -> Map(talla -> fila)
  for (const d of docs) {
    const record = d.mode === 'registro'
    const named = new Set() // tallas que nombra esta entrega
    for (const l of d.lines || []) {
      const name = l.name || l.sku || 'Sin referencia'
      const size = l.size || ''
      if (!refs.has(name)) refs.set(name, new Map())
      const sizes = refs.get(name)
      const row = sizes.get(size) || { size, sku: null, arrived: 0, pending: 0, places: new Set() }
      row.sku = row.sku || l.sku || null
      row.arrived += l.qty || 0
      if (l.qty > 0) row.places.add(placeOf(l, record, locName))
      if (!named.has(size)) {
        named.add(size)
        row.pending = 0 // la entrega mas nueva dice cuanto sigue faltando
      }
      row.pending += l.pending || 0
      sizes.set(size, row)
    }
  }
  const list = [...refs].map(([name, sizes]) => {
    const rows = [...sizes.values()]
      .sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
      .map((r) => ({ size: r.size, sku: r.sku, arrived: r.arrived, pending: r.pending, where: [...r.places].join(', ') }))
    return { name, rows, arrived: rows.reduce((t, r) => t + r.arrived, 0), pending: rows.reduce((t, r) => t + r.pending, 0) }
  })
  return {
    refs: list,
    arrived: list.reduce((t, r) => t + r.arrived, 0),
    pending: list.reduce((t, r) => t + r.pending, 0),
    deliveries: docs.map((d) => ({ number: d.number, date: d.doc_date || d.created_at, units: d.units, pending: d.pending || 0, record: d.mode === 'registro' })),
    supplier: docs.map((d) => d.supplier).find(Boolean) || '',
    notes: docs.map((d) => d.notes).filter(Boolean),
  }
}
