import { describe, expect, it } from 'vitest'
import { canon, matchAll, matchLine, parseFactura, sameLine, sizeOf } from './facturaParser'

// Lo que leyo Tesseract (gratis, en el navegador) de una foto real de una
// factura de Pigmalion: solo el numero y las lineas de productos (los
// precios se cambiaron por ceros; el lector no los usa).
const OCR = `THGITIENNI IT   [|               www plgmalionmoto.com                       No. FEV21830
|                              PGPRBIOTOSFEM           CHAGUETA FENIX BLACK FEM TS                                 2 UND            $ 000.000,00                           $000,000.00
| LSS43REL                   CORT. REFLECTIVA ESSENTIAL MAS TL                         5 UND            $ 000.000,00                           $ 000 000,00
| ACt1aBFCLO02              GUELLO CAMO PUNTOS DORADO MULTIFUNCIONAL          20 UND              $00.000,00                            $0000000,00
AC114BFCLO04             GUELLO CAMO PUNTOS NEGRO MULTIFUNCIONAL            2 UND             $00,000.00                            $00000,00
LSS49RRFEMTS            CORT. REFLECTIVA REAL RIDERS FEM TS                     5 UND            $ 000.000.00                          $000.000.00
P-PRM001900S             GUANTES PROT. LEVI NEGRO MAS TS                          2 PAR            $ 000 000.00                          $000.000 00
AC! T4BFCLO01            CUELLO DIAG. NARANJA MULTIFUNCIONAL                  20 UND             $ 00 000.00                         $000000.00
P-ACU0010000              CANGURO 100% IMP ALPHA NEGRO                            10 UND              $ 00.000.00                          $ 000 000,00
P.PRMO01800S       GUANTES PROT. VORTEX NEON MAS TS             1 PAR      $000000,00              $000.000.00
PGPRBIOTOMFEM           CHAQUETA FENIX BLACK FEM TM                                 2 UND            $ 000 000,00                           $000 000.00
PGPRBIOMAZGS            CHAQUETA GENESIS PRO VER AZ MAS TS                       2 UND             $000,000.00                             $ 000 000,00
P-PRM001800M             GUANTES PROT. VORTEX NEON MAS TM                       1 PAR            $000.000,00                          $000 000.00
LS549RRFEMTXL            CORT. REFLECTIVA REAL RIDERS FEM TXL                      4 UND             $ 000,000.00                            $ 000 000,00
LS543RES                   CORT, REFLECTIVA ESSENTIAL MAS TS                        5 UND            $ 000 000,00                          $ 000 000.00
PGACBI00SCM               MOTOMORRAL IMPERMEABLE CAMO GRIS                      5 UND             $ 000 000,00                           § 00000000
P-PRM0008038              PANTALON TRAVELER PRO INV MAS T36                        3 UND            $000 000,00                           $ 000 000.00
P-PRM0008030              PANTALON TRAVELER PRO INV MAS T30                       3 UND            § 000,000.00                          $ 000 000,00
P-PRF0008006              PANTALON TRAVELER PRO INV FEM T06                       3 UND            $000.000,00                          $ 000.000,00
| P-PRM0008032              PANTALON TRAVELER PRO INV MAS T32                        1 UND            $000.000,00                           $ 00000000
PGACMMIO14NG           MOTOMORRAL IMPERMEABLE MINIMAL NEGRO               5 UND            $000 000,00                          §000000,00
PGACO18CM                CANGURO DRAGON CAMUFLADO                                5 UND              $ 00 000,00                           $ 000,000,00
PGAC012NG                GANGURO IMPERMEABLE NEGRO                               5 UND             $00.000.00                          $ 000 000.00
P-PRFD00B008              PANTALON TRAVELER PRO INV FEM T08                       3 UND            $ 000.000.00                           000.000,00
PGACO17PA                 RIERNERA ANDES                                                   5 UND              $00.000,00                           $ 000.000,00
P-PRF0008010             PANTALON TRAVELER PRO INV FEM T10                      3 UND           $ 000.000,00                         $ 000.000,00`

