import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agoText, clearDraft, readDraft, writeDraft } from './draft'

// un localStorage de verdad (el de Node, si existe, no tiene getItem/setItem)
function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

describe('la remision a medias queda guardada', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

  it('se guarda lo anotado y se recupera igual, con la hora', () => {
    const blocks = [{ id: 3, name: 'CHAQUETA TOURING GRIS', rows: [{ size: 'M', qty: 2, pending: 0 }], place: 'P-A2' }]
    writeDraft({ number: 'OPR 77', supplier: 'Taller', blocks, dest: 'bodega', hasPhoto: true })
    const d = readDraft()
    expect(d.number).toBe('OPR 77')
    expect(d.blocks).toEqual(blocks)
    expect(d.hasPhoto).toBe(true)
    expect(Date.now() - d.at).toBeLessThan(1000)
  })

  it('descartar la borra (sin IndexedDB, la foto no estorba)', async () => {
    writeDraft({ number: 'OPR 1', blocks: [] })
    await clearDraft()
    expect(readDraft()).toBeNull()
  })

  it('algo roto o de otra version no se usa', () => {
    localStorage.setItem('bodega_remision_borrador', '{roto')
    expect(readDraft()).toBeNull()
    localStorage.setItem('bodega_remision_borrador', JSON.stringify({ v: 9, number: 'X' }))
    expect(readDraft()).toBeNull()
  })

  it('dice hace cuanto se dejo', () => {
    expect(agoText(Date.now())).toBe('hace un momento')
    expect(agoText(Date.now() - 5 * 60000)).toBe('hace 5 minutos')
    expect(agoText(Date.now() - 2 * 3600000)).toBe('hace 2 horas')
  })
})
