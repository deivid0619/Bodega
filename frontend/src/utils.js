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

// Cuanto hay de un codigo: en la bodega (sin lo de paso), de paso y en la
// reserva. El total es bodega + reserva: lo de paso no es de la empresa.
export function stockSplit(p, index) {
  const passing = (p.stock || []).reduce((t, s) => t + (s.location_id === DISPATCH ? s.qty : 0), 0)
  const reserve = index ? reserveFor(p, index).reduce((t, it) => t + it.qty, 0) : 0
  const bodega = p.qty - passing
  return { bodega, passing, reserve, total: bodega + reserve }
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
