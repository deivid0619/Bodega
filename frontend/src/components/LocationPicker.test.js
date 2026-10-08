import { describe, expect, it } from 'vitest'
import { matchLocation } from './LocationPicker'

const barra = { id: 'P-A2', name: 'Perchero A, barra 2' }
const canasta = { id: 'C-8-4', name: 'Canasta C-8-4' }

describe('buscar una ubicacion', () => {
  it('por el codigo, aunque se escriba sin guion', () => {
    expect(matchLocation(barra, 'Perchero A', 'A2')).toBe(true)
    expect(matchLocation(barra, 'Perchero A', 'pa2')).toBe(true)
    expect(matchLocation(canasta, 'Canastas C', 'c84')).toBe(true)
  })
  it('por el nombre o el mueble, sin importar mayusculas ni tildes', () => {
    expect(matchLocation(barra, 'Perchero A', 'perchero a')).toBe(true)
    expect(matchLocation(canasta, 'Canastas C', 'canasta 4')).toBe(true)
    expect(matchLocation({ id: 'M-1-1', name: 'Mesa M, canasta 1' }, 'Mesa M', 'MESÁ')).toBe(true)
  })
  it('todas las palabras tienen que estar', () => {
    expect(matchLocation(barra, 'Perchero A', 'perchero b')).toBe(false)
    expect(matchLocation(canasta, 'Canastas C', 'canasta 9')).toBe(false)
  })
})
