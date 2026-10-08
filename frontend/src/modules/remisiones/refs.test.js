import { describe, expect, it } from 'vitest'
import { RESERVA, partsTotal, splitRow } from './refs'

describe('repartir lo que llego en varias ubicaciones', () => {
  const row = { size: '', qty: 45, parts: [
    { key: 1, loc: 'C-1-1', qty: 15 }, { key: 2, loc: 'C-1-2', qty: 15 }, { key: 3, loc: RESERVA, qty: 5 }, { key: 4, loc: '', qty: 0 },
  ] }

  it('cada parte con lo suyo y el resto a la ubicacion de la referencia', () => {
    const { parts, rest } = splitRow(row, true)
    expect(parts.map((p) => [p.loc, p.qty])).toEqual([['C-1-1', 15], ['C-1-2', 15], [RESERVA, 5]]) // la vacia no cuenta
    expect(rest).toBe(10)
  })

  it('sin repartir, todo va a la ubicacion de la referencia', () => {
    expect(splitRow(row, false)).toEqual({ parts: [], rest: 45 })
  })

  it('suma lo repartido (lo negativo o vacio no cuenta)', () => {
    expect(partsTotal([{ qty: 3 }, { qty: -2 }, {}])).toBe(3)
    expect(partsTotal(undefined)).toBe(0)
  })
})