// lo que de verdad dice la factura impresa
const TRUTH = [
  ['PGPRBI070SFEM', 'CHAQUETA FENIX BLACK FEM', 'S', 2], ['LS543REL', 'CORT. REFLECTIVA ESSENTIAL MAS', 'L', 5],
  ['AC114BFCL002', 'CUELLO CAMO PUNTOS DORADO', '', 20], ['AC114BFCL004', 'CUELLO CAMO PUNTOS NEGRO', '', 2],
  ['LS549RRFEMTS', 'CORT. REFLECTIVA REAL RIDERS FEM', 'S', 5], ['P-PRM001900S', 'GUANTES PROT. LEVI NEGRO MAS', 'S', 2],
  ['AC114BFCL001', 'CUELLO DIAG. NARANJA', '', 20], ['P-ACU0010000', 'CANGURO 100% IMP ALPHA NEGRO', '', 10],
  ['P-PRM001800S', 'GUANTES PROT. VORTEX NEON MAS', 'S', 1], ['PGPRBI070MFEM', 'CHAQUETA FENIX BLACK FEM', 'M', 2],
  ['PGPRBI044AZGS', 'CHAQUETA GENESIS PRO VER AZ MAS', 'S', 2], ['P-PRM001800M', 'GUANTES PROT. VORTEX NEON MAS', 'M', 1],
  ['LS549RRFEMTXL', 'CORT. REFLECTIVA REAL RIDERS FEM', 'XL', 4], ['LS543RES', 'CORT. REFLECTIVA ESSENTIAL MAS', 'S', 5],
  ['PGACBI009CM', 'MOTOMORRAL IMPERMEABLE CAMO GRIS', '', 5], ['P-PRM0008036', 'PANTALON TRAVELER PRO INV MAS', '36', 3],
  ['P-PRM0008030', 'PANTALON TRAVELER PRO INV MAS', '30', 3], ['P-PRF0008006', 'PANTALON TRAVELER PRO INV FEM', '06', 3],
  ['P-PRM0008032', 'PANTALON TRAVELER PRO INV MAS', '32', 1], ['PGACMMI014NG', 'MOTOMORRAL IMPERMEABLE MINIMAL NEGRO', '', 5],
  ['PGAC018CM', 'CANGURO DRAGON CAMUFLADO', '', 5], ['PGAC012NG', 'CANGURO IMPERMEABLE NEGRO', '', 5],
  ['P-PRF0008008', 'PANTALON TRAVELER PRO INV FEM', '08', 3], ['PGAC017PA', 'RIERNERA ANDES', '', 5],
  ['P-PRF0008010', 'PANTALON TRAVELER PRO INV FEM', '10', 3],
]
const PRODUCTS = TRUTH.map(([sku, name, size]) => ({ sku, name, size }))

describe('factura impresa leida con OCR', () => {
  const { number, lines } = parseFactura(OCR)

  it('encuentra el numero y todas las lineas con su cantidad', () => {
    expect(number).toBe('FEV21830')
    expect(lines).toHaveLength(25)
    expect(lines.map((l) => l.qty)).toEqual(TRUTH.map((t) => t[3]))
  })

  it('corrige cada codigo mal leido al codigo real de la bodega', () => {
    const matched = matchAll(lines, PRODUCTS).map((m) => m.sku)
    expect(matched).toEqual(TRUTH.map((t) => t[0]))
  })

  it('no confunde un codigo vecino de OTRO producto que no esta en la bodega', () => {
    // los guantes Vortex no estan registrados; su codigo se parece al de los Levi
    const sinVortex = PRODUCTS.filter((p) => p.sku !== 'P-PRM001800S')
    const matched = matchAll(lines, sinVortex)
    const vortexLine = lines.findIndex((l) => l.description.includes('VORTEX NEON MAS TS'))
    expect(matched[vortexLine].product).toBeNull()
    const levi = matched.filter((m) => m.sku === 'P-PRM001900S')
    expect(levi).toHaveLength(1)
  })

  it('no cambia de talla: si solo existe la M, la linea de la S queda sin unir', () => {
    const soloM = PRODUCTS.filter((p) => p.sku !== 'PGPRBI070SFEM')
    const i = lines.findIndex((l) => l.description.endsWith('FENIX BLACK FEM TS'))
    expect(matchAll(lines, soloM)[i].product).toBeNull()
  })

  it('lee la talla al final de la descripcion', () => {
    expect(sizeOf('CHAQUETA FENIX BLACK FEM TS')).toBe('S')
    expect(sizeOf('PANTALON TRAVELER PRO INV MAS T36')).toBe('36')
    expect(sizeOf('CANGURO DRAGON CAMUFLADO')).toBe('')
  })

  it('no inventa: un codigo desconocido queda sin unir', () => {
    const m = matchLine({ code: 'ZX9Q77KK', description: 'BOTAS NUEVAS' }, PRODUCTS)
    expect(m.product).toBeNull()
  })

  it('las parejas que el OCR confunde valen lo mismo', () => {
    expect(canon('LSS43REL')).toBe(canon('LS543REL'))
    expect(canon('PGPRBIOTOSFEM')).toBe(canon('PGPRBI070SFEM'))
  })

  it('reconoce la misma linea leida en dos fotos, aunque el codigo salga distinto', () => {
    const a = { code: 'PCLL0025U', description: 'CUELLO TERMICO NEGRO TU', qty: 6 }
    expect(sameLine(a, { code: 'POLLOGISY', description: 'CUBLLO TERMICO NEGRO TU', qty: 6 })).toBe(true)
    // otra talla u otra cantidad: es otra linea
    expect(sameLine({ code: 'X1', description: 'CHAQUETA TOURING GRIS TM', qty: 3 }, { code: 'Y2', description: 'CHAQUETA TOURING GRIS TL', qty: 3 })).toBe(false)
    expect(sameLine(a, { ...a, code: 'ZZZ', qty: 2 })).toBe(false)
  })

  it('entiende la unidad mal leida (2UuND, 4 UNO) sin perder la cantidad', () => {
    const r = parseFactura('| PGPRGPOT2vCMM      CHAQUETA MOTO GENESIS PRO VERANO CAMO GRIS TM   2UuND   $ 000 000 00\nP-WPM210200L   CORTAVIENTOS REXA IMP NEGRO TL   4 UNO   $ 000.000,00')
    expect(r.lines.map((l) => l.qty)).toEqual([2, 4])
  })
})
