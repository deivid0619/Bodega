import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useMovements } from '../hooks/useApi'
import { useToast } from '../components/ToastContext'
import { api, ApiError } from '../api'
import { downloadCsv, fmtTime } from '../utils'

const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo' }

export default function History() {
  const { isAdmin } = useAuth()
  const [filter, setFilter] = useState('all')
  const { data: moves } = useMovements(filter)
  const showToast = useToast()
  const [resetArmed, setResetArmed] = useState(false)
  const [demoOn, setDemoOn] = useState(null)

  const exportCsv = async (path, name) => {
    const csv = await api.get(path)
    downloadCsv(csv, name)
  }

  const copyInventory = async () => {
    try {
      const csv = await api.get('/api/reports/inventory.csv')
      await navigator.clipboard.writeText(csv)
      showToast('Inventario copiado. Pégalo en Excel o Google Sheets.')
    } catch {
      showToast('No se pudo copiar en este dispositivo.', 'err')
    }
  }

  const toggleDemo = async () => {
    try {
      const res = await api.post('/api/reports/demo')
      setDemoOn(res.demo)
      showToast(res.demo ? 'Datos de prueba cargados.' : 'Datos de prueba eliminados.')
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
    <section className="view" aria-label="Historial">
      <h2>Historial</h2>
      <div className="chips">
        {[['all', 'Todo'], ['in', 'Entradas'], ['out', 'Salidas'], ['set', 'Conteos']].map(([f, label]) => (
          <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>
      {!moves ? (
        <p className="muted">Cargando…</p>
      ) : moves.length ? (
        <ul className="sess">
          {moves.map((m) => (
            <li key={m.id} className={`mv ${m.type}`}>
              <div className="q">{m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : `+${m.qty}`}</div>
              <div className="t">
                <b>{m.product_name}{m.product_size ? ` ${m.product_size}` : ''}</b>
                <small>{LABEL[m.type] || m.type} en {m.location_name}, quedan {m.after} · {m.user_name}</small>
              </div>
              <time>{fmtTime(m.created_at)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">Todavía no hay movimientos.</div>
      )}

      <h2>Datos y respaldo</h2>
      <div className="stack">
        <button className="btn primary" onClick={() => exportCsv('/api/reports/inventory.csv', `inventario-${new Date().toISOString().slice(0, 10)}.csv`)}>
          Descargar inventario para Excel
        </button>
        <button className="btn ghost" onClick={() => exportCsv('/api/reports/movements.csv', `historial-${new Date().toISOString().slice(0, 10)}.csv`)}>
          Descargar historial para Excel
        </button>
        <button className="btn ghost" onClick={copyInventory}>Copiar inventario (pegar en Excel o Sheets)</button>
        {isAdmin && (
          <>
            <button className="btn ghost" onClick={toggleDemo}>
              {demoOn === true ? 'Quitar datos de prueba' : 'Cargar datos de prueba'}
            </button>
            <button className="btn danger" onClick={resetInventory}>
              {resetArmed ? 'Toca otra vez para borrar todo' : 'Borrar todo el inventario'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
