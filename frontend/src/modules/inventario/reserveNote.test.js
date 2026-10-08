import { describe, expect, it } from 'vitest'
import { reserveNote } from './reserveNote'

describe('el aviso de la reserva en el inventario', () => {
  it('lo que solo esta en la reserva se dice claro', () => {
    expect(reserveNote({ bodega: 0, reserve: 3, onlyReserve: true })).toEqual({
      tone: 'only', text: 'Solo está en la reserva: 3 prendas guardadas. En la bodega no hay.',
    })
  })
  it('en la bodega en 0 pero con prendas en la reserva', () => {
    expect(reserveNote({ bodega: 0, reserve: 1 })).toEqual({
      tone: 'only', text: 'En la bodega no hay, pero en la reserva hay 1 prenda guardada.',
    })
  })
  it('con prendas en la bodega y tambien en la reserva', () => {
    expect(reserveNote({ bodega: 5, reserve: 2 }).tone).toBe('more')
  })
  it('sin nada en la reserva no hay aviso', () => {
    expect(reserveNote({ bodega: 5, reserve: 0 })).toBeNull()
    expect(reserveNote(null)).toBeNull()
  })
})
