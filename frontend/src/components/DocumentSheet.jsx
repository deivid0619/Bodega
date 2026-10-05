import { useMemo, useState } from 'react'
import { useLayout, usePolling, useProducts } from '../hooks/useApi'
import { sizeRank, fmtTime } from '../utils'
import Sheet, { SheetHeader } from './Sheet'
import Icon from './Icon'
import { Empty, SearchField, plural } from './Bits'

export const docTitle = (d) => (d.kind === 'factura' ? `Factura ${d.number}`
  : d.number.startsWith('SN-') ? 'Remisión sin número' : `Remisión ${d.number}`)

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Lo que dice una remision o una factura ya aplicada: datos del papel y
// cada prenda con su talla, cuantas y a donde fue (o de donde salio).
function Detail({ doc }) {
  const { data: products } = useProducts()
  const { data: layout } = useLayout()
  const locName = useMemo(() => new Map((layout?.elements || []).flatMap((e) => e.locations || []).map((l) => [l.id, l.name])), [layout])
  const bySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const isRem = doc.kind === 'remision'
  const created = new Date(doc.created_at)

  const groups = useMemo(() => {
    const map = new Map()
    for (const l of doc.lines || []) {
      const p = l.sku ? bySku.get(l.sku) : null
      const name = l.name || p?.name || l.sku
      if (!map.has(name)) map.set(name, [])
      map.get(name).push({ ...l, size: l.size ?? p?.size ?? '' })
    }
    for (const rows of map.values()) rows.sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
    return [...map]
  }, [doc, bySku])

  const where = (l) => {
    if (!isRem) return l.location_id ? `Salió de ${l.location_id}` : 'Salió de donde había'
    if (!l.qty) return 'No llegó'
    if (l.dest === 'reserva') return 'Quedó en la reserva'
    return `Quedó en ${locName.get(l.location_id) || l.location_id || 'la bodega'}`
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className={`tag ${isRem ? 'tag-in' : 'tag-out'}`}>{isRem ? 'Entrada' : 'Salida'}</span></div>}
        title={docTitle(doc)}
        subtitle={`Registrada el ${created.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} a las ${created.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })} · ${doc.user_name}`}
      />
      <div className="doc-meta">
        <div><span>{isRem ? 'Entraron' : 'Salieron'}</span><b>{doc.units}</b></div>
        {isRem && doc.pending > 0 && <div><span>Quedaron debiendo</span><b className="warn">{doc.pending}</b></div>}
        {doc.supplier && <div><span>Proveedor</span><b>{doc.supplier}</b></div>}
        {doc.doc_date && <div><span>Fecha del papel</span><b>{fmtDay(doc.doc_date)}</b></div>}
      </div>
      {doc.notes && <p className="doc-notes"><Icon name="pencil" size={15} />{doc.notes}</p>}

      <h3 className="h-sec">Prendas</h3>
      <div className="card panel">
        {groups.map(([name, rows]) => (
          <div className="doc-group" key={name}>
            <b>{name}</b>
            {rows.map((l, i) => (
              <div className="doc-row" key={`${l.sku || l.size}-${i}`}>
                <span className="sz">{l.size || 'U'}</span>
                <span className="doc-row-t">
                  {where(l)}
                  {l.sku && <small className="mono">{l.sku}</small>}
                  {l.pending > 0 && <small className="warn">Quedaron debiendo {l.pending}</small>}
                </span>
                <b className={`doc-row-q ${isRem ? 'in' : 'out'}`}>{isRem ? `+${l.qty}` : `−${l.qty}`}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

export default function DocumentSheet({ doc, onClose }) {
  return (
    <Sheet modal onClose={onClose} label={docTitle(doc)}>
      <Detail doc={doc} />
    </Sheet>
  )
}

// Todas las remisiones (o facturas), con busqueda por numero, proveedor,
// notas, referencia o codigo. Tocar una abre su detalle.
function All({ kind, onOpen }) {
  const { data } = usePolling(`/api/documents?kind=${kind}&limit=200`, { interval: 60000 })
  const [q, setQ] = useState('')
  const term = q.trim().toUpperCase()
  const list = (data || []).filter((d) => !term || [d.number, d.supplier, d.notes, ...(d.lines || []).flatMap((l) => [l.name, l.sku])]
    .some((v) => String(v || '').toUpperCase().includes(term)))
  const isRem = kind === 'remision'
  return (
    <>
      <SheetHeader title={isRem ? 'Remisiones recibidas' : 'Facturas descontadas'} subtitle={data ? plural(data.length, isRem ? 'remisión' : 'factura', isRem ? 'remisiones' : 'facturas') : 'Cargando…'} />
      <SearchField value={q} onChange={setQ} placeholder={isRem ? 'Número, proveedor, nota o prenda' : 'Número o prenda'} />
      <div className="card panel" style={{ marginTop: 12 }}>
        {!data ? <div className="skeleton" /> : list.length ? list.map((d) => (
          <button type="button" className="need doc-item" key={d.id} onClick={() => onOpen(d)}>
            <span className="need-t">
              <b className={d.number.startsWith('SN-') ? '' : 'mono'}>{d.number.startsWith('SN-') ? 'Sin número' : d.number}</b>
              <small>{[d.supplier, d.user_name, fmtTime(d.created_at)].filter(Boolean).join(' · ')}</small>
            </span>
            <span className={`need-q ${isRem ? '' : 'dark'}`}><b>{d.units}</b><span>{isRem ? 'entraron' : 'salieron'}</span></span>
          </button>
        )) : <Empty icon="search" title="Nada coincide">Prueba con otra palabra.</Empty>}
      </div>
    </>
  )
}

export function DocumentsSheet({ kind, onClose }) {
  const [open, setOpen] = useState(null)
  return (
    <Sheet modal onClose={onClose} label="Documentos">
      <All kind={kind} onOpen={setOpen} />
      {open && <DocumentSheet doc={open} onClose={() => setOpen(null)} />}
    </Sheet>
  )
}
