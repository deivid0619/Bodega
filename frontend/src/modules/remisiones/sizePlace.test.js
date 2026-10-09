import { describe, expect, it } from 'vitest'
import { sizePlace } from './sizePlace'

const p = (sku, size, stock, main = 'C-5-1') => ({ sku, name: 'CHAQUETA FENIX BLACK', size, location_id: main, stock })

describe('donde va cada talla de la remision', () => {
  it('donde ya hay de esa talla, aunque las otras tallas esten en otro lado', () => {
    const s = p('F-S', 'S', [{ location_id: 'C-4-1', qty: 2 }, { location_id: 'C-4-2', qty: 5 }], 'C-4-1')
    const m = p('F-M', 'M', [{ location_id: 'C-9-9', qty: 20 }], 'C-9-9')
    const w = sizePlace(s, s.name, [s, m])
    expect(w.here.map((h) => [h.id, h.qty])).toEqual([['C-4-2', 5], ['C-4-1', 2]])
    expect(w.auto).toMatchObject({ id: 'C-4-2', why: 'ahí hay 5 de esta talla' })
    expect(w.auto.mix).toBeUndefined()
  })
  it('hoy no hay de esa talla: su ubicacion de siempre, no la de las otras tallas', () => {
    const s = p('F-S', 'S', [], 'C-4-1')
    const m = p('F-M', 'M', [{ location_id: 'C-9-9', qty: 20 }], 'C-9-9')
    expect(sizePlace(s, s.name, [s, m]).auto).toMatchObject({ id: 'C-4-1', why: 'su ubicación de siempre (hoy no hay)' })
  })
  it('sin contar Despacho ni el outlet', () => {
    const s = p('F-S', 'S', [{ location_id: 'DESPACHO', qty: 4 }, { location_id: 'O-1', qty: 3 }], 'C-4-1')
    const w = sizePlace(s, s.name, [s], new Set(['O-1']))
    expect(w.here).toEqual([])
    expect(w.auto.id).toBe('C-4-1')
  })
  it('talla nueva: con las otras tallas, avisando que se mezclan', () => {
    const m = p('F-M', 'M', [{ location_id: 'C-9-9', qty: 20 }, { location_id: 'C-9-8', qty: 1 }], 'C-9-9')
    const w = sizePlace(null, 'Chaqueta Fénix Black', [m])
    expect(w.here).toEqual([])
    expect(w.auto).toMatchObject({ id: 'C-9-9', mix: true, why: 'con las otras tallas: ahí se mezclan' })
  })
  it('talla nueva sin ninguna otra en la bodega: hay que elegir', () => {
    expect(sizePlace(null, 'REFERENCIA NUEVA', [p('X', 'M', [{ location_id: 'C-1-1', qty: 1 }])]).auto).toBeNull()
  })
})
