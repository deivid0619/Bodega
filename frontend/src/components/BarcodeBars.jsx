// Barritas decorativas que imitan un código de barras, generadas siempre
// igual a partir del texto (no son un código de barras real y escaneable,
// solo el estilo visual de la etiqueta de la prenda).
export default function BarcodeBars({ code }) {
  const str = String(code || '')
  const bars = []
  for (let i = 0; i < 38; i++) {
    const c = str.charCodeAt(i % str.length) * (i + 3) + i * 13
    bars.push({ w: 1 + (c % 3), m: 1 + ((c >> 3) % 3) })
  }
  return (
    <div className="bars" aria-hidden="true">
      {bars.map((b, i) => (
        <i key={i} style={{ width: b.w, marginRight: b.m }} />
      ))}
    </div>
  )
}
