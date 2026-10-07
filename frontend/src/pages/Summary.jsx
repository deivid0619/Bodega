import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { refreshInventory, useLayout, useMovements, useNeeds, usePolling, useProducts, useReserve, useTop } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmContext'
import { api, ApiError } from '../api'
import { downloadCsv, fmtTime, outletIdsOf, refKey, stockSplit } from '../utils'
import Icon from '../components/Icon'
import ResetSheet from '../components/ResetSheet'
import DocumentSheet, { DocumentsSheet } from '../components/DocumentSheet'
import DocsSection from '../components/DocCalendar'
import SummaryIndex from '../components/SummaryIndex'
import ViewLink from '../components/ViewLink'
import MovementSheet, { pairOf } from '../components/MovementSheet'
import PassingSection from '../components/Passing'
import StoreStatus, { PhotoStoreStatus } from '../components/StoreStatus'
import { Count, Empty, PageHead, plural } from '../components/Bits'

const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado' }
const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const today = () => new Date().toISOString().slice(0, 10)

export default function Summary() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const showToast = useToast()
  const confirm = useConfirm()
  const { data: needs } = useNeeds()
  const { data: top } = useTop()
  const { data: products } = useProducts()
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  const { data: passing } = usePolling('/api/reports/dispatch', { interval: 20000 })
  // desde otra pagina se llega a una seccion (/summary#despacho)
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return undefined
    const t = setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
    return () => clearTimeout(t)
  }, [hash])
  const [filter, setFilter] = useState('all')
  const { data: moves } = useMovements(filter)
  // los movimientos van plegados: se abren cuando se quieren ver (y se
  // recuerda en este celular), de a 10
  const [movesOpen, setMovesOpen] = useState(() => {
    try { return localStorage.getItem('bodega_resumen_movimientos') === 'abierto' } catch { return false }
  })
  const [movesShown, setMovesShown] = useState(10)
  const toggleMoves = () => {
    const next = !movesOpen
    setMovesOpen(next)
    setMovesShown(10)
    try { localStorage.setItem('bodega_resumen_movimientos', next ? 'abierto' : 'cerrado') } catch { /* sin almacenamiento */ }
  }
  const [resetting, setResetting] = useState(false)
  const [docOpen, setDocOpen] = useState(null)
  const [moveOpen, setMoveOpen] = useState(null) // el movimiento que se esta viendo
  const [docList, setDocList] = useState(null)
  const [demoOn, setDemoOn] = useState(null)

  const kpi = useMemo(() => ({
    // lo de paso (Despacho) y el outlet no son de la bodega
    units: (products || []).reduce((s, p) => s + stockSplit(p, null, outletIdsOf(layout)).bodega, 0),
    refs: new Set((products || []).map((p) => refKey(p.name))).size,
    reserve: (reserve || []).reduce((s, i) => s + i.qty, 0),
    needs: needs?.length || 0,
    toOrder: (needs || []).filter((n) => n.order_qty > 0).length,
  }), [products, reserve, needs, layout])
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
    const ok = await confirm(demoOn
      ? { title: '¿Quitar los datos de prueba?', body: 'Se borran las prendas y los movimientos de ejemplo. Lo que registraste tú no se toca.', confirmLabel: 'Sí, quitarlos' }
      : { title: '¿Cargar datos de prueba?', body: 'Se agregan prendas y movimientos de ejemplo para ver cómo se ve la app. Se quitan con el mismo botón.', confirmLabel: 'Cargar', danger: false })
    if (!ok) return
    try {
      const res = await api.post('/api/reports/demo')
      setDemoOn(res.demo)
      showToast(res.demo ? 'Datos de prueba cargados' : 'Datos de prueba quitados')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo cambiar los datos de prueba.', 'err')
    }
  }

  return (
    <section className="page sum-page" aria-label="Resumen">
      <div className="page-inner">
        <PageHead title="Resumen" lede={date.charAt(0).toUpperCase() + date.slice(1)} />
        <SummaryIndex onJump={(id) => { if (id === 'movimientos' && !movesOpen) { setMovesOpen(true); setMovesShown(10) } }} />

        <div className="kpis">
          <div className="kpi dark"><b>{products ? <Count value={kpi.units} /> : '–'}</b><span>prendas en bodega</span></div>
          <div className="kpi"><b>{products ? <Count value={kpi.refs} /> : '–'}</b><span>{kpi.refs === 1 ? 'referencia' : 'referencias'}</span></div>
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
        <StoreStatus />
        <PhotoStoreStatus />

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

        <PassingSection />

        <DocsSection onOpen={setDocOpen} onList={setDocList} />

        <h2 className="h-sec" id="mas-sale">Lo que más sale <small>últimos 30 días</small></h2>
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

        <h2 className="h-sec fold-sec" id="movimientos">
          <button type="button" className="fold-btn" aria-expanded={movesOpen} aria-controls="movimientos-lista" onClick={toggleMoves}>
            Movimientos
            <small>{movesOpen ? 'Ocultar' : moves?.length ? `Ver ${moves.length >= 60 ? 'los últimos 60' : moves.length}` : ''}</small>
            <Icon name="arrowRight" size={16} stroke={2.4} />
          </button>
        </h2>
        {!movesOpen && moves?.[0] && (
          <button type="button" className="move-last" onClick={toggleMoves}>
            <span>Último: <b>{qtyText(moves[0])} {moves[0].product_name}{moves[0].product_size ? ` · ${moves[0].product_size}` : ''}</b></span>
            <small>{moves[0].user_name} · {fmtTime(moves[0].created_at)}</small>
          </button>
        )}
        {movesOpen && (
        <div id="movimientos-lista">
        <div className="chips" style={{ marginTop: 0 }} role="toolbar" aria-label="Filtrar movimientos">
          {[['all', 'Todo'], ['in', 'Entradas'], ['out', 'Salidas'], ['set', 'Conteos']].map(([f, label]) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => { setFilter(f); setMovesShown(10) }}>{label}</button>
          ))}
        </div>
        {!moves ? (
          <div className="skeleton" />
        ) : moves.length ? (
          <>
          <ul className="moves card panel" style={{ marginTop: 8 }}>
            {moves.slice(0, movesShown).map((m) => (
              <li key={m.id} className={`move ${m.type} openable`} role="button" tabIndex={0} aria-label={`Ver el detalle: ${m.product_name}`}
                  onClick={() => setMoveOpen(m)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMoveOpen(m))}>
                <div className="move-q">{qtyText(m)}</div>
                <div className="move-t">
                  <b>{m.product_name}{m.product_size ? ` · ${m.product_size}` : ''}</b>
                  <small>{m.note || LABEL[m.type] || m.type} · {m.type === 'move' ? `${m.location_id} → ${m.to_location_id}` : m.location_id} · {m.user_name}</small>
                </div>
                <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('es-CO')}>{fmtTime(m.created_at)}</time>
              </li>
            ))}
          </ul>
          {moves.length > movesShown && (
            <button type="button" className="link-btn see-all" onClick={() => setMovesShown((n) => n + 10)}>
              Ver más ({moves.length - movesShown})<Icon name="arrowRight" size={14} stroke={2.4} />
            </button>
          )}
          </>
        ) : (
          <Empty icon="summary" title="Sin movimientos">Lo que se escanee o se ajuste aparece aquí, con quién lo hizo.</Empty>
        )}
        </div>
        )}

        <h2 className="h-sec" id="datos">Datos y respaldo</h2>
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
        {isAdmin && <ViewLink />}
      </div>
      {resetting && <ResetSheet onClose={() => setResetting(false)} />}
      {docOpen && <DocumentSheet doc={docOpen} onClose={() => setDocOpen(null)} />}
      {moveOpen && <MovementSheet movement={moveOpen} pair={pairOf(moveOpen, moves)} onClose={() => setMoveOpen(null)} />}
      {docList && <DocumentsSheet kind={docList} onClose={() => setDocList(null)} />}
    </section>
  )
}
