import { useMemo, useState } from 'react'
import { usePolling } from '../../core/useApi'
import { DocItem } from './DocumentSheet'
import Icon from '../../ui/Icon'
import { plural } from '../../ui/Bits'

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
// cuantas hay guardadas, para los botones de ver todas
const saved = (n, one, many) => (n == null ? 'Ver y buscar' : n === 0 ? 'Ninguna todavía' : `${n} ${n === 1 ? one : many} · ver y buscar`)
const hour = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })

// Lo que dice un dia para quien no ve la pantalla
function dayLabel(date, info) {
  const what = []
  if (info?.remisiones) what.push(`entraron ${info.units_in} con ${info.remisiones === 1 ? 'una remisión' : `${info.remisiones} remisiones`}`)
  if (info?.facturas) what.push(`salieron ${info.units_out} con ${info.facturas === 1 ? 'una factura' : `${info.facturas} facturas`}`)
  const day = date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  return what.length ? `${day}: ${what.join(' y ')}` : day
}

// El apartado de remisiones y facturas del Resumen: el calendario del mes con
// lo que entro con remision (+) y lo que salio con factura (−) cada dia.
// Tocar un dia muestra sus papeles; tocar uno abre su detalle (con la foto).
// Abajo, todas las remisiones o todas las facturas, con buscador.
export default function DocsSection({ onOpen, onList }) {
  const today = isoDay(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [day, setDay] = useState(today)
  const { data: cal } = usePolling(`/api/documents/calendar?month=${month}`, { interval: 60000 })
  const { data: counts } = usePolling('/api/documents/counts', { interval: 60000 })
  const { data: rems } = usePolling(`/api/documents?kind=remision&day=${day}&limit=50`, { interval: 60000 })
  const { data: facts } = usePolling(`/api/documents?kind=factura&day=${day}&limit=50`, { interval: 60000 })
  const byDay = useMemo(() => new Map((cal || []).map((d) => [d.day, d])), [cal])

  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const blanks = (first.getDay() + 6) % 7 // la semana empieza el lunes
  const size = new Date(y, m, 0).getDate()
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  const [sy, sm, sd] = day.split('-').map(Number)
  const selDate = new Date(sy, sm - 1, sd)
  const both = [...(rems || []), ...(facts || [])]
  // el total del dia elegido sale de sus papeles (asi sirve aunque se este viendo otro mes)
  const units = (list) => (list || []).reduce((t, d) => t + d.units, 0)

  return (
    <>
      <h2 className="h-sec" id="documentos">Remisiones y facturas <small>toca un día</small></h2>
      {counts?.espera > 0 && (
        <button type="button" className="doc-card wait-card" onClick={() => onList('espera')}>
          <span className="doc-ico"><Icon name="receipt" size={22} /></span>
          <span className="doc-card-t">
            <b>{plural(counts.espera, 'pedido espera', 'pedidos esperan')} su factura</b>
            <small>Ya salieron del inventario: ábrelos para anexar el número y la foto</small>
          </span>
          <Icon name="arrowRight" size={18} />
        </button>
      )}
      <div className="cal card">
        <div className="cal-head">
          <button type="button" className="cal-nav prev" onClick={() => shift(-1)} aria-label="Mes anterior">
            <Icon name="arrowRight" size={18} stroke={2.4} />
          </button>
          <b aria-live="polite">{cap(first.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }))}</b>
          <button type="button" className="cal-nav" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)} aria-label="Mes siguiente">
            <Icon name="arrowRight" size={18} stroke={2.4} />
          </button>
        </div>
        <div className="cal-grid">
          {WEEK.map((w, i) => <span key={i} className="cal-w" aria-hidden="true">{w}</span>)}
          {Array.from({ length: blanks }, (_, i) => <span key={`v${i}`} aria-hidden="true" />)}
          {Array.from({ length: size }, (_, i) => {
            const iso = `${month}-${pad(i + 1)}`
            const info = byDay.get(iso)
            return (
              <button
                key={iso}
                type="button"
                className={`cal-day${iso === day ? ' sel' : ''}${iso === today ? ' today' : ''}`}
                aria-pressed={iso === day}
                aria-label={dayLabel(new Date(y, m - 1, i + 1), info)}
                disabled={iso > today}
                onClick={() => setDay(iso)}
              >
                <span className="cal-n">{i + 1}</span>
                {info?.remisiones > 0 && <span className="cal-in">+{info.units_in}</span>}
                {info?.facturas > 0 && <span className="cal-out">−{info.units_out}</span>}
              </button>
            )
          })}
        </div>
        <div className="cal-key" aria-hidden="true">
          <span><i className="in" />Entró con remisión</span>
          <span><i className="out" />Salió con factura</span>
        </div>
      </div>

      <div className="cal-sel">
        <b>{cap(selDate.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }))}{day === today ? ' · hoy' : ''}</b>
        {both.length > 0 && (
          <small>
            {[rems?.length > 0 && `entraron ${units(rems)}`, facts?.length > 0 && `salieron ${units(facts)}`].filter(Boolean).join(' · ')}
          </small>
        )}
      </div>
      {!rems || !facts ? (
        <div className="skeleton" style={{ height: 72 }} />
      ) : both.length ? (
        <div className="card panel">
          {both.map((d) => <DocItem key={d.id} doc={d} onOpen={onOpen} time={hour} />)}
        </div>
      ) : (
        <p className="cal-none">{day === today ? 'Hoy todavía no' : 'Ese día no'} entró nada con remisión ni salió con factura.</p>
      )}
      <div className="doc-cards doc-all">
        <button type="button" className="doc-card light" onClick={() => onList('remision')}>
          <span className="doc-ico in"><Icon name="boxIn" size={22} /></span>
          <span className="doc-card-t"><b>Remisiones</b><small>{saved(counts?.remision, 'guardada', 'guardadas')}</small></span>
        </button>
        <button type="button" className="doc-card light" onClick={() => onList('factura')}>
          <span className="doc-ico out"><Icon name="receipt" size={22} /></span>
          <span className="doc-card-t"><b>Facturas</b><small>{saved(counts?.factura, 'guardada', 'guardadas')}</small></span>
        </button>
      </div>
    </>
  )
}
