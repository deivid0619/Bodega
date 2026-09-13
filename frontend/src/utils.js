const SIZE_RE = /(XXXL|XXL|4XL|3XL|2XL|XL|XS|S|M|L)$/

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
  const hm = dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  if (dt.toDateString() === today.toDateString()) return `hoy ${hm}`
  return dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ' ' + hm
}

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
