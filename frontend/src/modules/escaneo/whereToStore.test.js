import { describe, expect, it } from 'vitest'
import { whereToStore } from './whereToStore'

const p = (sku, size, stock, main = 'C-5-1') => ({ sku, name: 'CHAQUETA TOURING GRIS', size, location_id: main, stock })

describe('donde guardar lo que entra', () => {
  it('donde ya hay mas de esa talla (sin Despacho ni outlet)', () => {
    const m = p('T-M', 'M', [{ location_id: 'C-5-1', qty: 1 }, { location_id: 'C-4-1', qty: 3 }, { location_id: 'DESPACHO', qty: 9 }, { location_id: 'O-1', qty: 7 }])
    const w = whereToStore(m, [m], new Set(['O-1']))
    expect(w.here.map((h) => [h.id, h.qty])).toEqual([['C-4-1', 3], ['C-5-1', 1]])
    expect(w.best).toMatchObject({ id: 'C-4-1', why: 'ahí hay 3 de esta talla' })
  })
  it('empate: la principal', () => {
    const m = p('T-M', 'M', [{ location_id: 'C-4-1', qty: 2 }, { location_id: 'C-5-1', qty: 2 }])
    expect(whereToStore(m, [m]).best.id).toBe('C-5-1')
  })
  it('no hay de esa talla: donde estan las otras tallas', () => {
    const m = p('T-M', 'M', [])
    const l = p('T-L', 'L', [{ location_id: 'P-B3', qty: 4 }])
    const s = p('T-S', 'S', [{ location_id: 'P-B3', qty: 1 }, { location_id: 'C-1-1', qty: 2 }])
    const w = whereToStore(m, [m, l, s])
    expect(w.here).toEqual([])
    expect(w.best).toMatchObject({ id: 'P-B3', why: 'ahí están las otras tallas (5)' })
  })
  it('nada en ningun lado: su ubicacion principal', () => {
    const m = p('T-M', 'M', [])
    expect(whereToStore(m, [m]).best).toMatchObject({ id: 'C-5-1', why: 'su ubicación principal' })
  })
})
