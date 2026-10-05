import { describe, expect, it } from 'vitest'
import { reserveFor, reserveIndex, stockSplit } from './utils'

// Cuanto hay de una prenda: bodega (sin lo de paso) + reserva = total.
// La reserva se cruza por codigo o, si se guardo sin codigo, por referencia
// y talla (igual que el servidor).
describe('total de una prenda: bodega + reserva', () => {
  const index = reserveIndex([
    { id: 1, sku: 'PRUEBA-S', name: 'CHAQUETA PRUEBA', size: 'S', qty: 10 },
    { id: 2, sku: null, name: 'CHAQUETA PRUEBA', size: 'M', qty: 4 },
    { id: 3, sku: null, name: 'CHAQUETA PRUEBA', size: 'L', qty: 0 },
  ])

  it('suma la reserva por codigo, o por referencia y talla si no tiene codigo', () => {
    const s = { sku: 'PRUEBA-S', name: 'CHAQUETA PRUEBA', size: 'S', qty: 3, stock: [{ location_id: 'C-1-1', qty: 3 }] }
    expect(stockSplit(s, index)).toEqual({ bodega: 3, passing: 0, reserve: 10, total: 13 })
    const m = { sku: 'PRUEBA-M', name: 'CHAQUETA PRUEBA', size: 'M', qty: 2, stock: [{ location_id: 'C-1-2', qty: 2 }] }
    expect(reserveFor(m, index).map((it) => it.id)).toEqual([2])
    expect(stockSplit(m, index).total).toBe(6)
  })

  it('lo de paso no es de la bodega ni entra al total', () => {
    const p = { sku: 'PASO', name: 'OTRA', size: '', qty: 7, stock: [{ location_id: 'C-1-1', qty: 2 }, { location_id: 'DESPACHO', qty: 5 }] }
    expect(stockSplit(p, index)).toEqual({ bodega: 2, passing: 5, reserve: 0, total: 2 })
  })

  it('lo que esta en cero en la reserva no cuenta, y sin reserva el total es la bodega', () => {
    const l = { sku: 'PRUEBA-L', name: 'CHAQUETA PRUEBA', size: 'L', qty: 1, stock: [{ location_id: 'C-1-3', qty: 1 }] }
    expect(reserveFor(l, index)).toEqual([])
    expect(stockSplit(l)).toEqual({ bodega: 1, passing: 0, reserve: 0, total: 1 })
  })
})
