import { describe, expect, it } from 'vitest'
import { orderSummary } from './orderSummary'
import { remisionPdf } from './remisionPdf'

const doc = (number, at, lines) => ({ number, created_at: at, lines, units: lines.reduce((t, l) => t + l.qty, 0), supplier: 'Taller Prueba' })

describe('el PDF de la remision', () => {
  it('se arma con el titulo, cada talla y lo que falta, y pasa de hoja si no cabe', async () => {
    const sizes = ['S', 'M', 'L', 'XL', '2XL']
    const lines = []
    for (let r = 0; r < 14; r++) for (const s of sizes) lines.push({ name: `CHAQUETA PRUEBA ${r}`, size: s, sku: `P${r}-${s}`, qty: 2, pending: s === 'XL' ? 1 : 0, location_id: 'C-1-1' })
    const summary = orderSummary([doc('OPR77', '2026-10-01T10:00:00Z', lines), doc('OPR77#2', '2026-10-05T10:00:00Z', [
      { name: 'CHAQUETA PRUEBA 0', size: 'XL', sku: 'P0-XL', qty: 1, pending: 0, dest: 'reserva' },
    ])])
    const blob = await remisionPdf(summary, { title: 'Orden OPR77 · 2 entregas', registered: '' })
    const raw = await new Promise((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.readAsBinaryString(blob)
    })
    expect(raw.startsWith('%PDF')).toBe(true)
    expect(raw).toContain('Orden OPR77')
    expect(raw).toContain('CHAQUETA PRUEBA 13')
    expect(raw).toContain('Faltan por llegar')
    expect(raw).toContain('Taller Prueba')
    // 70 tallas no caben en una hoja: sigue en la siguiente, con su pie
    expect(raw).toContain('Página 2 de')
  })
})
