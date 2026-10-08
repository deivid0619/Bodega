import { useMemo, useState } from 'react'
import { usePolling } from '../../core/useApi'
import { pedidoLabel } from '../../core/utils'
import Sheet, { SheetHeader } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { plural } from '../../ui/Bits'
import { DocItem } from './DocumentSheet'

// El calendario de remisiones y facturas en grande: el mes con cada papel
// en su dia (numero y cuanto entro o salio), y el total del mes. En el
// computador como calendario; en el celular, el mes como lista por dia
// (siete columnas no alcanzan para tanta informacion).

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const hour = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
const MAX_IN_CELL = 4

// como se nombra un papel en el calendario
function docName(d) {
  if (d.status === 'espera') return pedidoLabel(d)
  if (d.number.startsWith('SN-')) return d.supplier || 'Sin número'
  return d.number
}

function Chip({ doc, onOpen }) {
  const rem = doc.kind === 'remision'
  return (
    <button type="button" className={`bc-doc ${rem ? 'in' : 'out'}${doc.mode === 'registro' ? ' rec' : ''}`} onClick={() => onOpen(doc)}
            title={`${rem ? 'Remisión' : 'Factura'} ${docName(doc)}: ${doc.units} ${rem ? 'entraron' : 'salieron'}`}>
      <span className="bc-doc-n">{docName(doc)}</span>
      <b>{rem ? '+' : '−'}{doc.units}</b>
    </button>
  )
}

export default function BigCalendar({ month: startMonth, onOpen, onClose }) {
  const today = isoDay(new Date())
  const [month, setMonth] = useState(startMonth || today.slice(0, 7))
  const [sel, setSel] = useState(null)
  const { data: cal } = usePolling(`/api/documents/calendar?month=${month}`, { interval: 60000 })
  const { data: rems } = usePolling(`/api/documents?kind=remision&month=${month}&limit=200`, { interval: 60000 })
  const { data: facts } = usePolling(`/api/documents?kind=factura&month=${month}&limit=200`, { interval: 60000 })
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches

  const byDay = useMemo(() => {
    const m = new Map()
    for (const d of [...(rems || []), ...(facts || [])]) {
      const k = isoDay(new Date(d.created_at))
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(d)
    }
    for (const list of m.values()) list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    return m
  }, [rems, facts])
  const totals = useMemo(() => (cal || []).reduce((t, d) => ({
    rem: t.rem + d.remisiones, fac: t.fac + d.facturas, uin: t.uin + d.units_in, uout: t.uout + d.units_out,
  }), { rem: 0, fac: 0, uin: 0, uout: 0 }), [cal])

  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const blanks = (first.getDay() + 6) % 7
  const size = new Date(y, m, 0).getDate()
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1)
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
    setSel(null)
  }
  const loading = !rems || !facts
  const summary = !cal ? 'Cargando…' : totals.rem + totals.fac
    ? [totals.rem && `Entraron ${totals.uin} con ${plural(totals.rem, 'remisión', 'remisiones')}`,
       totals.fac && `salieron ${totals.uout} con ${plural(totals.fac, 'factura', 'facturas')}`].filter(Boolean).join(' · ')
    : 'Este mes no entró nada con remisión ni salió con factura.'
  const dayTitle = (iso) => cap(new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }))
  const dayTotals = (list) => {
    const inn = list.filter((d) => d.kind === 'remision').reduce((t, d) => t + d.units, 0)
    const out = list.filter((d) => d.kind === 'factura').reduce((t, d) => t + d.units, 0)
    return [inn && `+${inn}`, out && `−${out}`].filter(Boolean).join(' · ')
  }
  const days = [...byDay.keys()].sort().reverse()

  return (
    <Sheet modal size="wide" onClose={onClose} label="Calendario de remisiones y facturas">
      <SheetHeader title={cap(first.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }))} subtitle={summary} />
      <div className="bc-nav">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-1)}><Icon name="arrowRight" size={16} stroke={2.4} className="flip" />Mes anterior</button>
        {month !== today.slice(0, 7) && <button type="button" className="link-btn" onClick={() => { setMonth(today.slice(0, 7)); setSel(null) }}>Este mes</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)}>Mes siguiente<Icon name="arrowRight" size={16} stroke={2.4} /></button>
      </div>

      {wide ? (
        <>
          <div className="bc-grid" role="grid" aria-label="Calendario del mes">
            {WEEK.map((w) => <span key={w} className="bc-w" role="columnheader">{w}</span>)}
            {Array.from({ length: blanks }, (_, i) => <span key={`v${i}`} className="bc-blank" aria-hidden="true" />)}
            {Array.from({ length: size }, (_, i) => {
              const iso = `${month}-${pad(i + 1)}`
              const list = byDay.get(iso) || []
              const extra = list.length - MAX_IN_CELL
              return (
                <div key={iso} role="gridcell" className={`bc-day${iso === today ? ' today' : ''}${iso === sel ? ' sel' : ''}${iso > today ? ' future' : ''}`}>
                  <button type="button" className="bc-day-head" onClick={() => setSel(iso === sel ? null : iso)} disabled={!list.length}
                          aria-label={`${dayTitle(iso)}${list.length ? `: ${plural(list.length, 'papel', 'papeles')}` : ''}`}>
                    <span className="bc-n">{i + 1}</span>
                    {list.length > 0 && <small>{dayTotals(list)}</small>}
                  </button>
                  {list.slice(0, MAX_IN_CELL).map((d) => <Chip key={d.id} doc={d} onOpen={onOpen} />)}
                  {extra > 0 && <button type="button" className="bc-more" onClick={() => setSel(iso)}>{extra} más</button>}
                </div>
              )
            })}
          </div>
          <div className="cal-key bc-key" aria-hidden="true">
            <span><i className="in" />Entró con remisión</span>
            <span><i className="out" />Salió con factura</span>
            <span><i className="rec" />Solo registro</span>
          </div>
          {sel && (byDay.get(sel) || []).length > 0 && (
            <section className="bc-sel">
              <h3 className="h-sec">{dayTitle(sel)} <small>{dayTotals(byDay.get(sel))}</small></h3>
              <div className="card panel">{byDay.get(sel).map((d) => <DocItem key={d.id} doc={d} onOpen={onOpen} time={hour} />)}</div>
            </section>
          )}
        </>
      ) : loading ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : days.length ? (
        days.map((iso) => (
          <section key={iso} className="bc-agenda-day">
            <h3 className="h-sec">{dayTitle(iso)}{iso === today ? ' · hoy' : ''} <small>{dayTotals(byDay.get(iso))}</small></h3>
            <div className="card panel">{byDay.get(iso).map((d) => <DocItem key={d.id} doc={d} onOpen={onOpen} time={hour} />)}</div>
          </section>
        ))
      ) : (
        <p className="cal-none">Este mes no entró nada con remisión ni salió con factura.</p>
      )}
    </Sheet>
  )
}
