// El PDF de una remision (la orden con sus entregas): que llego de cada
// referencia y talla, que falta y donde quedo. Se arma en el celular en el
// momento y se descarga o se comparte; no se guarda en ningun lado.
// summary: lo que da orderSummary(). jsPDF se carga solo al pedirlo.

const INK = [11, 11, 11]
const LIME = [192, 255, 0]
const GRAY = [115, 118, 111]
const LINE = [222, 226, 218]
const SOFT = [243, 246, 239]
const WARN = [201, 3, 3]

const fmtDay = (iso) => {
  const s = String(iso || '')
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(...s.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) : new Date(s)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export async function remisionPdf(summary, { title, registered }) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'letter' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const M = 14
  const cols = [
    { key: 'name', label: 'Referencia', w: 62 },
    { key: 'size', label: 'Talla', w: 14 },
    { key: 'sku', label: 'Código', w: 33 },
    { key: 'arrived', label: 'Llegó', w: 15, right: true },
    { key: 'pending', label: 'Falta', w: 15, right: true },
    { key: 'where', label: 'Quedó en', w: W - 2 * M - 139 },
  ]
  let y = M

  const text = (s, x, yy, { size = 10, bold = false, color = INK, align } = {}) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(...color)
    pdf.text(String(s), x, yy, align ? { align } : undefined)
  }

  // encabezado: la marca y el titulo
  pdf.setFillColor(...INK)
  pdf.rect(0, 0, W, 24, 'F')
  pdf.setFillColor(...LIME)
  pdf.rect(0, 24, W, 1.2, 'F')
  text('Pigmalion · Bodega', M, 9, { size: 9, color: [185, 189, 182] })
  text(title, M, 18, { size: 17, bold: true, color: [255, 255, 255] })
  y = 33

  const info = [
    summary.supplier && `Proveedor: ${summary.supplier}`,
    registered && `Registrada: ${registered}`,
  ].filter(Boolean)
  if (info.length) {
    text(info.join('   ·   '), M, y, { size: 9.5, color: GRAY })
    y += 6
  }
  if (summary.deliveries.length > 1) {
    const list = summary.deliveries.map((d) => `${d.number} (${fmtDay(d.date)}: ${d.units} ${d.units === 1 ? 'prenda' : 'prendas'})`).join('  ·  ')
    const lines = pdf.splitTextToSize(`Entregas: ${list}`, W - 2 * M)
    text(lines.join('\n'), M, y, { size: 9.5, color: GRAY })
    y += lines.length * 4.4 + 1.5
  }

  // los totales, grandes
  const box = (label, value, x, color) => {
    pdf.setFillColor(...SOFT)
    pdf.roundedRect(x, y, 56, 17, 2.5, 2.5, 'F')
    text(label, x + 4, y + 6, { size: 8.5, color: GRAY })
    text(value, x + 4, y + 14, { size: 15, bold: true, color })
  }
  box('Llegaron', `${summary.arrived} ${summary.arrived === 1 ? 'prenda' : 'prendas'}`, M, INK)
  box('Faltan por llegar', `${summary.pending}`, M + 60, summary.pending ? WARN : INK)
  y += 24

  // la tabla: una fila por talla, la referencia en la primera de cada una
  const head = () => {
    pdf.setFillColor(...INK)
    pdf.rect(M, y, W - 2 * M, 7.5, 'F')
    let x = M
    for (const c of cols) {
      text(c.label, c.right ? x + c.w - 2 : x + 2, y + 5, { size: 8.5, bold: true, color: [255, 255, 255], align: c.right ? 'right' : undefined })
      x += c.w
    }
    y += 7.5
  }
  head()
  summary.refs.forEach((ref, gi) => {
    ref.rows.forEach((r, i) => {
      const name = i === 0 ? pdf.setFont('helvetica', 'bold').setFontSize(9).splitTextToSize(ref.name, cols[0].w - 4) : []
      const where = pdf.setFont('helvetica', 'normal').setFontSize(8.5).splitTextToSize(r.where || '—', cols[5].w - 4)
      const h = Math.max(6.5, 2.6 + Math.max(name.length, where.length, 1) * 4)
      if (y + h > H - 18) {
        pdf.addPage()
        y = M
        head()
      }
      if (gi % 2 === 1) {
        pdf.setFillColor(...SOFT)
        pdf.rect(M, y, W - 2 * M, h, 'F')
      }
      let x = M
      const base = y + 4.4
      if (name.length) text(name.join('\n'), x + 2, base, { size: 9, bold: true })
      x += cols[0].w
      text(r.size || 'Única', x + 2, base, { size: 9 })
      x += cols[1].w
      text(r.sku || '—', x + 2, base, { size: 8.5, color: GRAY })
      x += cols[2].w
      text(r.arrived, x + cols[3].w - 2, base, { size: 9.5, bold: true, align: 'right' })
      x += cols[3].w
      text(r.pending || '—', x + cols[4].w - 2, base, { size: 9.5, bold: !!r.pending, color: r.pending ? WARN : GRAY, align: 'right' })
      x += cols[4].w
      text(where.join('\n'), x + 2, base, { size: 8.5, color: GRAY })
      y += h
      pdf.setDrawColor(...LINE)
      pdf.setLineWidth(0.2)
      pdf.line(M, y, W - M, y)
    })
  })

  // las notas del papel
  if (summary.notes.length) {
    const lines = pdf.setFont('helvetica', 'normal').setFontSize(9.5).splitTextToSize(`Notas: ${summary.notes.join(' · ')}`, W - 2 * M)
    if (y + 8 + lines.length * 4.4 > H - 18) {
      pdf.addPage()
      y = M
    }
    y += 8
    text(lines.join('\n'), M, y, { size: 9.5, color: INK })
  }

  // al pie de cada hoja: cuando se genero y la pagina
  const now = new Date().toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const pages = pdf.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    text(`Generado el ${now} · no se guarda: se arma con lo registrado en la app`, M, H - 8, { size: 7.5, color: GRAY })
    text(`Página ${p} de ${pages}`, W - M, H - 8, { size: 7.5, color: GRAY, align: 'right' })
  }
  return pdf.output('blob')
}
