// Interpreta el texto que lee el OCR de una factura impresa (ContaPyme) y
// corrige los codigos contra los que ya conoce la bodega.
//
// Cada linea de producto llega asi (columnas separadas por varios espacios):
//   PGPRBIOTOSFEM     CHAQUETA FENIX BLACK FEM TS     2 UND     $ 305.882,00 ...
// El OCR confunde letras parecidas (O/0, I/1, S/5, B/8...). Como el codigo
// de la factura es el mismo de la etiqueta, se compara en una forma
// "canonica" donde esas parejas valen lo mismo.

const UNIT = '(?:UND|UNO|UN0|UNID(?:ADES)?|PARES|PAR|PR)'
const LINE_RE = new RegExp(`^[^A-Z0-9]*([A-Z0-9][A-Z0-9.\\-!|' ]{3,22}?)\\s{2,}(.+?)\\s+(\\d{1,4})\\s*${UNIT}\\b`, 'i')
const NUMBER_RE = /\b(FEV|FE|FV)\s*[-.]?\s*([0-9OoQDZzIlSsBb]{3,})/

const LOOKALIKE = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', '!': '1', '|': '1', S: '5', B: '8', Z: '2', G: '6', T: '7', A: '4' }
const DIGIT_LIKE = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', b: '8' }

export function canon(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[\s'.,]/g, (ch) => (ch === '.' || ch === ',' ? '-' : ''))
    .split('')
    .map((ch) => LOOKALIKE[ch] || ch)
    .join('')
}

// el codigo como deberia escribirse (sin espacios; "P." -> "P-")
export function cleanCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^P\./, 'P-')
    .replace(/[!|]/g, 'I')
    .replace(/[^A-Z0-9-]/g, '')
}

function levenshtein(a, b) {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

const words = (s) => [...new Set(String(s || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2))]

// que parte de las palabras del NOMBRE del producto aparece en la descripcion
// leida (una letra mal leida en palabras largas cuenta igual: GUELLO = CUELLO)
function nameMatch(description, name) {
  const desc = words(description)
  const need = words(name)
  if (!need.length || !desc.length) return 0
  const hit = need.filter((w) => desc.some((d) => d === w || (w.length >= 5 && levenshtein(d, w) <= 1)))
  return hit.length / need.length
}

export function parseFactura(text) {
  const lines = []
  let number = ''
  for (const raw of String(text || '').split('\n')) {
    if (!number) {
      const m = raw.match(NUMBER_RE)
      if (m) number = m[1].toUpperCase() + m[2].replace(/[A-Za-z]/g, (ch) => DIGIT_LIKE[ch] || ch)
    }
    const m = raw.match(LINE_RE)
    if (!m) continue
    const read = m[1].trim()
    if (!/\d/.test(read) && read.length < 6) continue // encabezados sueltos
    lines.push({ read, code: cleanCode(read), description: m[2].replace(/\s{2,}/g, ' ').trim(), qty: Number(m[3]) })
  }
  return { number, lines }
}

// talla al final de la descripcion: "... FEM TS" -> S, "... MAS T36" -> 36
const SIZE_RE = /\bT(XXXL|XXL|2XL|3XL|4XL|XL|XS|S|M|L|\d{2})\s*$/
export const sizeOf = (description) => (String(description || '').toUpperCase().match(SIZE_RE) || [])[1] || ''

// Une cada linea leida con un codigo conocido.
//  1) igual en forma canonica (las letras que el OCR confunde valen lo mismo): se acepta.
//  2) a una o dos letras de distancia: solo si la descripcion coincide, la
//     talla es la misma y ninguna otra linea ya reclamo ese codigo. Asi un
//     codigo vecino de OTRO producto (Vortex vs Levi) no se confunde.
// Devuelve { sku, product, how: 'exact'|'fixed'|null }.
export function matchLine(line, products, claimed = new Set()) {
  const target = canon(line.code)
  const exact = products.find((p) => p.sku === line.code)
  if (exact) return { sku: exact.sku, product: exact, how: 'exact' }
  const same = products.filter((p) => canon(p.sku) === target)
  if (same.length === 1) return { sku: same[0].sku, product: same[0], how: 'fixed' }
  const lineSize = sizeOf(line.description)
  let best = null
  for (const p of products) {
    if (claimed.has(p.sku)) continue
    const c = canon(p.sku)
    if (Math.abs(c.length - target.length) > 2) continue
    const d = levenshtein(c, target)
    if (d > 2) continue
    if (lineSize && p.size && lineSize !== String(p.size).toUpperCase()) continue
    const sim = nameMatch(line.description, p.name)
    if (sim < 0.8) continue
    const score = d - sim
    if (!best || score < best.score) best = { p, score }
  }
  if (best) return { sku: best.p.sku, product: best.p, how: 'fixed' }
  return { sku: line.code, product: null, how: null }
}

// Todas las lineas: primero las seguras (iguales), despues las corregidas,
// sin dejar que una corregida tome un codigo que ya es de otra linea.
export function matchAll(lines, products) {
  const out = new Array(lines.length)
  const claimed = new Set()
  lines.forEach((l, i) => {
    const m = matchLine(l, products, new Set(['__solo_exactas__']))
    if (m.how === 'exact' || (m.how === 'fixed' && products.filter((p) => canon(p.sku) === canon(l.code)).length === 1)) {
      out[i] = m
      claimed.add(m.sku)
    }
  })
  lines.forEach((l, i) => {
    if (out[i]) return
    const m = matchLine(l, products, claimed)
    if (m.product) claimed.add(m.sku)
    out[i] = m
  })
  return out
}
