import { describe, expect, it } from 'vitest'
import { groupMoves, groupNeeds } from './groups'

const mv = (id, type, size, qty, min, extra = {}) => ({
  id, type, qty, product_name: 'CHAQUETA TOURING GRIS', product_size: size, user_name: 'Ana', note: 'Remisión OPR1',
  location_id: 'P-A2', after: 10, created_at: new Date(2026, 9, 7, 10, min).toISOString(), ...extra,
})

describe('movimientos agrupados por referencia y talla', () => {
  it('una remision con varias tallas queda en una sola fila, tallas en orden y sumadas', () => {
    const g = groupMoves([mv(5, 'in', 'L', 1, 4), mv(4, 'in', 'S', 2, 3), mv(3, 'new', 'M', 3, 2), mv(2, 'in', 'S', 1, 1)])
    expect(g).toHaveLength(1)
    expect(g[0].qty).toBe(7)
    expect(g[0].sizes.map((s) => [s.size, s.qty])).toEqual([['S', 3], ['M', 3], ['L', 1]])
  })

  it('otra persona, otro tipo, otra nota u otra referencia es otra fila', () => {
    const g = groupMoves([
      mv(6, 'out', 'M', 1, 6), mv(5, 'in', 'M', 1, 5, { user_name: 'Luis' }), mv(4, 'in', 'M', 1, 4),
      mv(3, 'in', 'M', 1, 3, { note: 'Remisión OPR2' }), mv(2, 'in', 'M', 1, 2, { product_name: 'GUANTES' }),
    ])
    expect(g).toHaveLength(5)
  })

  it('lo de la misma referencia con mas de 15 minutos de diferencia es otra tanda', () => {
    expect(groupMoves([mv(2, 'in', 'M', 1, 40), mv(1, 'in', 'M', 1, 10)])).toHaveLength(2)
  })
})

describe('por reponer, por referencia', () => {
  const need = (sku, size, qty, min, order, inReserve, name = 'CHAQUETA TOURING GRIS') => ({
    product: { sku, name, size, qty, min_qty: min }, order_qty: order, in_reserve: inReserve,
  })
  it('junta las tallas de una referencia con cuanto pedir y cuanto traer', () => {
    const g = groupNeeds([need('A-L', 'L', 0, 2, 4, 0), need('B-M', 'M', 1, 3, 5, 0, 'GUANTES'), need('A-S', 'S', 1, 2, 0, 5)])
    expect(g.map((x) => x.name)).toEqual(['CHAQUETA TOURING GRIS', 'GUANTES']) // en el orden de urgencia
    const ch = g[0]
    expect(ch.sizes.map((s) => s.size)).toEqual(['S', 'L'])
    expect([ch.order, ch.bring, ch.out]).toEqual([4, 3, 1]) // S: traer hasta el doble del minimo (4 - 1)
  })
})

describe('orden', () => {
  it('los grupos van del mas nuevo al mas viejo aunque lleguen desordenados', () => {
    const a = { id: 1, type: 'in', qty: 1, product_name: 'A', product_size: 'M', user_name: 'Ana', location_id: 'X', after: 1, created_at: '2026-10-06T15:00:00Z' }
    const b = { ...a, id: 2, product_name: 'B', created_at: '2026-09-27T15:00:00Z' }
    const c = { ...a, id: 3, product_name: 'C', created_at: '2026-10-07T15:00:00Z' }
    expect(groupMoves([b, a, c]).map((g) => g.name)).toEqual(['C', 'A', 'B'])
  })
})
