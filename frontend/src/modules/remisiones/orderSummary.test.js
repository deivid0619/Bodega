import { describe, expect, it } from 'vitest'
import { orderBase, orderSummary } from './orderSummary'

const REF = 'CHAQUETA TOURING GRIS'
const doc = (number, at, lines, extra = {}) => ({ number, created_at: at, lines, units: lines.reduce((t, l) => t + l.qty, 0), ...extra })

describe('el PDF de una remision: la orden con sus entregas', () => {
  it('suma lo que llego y lo que falta sale de la ultima entrega que nombra la talla', () => {
    const first = doc('OPR77', '2026-10-01T10:00:00Z', [
      { name: REF, size: 'M', sku: 'T-M', qty: 4, pending: 2, dest: 'bodega', location_id: 'P-A2' },
      { name: REF, size: 'L', sku: 'T-L', qty: 3, pending: 0, dest: 'bodega', location_id: 'P-A2' },
      { name: 'GUANTES', size: 'S', sku: 'G-S', qty: 0, pending: 5 },
    ], { supplier: 'Taller X' })
    const second = doc('OPR77#2', '2026-10-05T10:00:00Z', [
      { name: REF, size: 'M', sku: 'T-M', qty: 2, pending: 0, dest: 'reserva' },
    ])
    const s = orderSummary([second, first], (id) => (id === 'P-A2' ? 'Perchero A, barra 2' : null))
    const touring = s.refs.find((r) => r.name === REF)
    expect(touring.rows).toEqual([
      { size: 'M', sku: 'T-M', arrived: 6, pending: 0, where: 'Perchero A, barra 2, Reserva' },
      { size: 'L', sku: 'T-L', arrived: 3, pending: 0, where: 'Perchero A, barra 2' },
    ])
    // los guantes no llegaron en la segunda: siguen faltando 5
    expect(s.refs.find((r) => r.name === 'GUANTES').rows[0]).toMatchObject({ arrived: 0, pending: 5, where: '' })
    expect([s.arrived, s.pending]).toEqual([9, 5])
    expect(s.deliveries.map((d) => d.number)).toEqual(['OPR77', 'OPR77#2'])
    expect(s.supplier).toBe('Taller X')
  })

  it('una talla repartida en dos ubicaciones cuenta una vez lo que falta', () => {
    const s = orderSummary([doc('OPR9', '2026-10-01T10:00:00Z', [
      { name: REF, size: 'M', sku: 'T-M', qty: 3, pending: 1, location_id: 'C-1-1' },
      { name: REF, size: 'M', sku: 'T-M', qty: 2, pending: 0, dest: 'reserva' },
    ])])
    expect(s.refs[0].rows).toEqual([{ size: 'M', sku: 'T-M', arrived: 5, pending: 1, where: 'C-1-1, Reserva' }])
  })

  it('solo registro dice que no se sumo', () => {
    const s = orderSummary([doc('OPR5', '2026-10-01T10:00:00Z', [{ name: REF, size: 'S', sku: 'T-S', qty: 2, pending: 0 }], { mode: 'registro' })])
    expect(s.refs[0].rows[0].where).toBe('Solo registro')
  })

  it('el numero de la orden', () => {
    expect(orderBase('OPR77#2')).toBe('OPR77')
    expect(orderBase('OPR77')).toBe('OPR77')
    expect(orderBase('SN-1008-101010')).toBe('SN-1008-101010')
  })
})
