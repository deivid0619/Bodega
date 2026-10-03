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
  if (dt.toDateString() === today.toDateString()) return dt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dt.toDateString() === yesterday.toDateString()) return 'ayer'
  return dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
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
