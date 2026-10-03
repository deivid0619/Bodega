import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useMovements, useNeeds, useProducts, useReserve, useTop } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { api, ApiError } from '../api'
import { downloadCsv, fmtTime } from '../utils'
import Icon from '../components/Icon'
import { Empty, PageHead } from '../components/Bits'

const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo' }
const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : `+${m.qty}`)
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
  const [filter, setFilter] = useState('all')
  const { data: moves } = useMovements(filter)
  const [resetArmed, setResetArmed] = useState(false)
  const [demoOn, setDemoOn] = useState(null)

  const kpi = useMemo(() => ({
    units: (products || []).reduce((s, p) => s + p.qty, 0),
    refs: new Set((products || []).map(baseOf)).size,
    reserve: (reserve || []).reduce((s, i) => s + i.qty, 0),
    needs: needs?.length || 0,
  }), [products, reserve, needs])
  const maxTop = Math.max(1, ...(top || []).map((t) => t.qty_out))
  const date = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })

  const orderText = () => {
    const d = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    const lines = (needs || []).map((n) => `${n.product.name}${n.product.size ? ' talla ' + n.product.size : ''} (${n.product.sku}): pedir ${n.order_qty}, hay ${n.product.qty}`)
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
  const toggleDemo = async () => {
    try {
      const res = await api.post('/api/reports/demo')
      setDemoOn(res.demo)
      showToast(res.demo ? 'Datos de prueba cargados' : 'Datos de prueba quitados')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo cambiar los datos de prueba.', 'err')
    }
  }
  const resetInventory = async () => {
    if (!resetArmed) {
      setResetArmed(true)
      setTimeout(() => setResetArmed(false), 3000)
      return
    }
    try {
      await api.delete('/api/products')
      showToast('Inventario borrado. La distribución se mantiene.')
      setResetArmed(false)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo borrar.', 'err')
    }
  }

  return (
    <section className="page" aria-label="Resumen">
      <div className="page-inner">
        <PageHead title="Resumen" lede={date.charAt(0).toUpperCase() + date.slice(1)} />

        <div className="kpis">
          <div className="kpi dark"><b>{products ? kpi.units : '–'}</b><span>prendas en bodega</span></div>
          <div className="kpi"><b>{products ? kpi.refs : '–'}</b><span>referencias</span></div>
          <button className="kpi" onClick={() => navigate('/reserve')}><b>{reserve ? kpi.reserve : '–'}</b><span>en reserva</span></button>
          <a className={`kpi ${kpi.needs ? 'warn' : ''}`} href="#reponer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <b>{needs ? kpi.needs : '–'}</b><span>por reponer</span>
          </a>
        </div>

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
                    <small>Hay {n.product.qty} · mínimo {n.product.min_qty} · {n.product.location_id}</small>
                  </div>
                  <div className="need-q"><b>{n.order_qty}</b><span>pedir</span></div>
                </div>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn btn-lime" onClick={copyOrder}><Icon name="copy" size={18} />Copiar pedido</button>
              <button className="btn btn-ghost" onClick={() => exportCsv('/api/reports/inventory.csv', `pedido-${today()}.csv`)}><Icon name="download" size={18} />Descargar</button>
            </div>
          </>
        ) : (
          <Empty icon="check" title="Todo está sobre el mínimo">Cuando una talla llegue a su stock mínimo, aparece aquí lista para pedir.</Empty>
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
                  <small>{LABEL[m.type] || m.type} · {m.location_id} · {m.user_name}</small>
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
              <button className="btn btn-quiet btn-block" onClick={toggleDemo}>
                {demoOn === true ? 'Quitar datos de prueba' : 'Cargar datos de prueba'}
              </button>
              <button className="btn btn-danger btn-block" onClick={resetInventory}>
                {resetArmed ? 'Toca otra vez para borrar todo' : 'Borrar todo el inventario'}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
