import { describe, expect, it } from 'vitest'
import { asksFrom, fromMissing, outAvailable, outParts, placesOf, refCode, refKey, reserveFor, reserveIndex, similarInReserve, stockSplit } from './utils'

// Una referencia son sus tallas con el mismo nombre: en los codigos de
// Pigmalion la talla va en la mitad (PGPRBI070SFEM), no al final
describe('referencia y su codigo comun', () => {
  it('agrupa por nombre aunque cambien tildes, mayusculas o espacios', () => {
    expect(refKey('Chaqueta  Moto Fénix Mujer')).toBe(refKey('CHAQUETA MOTO FENIX MUJER'))
  })
  it('muestra la parte comun de los codigos de sus tallas', () => {
    expect(refCode(['PGPRBI070SFEM', 'PGPRBI070MFEM', 'PGPRBI070XLFEM'])).toBe('PGPRBI070')
    expect(refCode(['CORT-ESS-S', 'CORT-ESS-M'])).toBe('CORT-ESS')
    expect(refCode(['PGPRBI070SFEM'])).toBe('PGPRBI070SFEM')
    expect(refCode(['AB1', 'XY2'])).toBe('AB1') // nada en comun: el primero
  })
})

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
    expect(stockSplit(s, index)).toEqual({ bodega: 3, passing: 0, outlet: 0, reserve: 10, total: 13 })
    const m = { sku: 'PRUEBA-M', name: 'CHAQUETA PRUEBA', size: 'M', qty: 2, stock: [{ location_id: 'C-1-2', qty: 2 }] }
    expect(reserveFor(m, index).map((it) => it.id)).toEqual([2])
    expect(stockSplit(m, index).total).toBe(6)
  })

  it('lo de paso y el outlet no son de la bodega ni entran al total', () => {
    const p = { sku: 'PASO', name: 'OTRA', size: '', qty: 10, stock: [{ location_id: 'C-1-1', qty: 2 }, { location_id: 'DESPACHO', qty: 5 }, { location_id: 'O-1-1', qty: 3 }] }
    expect(stockSplit(p, index, new Set(['O-1-1']))).toEqual({ bodega: 2, passing: 5, outlet: 3, reserve: 0, total: 2 })
  })

  it('lo que esta en cero en la reserva no cuenta, y sin reserva el total es la bodega', () => {
    const l = { sku: 'PRUEBA-L', name: 'CHAQUETA PRUEBA', size: 'L', qty: 1, stock: [{ location_id: 'C-1-3', qty: 1 }] }
    expect(reserveFor(l, index)).toEqual([])
    expect(stockSplit(l)).toEqual({ bodega: 1, passing: 0, outlet: 0, reserve: 0, total: 1 })
  })
})

// De donde sale una salida: se pregunta solo si hay que elegir, y lo elegido
// sale primero; si ahi no alcanza, el resto sale de donde haya
describe('de donde sale una salida', () => {
  const outlet = new Set(['O-1-1'])
  const p = { stock: [{ location_id: 'C-1-1', qty: 3 }, { location_id: 'C-2-4', qty: 2 }, { location_id: 'O-1-1', qty: 4 }, { location_id: 'C-9-9', qty: 0 }] }

  it('lista donde hay, con el outlet al final, y pregunta si hay varias', () => {
    expect(placesOf(p, outlet)).toEqual([
      { id: 'C-1-1', qty: 3, outlet: false }, { id: 'C-2-4', qty: 2, outlet: false }, { id: 'O-1-1', qty: 4, outlet: true }])
    expect(asksFrom(placesOf({ stock: [{ location_id: 'C-1-1', qty: 3 }] }, outlet))).toBe(false)
    expect(asksFrom(placesOf({ stock: [{ location_id: 'O-1-1', qty: 3 }] }, outlet))).toBe(true)
    expect(asksFrom(placesOf(p, outlet))).toBe(true)
  })

  it('lo del outlet solo se puede sacar eligiendolo', () => {
    expect(outAvailable(p, outlet, '')).toBe(5)
    expect(outAvailable(p, outlet, 'C-2-4')).toBe(5)
    expect(outAvailable(p, outlet, 'O-1-1')).toBe(9)
  })

  it('sale primero de la elegida y el resto de donde haya', () => {
    expect(outParts(2, 'C-2-4', p)).toEqual([{ qty: 2, loc: 'C-2-4' }])
    expect(outParts(4, 'C-2-4', p)).toEqual([{ qty: 2, loc: 'C-2-4' }, { qty: 2, loc: '' }])
    expect(outParts(4, '', p)).toEqual([{ qty: 4, loc: '' }])
    expect(outParts(1, 'C-9-9', p)).toEqual([{ qty: 1, loc: '' }])
  })
})

// La misma prenda escrita distinto en la reserva y en la bodega
describe('reserva con otro nombre', () => {
  it('cuenta igual con o sin tildes y espacios de mas', () => {
    const index = reserveIndex([{ id: 9, sku: null, name: 'GUANTES PROTECCIÓN  VORTEX', size: 'xl', qty: 5 }])
    expect(reserveFor({ sku: 'X', name: 'GUANTES PROTECCION VORTEX', size: 'XL' }, index).map((it) => it.id)).toEqual([9])
  })

  it('sugiere la guardada a mano con palabras en comun y la misma talla', () => {
    const items = [
      { id: 1, sku: null, name: 'GUANTES PROTECCION VORTEX NG MAS', size: 'XL', qty: 5 },
      { id: 2, sku: null, name: 'GUANTES PROTECCION VORTEX NG MAS', size: 'L', qty: 3 }, // otra talla
      { id: 3, sku: 'P-1', name: 'GUANTES PROTECCION VORTEX', size: 'XL', qty: 2 }, // ya tiene codigo
      { id: 4, sku: null, name: 'CHAQUETA FENIX', size: 'XL', qty: 1 },
    ]
    expect(similarInReserve(items, 'GUANTES MOTO PROTECCIÓN VORTEX NEÓN', 'XL').map((it) => it.id)).toEqual([1])
    expect(similarInReserve(items, 'GUANTES', 'XL')).toEqual([])
  })
})

describe('repartir de donde sale', () => {
  const p = { stock: [{ location_id: 'C-1-1', qty: 2 }, { location_id: 'P-A2', qty: 3 }] }
  const places = [{ id: 'P-A2', qty: 3, outlet: false }, { id: 'C-1-1', qty: 2, outlet: false }]
  it('sale lo que se dijo de cada lugar', () => {
    expect(outParts(4, { 'C-1-1': 2, 'P-A2': 2 }, p)).toEqual([{ qty: 2, loc: 'C-1-1' }, { qty: 2, loc: 'P-A2' }])
    expect(outAvailable(p, new Set(), { 'C-1-1': 2, 'P-A2': 2 })).toBe(5)
  })
  it('falta decir de donde sale mientras no este completo', () => {
    expect(fromMissing(undefined, 4, places)).toBe(true)
    expect(fromMissing({ 'C-1-1': 1 }, 4, places)).toBe(true)
    expect(fromMissing({ 'C-1-1': 2, 'P-A2': 2 }, 4, places)).toBe(false)
    expect(fromMissing('', 4, places)).toBe(false)
    expect(fromMissing(undefined, 4, [places[0]])).toBe(false) // un solo lugar: no se pregunta
  })
})
