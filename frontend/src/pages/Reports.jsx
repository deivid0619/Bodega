import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolling } from '../hooks/useApi'
import Icon from '../components/Icon'
import { Empty, PageHead, plural } from '../components/Bits'

const weekLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
}
const DAY = 86_400_000

// barra con la punta redondeada (4px) y la base recta
function bar(x, y0, w, h, up) {
  if (h <= 0) return ''
  const r = Math.min(4, h, w / 2)
  return up
    ? `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + w - r} Q${x + w},${y0 - h} ${x + w},${y0 - h + r} V${y0} Z`
    : `M${x},${y0} V${y0 + h - r} Q${x},${y0 + h} ${x + r},${y0 + h} H${x + w - r} Q${x + w},${y0 + h} ${x + w},${y0 + h - r} V${y0} Z`
}

// Entradas hacia arriba y salidas hacia abajo, en la misma escala: cada
// semana se lee como un flujo. Tocar una semana muestra sus numeros.
function FlowChart({ weeks }) {
  // la semana que se muestra al abrir: la ultima con movimiento (un lunes temprano la actual esta en cero)
  const [active, setActive] = useState(() => {
    for (let i = weeks.length - 1; i >= 0; i--) if (weeks[i].in + weeks[i].out > 0) return i
    return weeks.length - 1
  })
  const box = useRef(null)
  const [W, setW] = useState(311)
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const H = 190, top = 18, bottom = 26
  const maxIn = Math.max(...weeks.map((w) => w.in))
  const maxOut = Math.max(...weeks.map((w) => w.out))
  const s = (H - top - bottom) / Math.max(1, maxIn + maxOut)
  const base = top + maxIn * s
  const band = W / weeks.length
  const bw = Math.min(24, band * 0.56)
  const a = weeks[active]

  return (
    <div className="flow" ref={box}>
      <div className="flow-legend" aria-hidden="true">
        <span><i className="in" />Entradas</span>
        <span><i className="out" />Salidas</span>
      </div>
      <p className="flow-readout" aria-live="polite">
        <span>Semana del {weekLabel(a.week)}</span>
        <b>{a.in}</b> entraron · <b>{a.out}</b> salieron
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="flow-svg" role="img" aria-label="Prendas que entraron y salieron por semana">
        <line x1="0" x2={W} y1={base} y2={base} className="flow-base" />
        {weeks.map((w, i) => {
          const x = i * band + (band - bw) / 2
          const on = i === active
          return (
            <g key={w.week} className={on ? 'on' : ''}>
              {on && <rect x={i * band + 2} y={top - 14} width={band - 4} height={H - top - bottom + 26} rx="4" className="flow-hl" />}
              <path d={bar(x, base - 1, bw, w.in * s - 1, true)} className="flow-in" />
              <path d={bar(x, base + 1, bw, w.out * s - 1, false)} className="flow-out" />
              {on && w.in > 0 && <text x={x + bw / 2} y={base - w.in * s - 5} className="flow-val">{w.in}</text>}
              {on && w.out > 0 && <text x={x + bw / 2} y={base + w.out * s + 13} className="flow-val">{w.out}</text>}
              {(i % 2 === (weeks.length - 1) % 2) && <text x={i * band + band / 2} y={H - 6} className="flow-x">{weekLabel(w.week)}</text>}
              <rect
                x={i * band} y="0" width={band} height={H} className="flow-hit"
                tabIndex={0}
                role="button"
                aria-label={`Semana del ${weekLabel(w.week)}: entraron ${w.in}, salieron ${w.out}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => setActive(i)}
                onFocus={() => setActive(i)}
              />
            </g>
          )
        })}
      </svg>
      <details className="flow-table">
        <summary>Ver como tabla</summary>
        <table>
          <thead><tr><th>Semana del</th><th>Entraron</th><th>Salieron</th></tr></thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr key={w.week}><td>{weekLabel(w.week)}</td><td>{w.in}</td><td>{w.out}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

export default function Reports() {
  const navigate = useNavigate()
  const [days, setDays] = useState(60)
  const { data: weeks } = usePolling('/api/reports/weekly?weeks=8', { interval: 60000 })
  const { data: dead } = usePolling(`/api/reports/dead?days=${days}`, { interval: 60000 })
  const totals = useMemo(() => (weeks || []).reduce((t, w) => ({ in: t.in + w.in, out: t.out + w.out }), { in: 0, out: 0 }), [weeks])
  const stuck = (dead || []).reduce((t, d) => t + d.product.qty, 0)

  return (
    <section className="page" aria-label="Reportes">
      <div className="page-inner">
        <PageHead title="Reportes" lede="Cómo se mueve la bodega.">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/summary')}>Resumen</button>
        </PageHead>

        <h2 className="h-sec">Entradas y salidas <small>últimas 8 semanas</small></h2>
        {!weeks ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : totals.in + totals.out > 0 ? (
          <div className="card panel-pad">
            <FlowChart weeks={weeks} />
            <p className="flow-total">En 8 semanas entraron <b>{totals.in}</b> y salieron <b>{totals.out}</b> prendas.</p>
          </div>
        ) : (
          <Empty icon="summary" title="Sin movimientos todavía">Cuando entren y salgan prendas, aquí verás cada semana.</Empty>
        )}

        <h2 className="h-sec">Lo que no se mueve</h2>
        <div className="chips" style={{ marginTop: 0 }} role="toolbar" aria-label="Sin salir desde hace">
          {[30, 60, 90].map((d) => (
            <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{d} días</button>
          ))}
        </div>
        {!dead ? (
          <div className="skeleton" />
        ) : dead.length ? (
          <>
            <p className="mode-hint" style={{ margin: '8px 4px 10px' }}>
              {plural(stuck, 'prenda', 'prendas')} sin salir en {days} días. Considera exhibirlas o no volver a pedirlas.
            </p>
            <div className="card panel">
              {dead.map(({ product: p, last_out: last }) => (
                <div className="need" key={p.sku}>
                  <div className="need-t">
                    <b>{p.name}{p.size ? ` · ${p.size}` : ''}</b>
                    <small>
                      {p.stock?.length ? p.stock.map((s) => s.location_id).join(', ') : p.location_id}
                      {' · '}{last ? `última salida hace ${Math.floor((Date.now() - new Date(last).getTime()) / DAY)} días` : 'nunca ha salido'}
                    </small>
                  </div>
                  <div className="need-q idle"><b>{p.qty}</b><span>paradas</span></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Empty icon="check" title="Todo se está moviendo">Ninguna prenda lleva {days} días sin salir.</Empty>
        )}
      </div>
    </section>
  )
}
