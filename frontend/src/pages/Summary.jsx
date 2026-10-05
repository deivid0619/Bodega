import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { refreshInventory, useMovements, useNeeds, usePolling, useProducts, useReserve, useTop } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { api, ApiError } from '../api'
import { downloadCsv, fmtTime } from '../utils'
import Icon from '../components/Icon'
import ResetSheet from '../components/ResetSheet'
import DocumentSheet, { DocumentsSheet } from '../components/DocumentSheet'
import { Count, Empty, PageHead, plural } from '../components/Bits'

const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado' }
const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const today = () => new Date().toISOString().slice(0, 10)
const baseOf = (p) => (p.size && p.sku.endsWith(p.size) ? p.sku.slice(0, -p.size.length) : p.sku)

export default function Summary() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const showToast = useToast()
  const { data: needs } = useNeeds()
  const { data: top } = useTop()
  const { data: products } = useProducts()
  const { data: reserve } = useReserve()
  const { data: facturas } = usePolling('/api/documents?kind=factura&limit=5', { interval: 30000 })
  const { data: remisiones } = usePolling('/api/documents?kind=remision&limit=5', { interval: 30000 })
  const { data: passing } = usePolling('/api/reports/dispatch', { interval: 20000 })
  const [filter, setFilter] = useState('all')
  const { data: moves } = useMovements(filter)
  const [resetting, setResetting] = useState(false)
  const [docOpen, setDocOpen] = useState(null)
  const [docList, setDocList] = useState(null)
  const [demoOn, setDemoOn] = useState(null)

  const kpi = useMemo(() => ({
    // lo que esta de paso (Despacho) no es de la bodega
    units: (products || []).reduce((s, p) => s + p.qty, 0) - (passing || []).reduce((s, d) => s + d.qty, 0),
    refs: new Set((products || []).map(baseOf)).size,
    reserve: (reserve || []).reduce((s, i) => s + i.qty, 0),
    needs: needs?.length || 0,
    toOrder: (needs || []).filter((n) => n.order_qty > 0).length,
  }), [products, reserve, needs, passing])
  const maxTop = Math.max(1, ...(top || []).map((t) => t.qty_out))
  const date = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })

  const orderText = () => {
    const d = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    const lines = (needs || []).filter((n) => n.order_qty > 0).map((n) => `${n.product.name}${n.product.size ? ' talla ' + n.product.size : ''} (${n.product.sku}): pedir ${n.order_qty}, hay ${n.product.qty}`)
    return `Pedido bodega ${d}\n\n${lines.join('\n')}`
  }
  const copyOrder = async () => {
    try {
      await navigator.clipboard.writeText(orderText())
      showToast('Pedido copiado. Pégalo en WhatsApp o en un correo.')
    } catch {
      showToast('Este dispositivo no dejó copiar. Usa “Descargar”.', 'err')
    }
  }
  const exportCsv = async (path, name) => {
    try {
      downloadCsv(await api.get(path), name)
    } catch {
      showToast('No se pudo descargar el archivo.', 'err')
    }
  }
  const copyInventory = async () => {
    try {
      await navigator.clipboard.writeText(await api.get('/api/reports/inventory.csv'))
      showToast('Inventario copiado. Pégalo en Excel o Google Sheets.')
    } catch {
      showToast('Este dispositivo no dejó copiar. Usa “Descargar”.', 'err')
    }
  }
  const syncPhotos = async () => {
    try {
      const r = await api.post('/api/catalog/sync-images')
      refreshInventory()
      showToast(r.updated ? `${plural(r.updated, 'foto agregada', 'fotos agregadas')} desde la tienda` : 'Las prendas de la tienda ya tienen su foto')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo leer la tienda.', 'err')
    }
  }
  const toggleDemo = async () => {
    try {
      const res = await api.post('/api/reports/demo')
      setDemoOn(res.demo)
      showToast(res.demo ? 'Datos de prueba cargados' : 'Datos de prueba quitados')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo cambiar los datos de prueba.', 'err')
    }
  }

  return (
    <section className="page" aria-label="Resumen">
      <div className="page-inner">
        <PageHead title="Resumen" lede={date.charAt(0).toUpperCase() + date.slice(1)} />

        <div className="kpis">
          <div className="kpi dark"><b>{products ? <Count value={kpi.units} /> : '–'}</b><span>prendas en bodega</span></div>
          <div className="kpi"><b>{products ? <Count value={kpi.refs} /> : '–'}</b><span>referencias</span></div>
          <button className="kpi" onClick={() => navigate('/reserve')}><b>{reserve ? <Count value={kpi.reserve} /> : '–'}</b><span>en reserva</span></button>
          <a className={`kpi ${kpi.needs ? 'warn' : ''}`} href="#reponer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <b>{needs ? <Count value={kpi.needs} /> : '–'}</b><span>por reponer</span>
          </a>
        </div>

        <button className="doc-card report-card" onClick={() => navigate('/reports')}>
          <span className="doc-ico"><Icon name="summary" size={22} /></span>
          <span className="doc-card-t"><b>Reportes</b><small>Entradas y salidas por semana, y lo que no se mueve</small></span>
          <Icon name="arrowRight" size={18} />
        </button>

        <h2 className="h-sec" id="reponer">Por reponer {needs?.length > 0 && <small>lleva cada talla al doble del mínimo</small>}</h2>
        {!needs ? (
          <div className="skeleton" />
        ) : needs.length ? (
          <>
            <div className="card panel">
              {needs.map((n) => (
                <div className="need" key={n.product.sku}>
                  <div className="need-t">
                    <b>{n.product.name}{n.product.size ? ` · ${n.product.size}` : ''}</b>
                    <small>Hay {n.product.qty} · mínimo {n.product.min_qty}{n.product.stock?.length ? ` · ${n.product.stock.map((s) => s.location_id).join(', ')}` : ''}</small>
                    {n.in_reserve > 0 && (
                      <button className="link-btn need-link" onClick={() => navigate('/reserve')}>
                        <Icon name="reserve" size={14} stroke={2.2} />{n.in_reserve} en la reserva: traerlas
                      </button>
                    )}
                  </div>
                  {n.order_qty > 0 ? (
                    <div className="need-q"><b>{n.order_qty}</b><span>pedir</span></div>
                  ) : (
                    <div className="need-q dark"><b>{Math.min(n.in_reserve, Math.max(1, n.product.min_qty * 2 - n.product.qty))}</b><span>traer</span></div>
                  )}
                </div>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn btn-lime" onClick={copyOrder} disabled={!kpi.toOrder}><Icon name="copy" size={18} />Copiar pedido</button>
              <button className="btn btn-ghost" onClick={() => exportCsv('/api/reports/inventory.csv', `pedido-${today()}.csv`)}><Icon name="download" size={18} />Descargar</button>
            </div>
          </>
        ) : (
          <Empty icon="check" title="Todo está sobre el mínimo">Cuando una talla llegue a su stock mínimo, aparece aquí lista para pedir.</Empty>
        )}

        {passing?.length > 0 && (
          <>
            <h2 className="h-sec">Por despachar <small>{plural(passing.reduce((s, d) => s + d.qty, 0), 'prenda de paso', 'prendas de paso')}</small></h2>
            <div className="card panel">
              {passing.map((d) => {
                const days = d.since ? Math.floor((Date.now() - new Date(d.since).getTime()) / 86_400_000) : null
                return (
                  <div className="need" key={d.product.sku}>
                    <div className="need-t">
                      <b>{d.product.name}{d.product.size ? ` · ${d.product.size}` : ''}</b>
                      <small>
                        <span className="mono">{d.product.sku}</span>
                        {days != null && ` · llegó ${days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`}`}
                      </small>
                    </div>
                    <div className="need-q idle"><b>{d.qty}</b><span>de paso</span></div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <h2 className="h-sec">Lo que más sale <small>últimos 30 días</small></h2>
        {top && top.length ? (
          <div className="card bars" role="list" aria-label="Unidades que salieron en 30 días">
            {top.map((t) => (
              <div className="bar-row" key={t.sku} role="listitem" title={`${t.name}${t.size ? ' talla ' + t.size : ''}: ${t.qty_out} unidades`}>
                <span>{t.name}{t.size ? ` · ${t.size}` : ''}</span>
                <b>{t.qty_out}</b>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(t.qty_out / maxTop) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="summary" title="Sin salidas todavía">Cuando registres salidas, aquí verás las referencias que más rotan.</Empty>
        )}

        {remisiones?.length > 0 && (
          <>
            <h2 className="h-sec">Remisiones recibidas</h2>
            <div className="card panel">
              {remisiones.map((r) => {
                const owed = (r.lines || []).filter((l) => l.pending > 0)
                return (
                  <button type="button" className="need doc-item" key={r.id} onClick={() => setDocOpen(r)}>
                    <span className="need-t">
                      <b className={r.number.startsWith('SN-') ? '' : 'mono'}>{r.number.startsWith('SN-') ? 'Sin número' : r.number}</b>
                      <small>{[r.supplier, r.user_name, fmtTime(r.created_at)].filter(Boolean).join(' · ')}</small>
                      {owed.length > 0 && (
                        <small className="owed">Quedaron debiendo {owed.map((l) => `${l.size || 'única'} ${l.pending}`).join(', ')}</small>
                      )}
                      {r.notes && <small className="note">{r.notes}</small>}
                    </span>
                    <span className="need-q"><b>{r.units}</b><span>entraron</span></span>
                  </button>
                )
              })}
            </div>
            <button type="button" className="link-btn see-all" onClick={() => setDocList('remision')}>
              Ver todas las remisiones<Icon name="arrowRight" size={14} stroke={2.4} />
            </button>
          </>
        )}

        {facturas?.length > 0 && (
          <>
            <h2 className="h-sec">Facturas descontadas</h2>
            <div className="card panel">
              {facturas.map((f) => (
                <button type="button" className="need doc-item" key={f.id} onClick={() => setDocOpen(f)}>
                  <span className="need-t">
                    <b className="mono">{f.number}</b>
                    <small>{plural(f.lines.length, 'referencia', 'referencias')} · {f.user_name} · {fmtTime(f.created_at)}</small>
                  </span>
                  <span className="need-q dark"><b>{f.units}</b><span>salieron</span></span>
                </button>
              ))}
            </div>
            <button type="button" className="link-btn see-all" onClick={() => setDocList('factura')}>
              Ver todas las facturas<Icon name="arrowRight" size={14} stroke={2.4} />
            </button>
          </>
        )}

        <h2 className="h-sec">Movimientos</h2>
        <div className="chips" style={{ marginTop: 0 }} role="toolbar" aria-label="Filtrar movimientos">
          {[['all', 'Todo'], ['in', 'Entradas'], ['out', 'Salidas'], ['set', 'Conteos']].map(([f, label]) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
        {!moves ? (
          <div className="skeleton" />
        ) : moves.length ? (
          <ul className="moves card panel" style={{ marginTop: 8 }}>
            {moves.map((m) => (
              <li key={m.id} className={`move ${m.type}`}>
                <div className="move-q">{qtyText(m)}</div>
                <div className="move-t">
                  <b>{m.product_name}{m.product_size ? ` · ${m.product_size}` : ''}</b>
                  <small>{m.note || LABEL[m.type] || m.type} · {m.type === 'move' ? `${m.location_id} → ${m.to_location_id}` : m.location_id} · {m.user_name}</small>
                </div>
                <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('es-CO')}>{fmtTime(m.created_at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="summary" title="Sin movimientos">Lo que se escanee o se ajuste aparece aquí, con quién lo hizo.</Empty>
        )}

        <h2 className="h-sec">Datos y respaldo</h2>
        <div className="stack">
          <button className="btn btn-ink btn-block" onClick={() => exportCsv('/api/reports/inventory.csv', `inventario-${today()}.csv`)}>
            <Icon name="download" size={18} />Descargar inventario para Excel
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => exportCsv('/api/reports/movements.csv', `historial-${today()}.csv`)}>
            <Icon name="download" size={18} />Descargar historial para Excel
          </button>
          <button className="btn btn-ghost btn-block" onClick={copyInventory}><Icon name="copy" size={18} />Copiar inventario</button>
          {isAdmin && (
            <>
              <button className="btn btn-quiet btn-block" onClick={syncPhotos}>
                <Icon name="download" size={18} />Traer fotos de la tienda
              </button>
              <button className="btn btn-quiet btn-block" onClick={toggleDemo}>
                {demoOn === true ? 'Quitar datos de prueba' : 'Cargar datos de prueba'}
              </button>
              <button className="btn btn-danger btn-block" onClick={() => setResetting(true)}>
                Empezar de cero (borrar todo)
              </button>
            </>
          )}
        </div>
      </div>
      {resetting && <ResetSheet onClose={() => setResetting(false)} />}
      {docOpen && <DocumentSheet doc={docOpen} onClose={() => setDocOpen(null)} />}
      {docList && <DocumentsSheet kind={docList} onClose={() => setDocList(null)} />}
    </section>
  )
}
