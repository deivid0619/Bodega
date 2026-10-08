import { describe, expect, it } from 'vitest'
import { availText } from './reserveOut'

describe('cuanto hay para empacar, con la reserva', () => {
  it('sin reserva, como siempre', () => {
    expect(availText(3, 0, 2)).toBe('hay 3')
    expect(availText(1, 0, 2)).toBe('solo hay 1')
  })
  it('en la bodega no hay: sale de la reserva', () => {
    expect(availText(0, 4, 2)).toBe('hay 0 en la bodega + 4 en la reserva · 2 salen de la reserva')
  })
  it('lo que falta en la bodega sale de la reserva', () => {
    expect(availText(1, 5, 2)).toBe('hay 1 en la bodega + 5 en la reserva · 1 sale de la reserva')
    expect(availText(3, 5, 2)).toBe('hay 3 en la bodega + 5 en la reserva')
  })
  it('ni con la reserva alcanza', () => {
    expect(availText(0, 1, 2)).toBe('solo hay 0 en la bodega + 1 en la reserva · 1 sale de la reserva')
  })
})
