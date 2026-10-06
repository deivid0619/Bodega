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
// codigo, con la misma referencia y talla (igual que en el servidor), sin
// importar tildes ni espacios: PROTECCIÓN = PROTECCION.
const refSize = (name, size) => `${refKey(name)}|${refKey(size)}`

export function reserveIndex(items) {
  const bySku = new Map()
  const byRef = new Map()
  for (const it of items || []) {
    if (!(it.qty > 0)) continue
    const [map, key] = it.sku ? [bySku, it.sku] : [byRef, refSize(it.name, it.size)]
    map.set(key, [...(map.get(key) || []), it])
  }
  return { bySku, byRef }
}

export function reserveFor(p, index) {
  return [...(index.bySku.get(p.sku) || []), ...(index.byRef.get(refSize(p.name, p.size)) || [])]
}

// Lo de la reserva guardado a mano (sin codigo) que parece la misma prenda
// con otro nombre: la misma talla y al menos dos palabras en comun (GUANTES
// PROTECCION VORTEX NG / GUANTES MOTO PROTECCIÓN VORTEX NEÓN)
export function similarInReserve(items, name, size) {
  const words = (s) => new Set(refKey(s).split(' ').filter((w) => w.length > 2))
  const mine = words(name)
  if (mine.size < 2) return []
  return (items || []).filter((it) => {
    if (!(it.qty > 0) || it.sku || refKey(it.size) !== refKey(size)) return false
    const theirs = words(it.name)
    let common = 0
    for (const w of theirs) if (mine.has(w)) common++
    return common >= 2 && common >= Math.min(mine.size, theirs.size) / 2
  }).slice(0, 3)
}

// Ubicaciones de muebles marcados como outlet (lo que hay ahi no cuenta)
export function outletIdsOf(layout) {
  return new Set((layout?.elements || []).flatMap((e) => (e.locations || []).filter((l) => l.outlet).map((l) => l.id)))
}

// ---- de donde sale una salida ----
// Donde hay de un codigo: [{ id, qty, outlet }], lo del outlet al final
export function placesOf(p, outlet) {
  return (p?.stock || []).filter((s) => s.qty > 0)
    .map((s) => ({ id: s.location_id, qty: s.qty, outlet: !!outlet?.has(s.location_id) }))
    .sort((a, b) => a.outlet - b.outlet || b.qty - a.qty)
}

// Se pregunta de donde sale solo si hay que elegir: esta en varios lugares,
// o lo que hay esta en el outlet (que una salida automatica no toca)
export function asksFrom(places) {
  return places.length > 1 || places.some((x) => x.outlet)
}

const qtyAt = (p, id) => (p?.stock || []).find((s) => s.location_id === id)?.qty || 0

// Cuanto se puede sacar: sin elegir, todo menos el outlet; eligiendo una
// ubicacion del outlet, tambien lo que hay ahi
export function outAvailable(p, outlet, from) {
  const usable = (p?.stock || []).reduce((t, s) => t + (outlet?.has(s.location_id) ? 0 : s.qty), 0)
  return from && outlet?.has(from) ? usable + qtyAt(p, from) : usable
}

// La salida en partes: primero de la ubicacion elegida (lo que haya ahi) y,
// si no alcanza, el resto de donde haya. [{ qty, loc }] (loc '' = donde haya)
export function outParts(qty, from, p) {
  if (!from) return [{ qty, loc: '' }]
  const first = Math.min(qty, qtyAt(p, from))
  return [first > 0 && { qty: first, loc: from }, qty - first > 0 && { qty: qty - first, loc: '' }].filter(Boolean)
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
