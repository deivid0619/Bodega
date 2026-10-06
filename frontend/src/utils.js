import { DISPATCH } from './locationGroups'

const SIZE_RE = /(XXXL|XXL|4XL|3XL|2XL|XL|XS|S|M|L)$/

// orden natural de tallas: XS, S, M, L, XL, 2XL... y luego las numericas (06, 30, 32)
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL']
export function sizeRank(size) {
  const s = String(size || '').toUpperCase()
  const i = SIZE_ORDER.indexOf(s)
  if (i >= 0) return i
  const n = parseFloat(s)
  return Number.isFinite(n) ? 100 + n : 500
}

export function guessSizeFromSku(sku) {
  const m = String(sku || '').toUpperCase().match(SIZE_RE)
  return m ? m[1] : ''
}

export function fmtTime(iso) {
  const t = new Date(iso).getTime()
  const d = Date.now() - t
  if (d < 60_000) return 'ahora'
  if (d < 3_600_000) return `hace ${Math.floor(d / 60_000)} min`
  const dt = new Date(t)
  const today = new Date()
  if (dt.toDateString() === today.toDateString()) return dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dt.toDateString() === yesterday.toDateString()) return 'ayer'
  return dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
}

// Una referencia son todas las tallas con el mismo nombre. No se saca del
// codigo: en los de Pigmalion la talla va en la mitad (PGPRBI070SFEM), no
// al final, y agrupar por codigo dejaba cada talla como otra referencia.
export const refKey = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

// La parte comun de los codigos de una referencia (PGPRBI070SFEM y
// PGPRBI070MFEM -> PGPRBI070), para mostrarla en la tarjeta
export function refCode(skus) {
  if (skus.length < 2) return skus[0] || ''
  let pre = skus[0]
  for (const s of skus) while (!s.startsWith(pre)) pre = pre.slice(0, -1)
  pre = pre.replace(/[-_. ]+$/, '')
  return pre.length >= 4 ? pre : skus[0]
}

// Lo que hay de un codigo en la reserva: con su codigo o, si se guardo sin
// codigo, con la misma referencia y talla (igual que en el servidor).
export function reserveIndex(items) {
  const bySku = new Map()
  const byRef = new Map()
  for (const it of items || []) {
    if (!(it.qty > 0)) continue
    const [map, key] = it.sku ? [bySku, it.sku] : [byRef, `${it.name}|${it.size || ''}`]
    map.set(key, [...(map.get(key) || []), it])
  }
  return { bySku, byRef }
}

export function reserveFor(p, index) {
  return [...(index.bySku.get(p.sku) || []), ...(index.byRef.get(`${p.name}|${p.size || ''}`) || [])]
}

// Ubicaciones de muebles marcados como outlet (lo que hay ahi no cuenta)
export function outletIdsOf(layout) {
  return new Set((layout?.elements || []).flatMap((e) => (e.locations || []).filter((l) => l.outlet).map((l) => l.id)))
}

// Cuanto hay de un codigo: en la bodega (sin lo de paso ni el outlet), de
// paso, en el outlet y en la reserva. El total es bodega + reserva: lo de
// paso no es de la empresa y el outlet no se entrega normalmente.
export function stockSplit(p, index, outlet) {
  let passing = 0
  let out = 0
  for (const s of p.stock || []) {
    if (s.location_id === DISPATCH) passing += s.qty
    else if (outlet?.has(s.location_id)) out += s.qty
  }
  const reserve = index ? reserveFor(p, index).reduce((t, it) => t + it.qty, 0) : 0
  const bodega = p.qty - passing - out
  return { bodega, passing, outlet: out, reserve, total: bodega + reserve }
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const money = (n) => COP.format(n || 0)

export function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
    a.remove()
  }, 500)
}
