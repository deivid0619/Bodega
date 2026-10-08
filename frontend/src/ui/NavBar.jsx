import { flushSync } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useNeeds, useRestock } from '../core/useApi'
import Icon from './Icon'

const ORDER = ['/', '/inventory', '/scan', '/reserve', '/summary']

export default function NavBar() {
  const { data: needs } = useNeeds()
  const { data: restock } = useRestock()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // pantallas que cuelgan de una pestana: la pestana sigue marcada
  const PARENT = { '/reports': '/summary', '/count': '/scan' }
  const current = PARENT[pathname] || pathname
  // por pedir al proveedor (lo que cubre la reserva se trae, no se pide)
  const needCount = (needs || []).filter((n) => n.order_qty > 0).length
  const restockCount = restock?.length || 0

  // Cambio de pestana con View Transitions: el contenido se desliza hacia el
  // lado de la pestana elegida y el indicador lima viaja entre pestanas.
  const go = (to) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    const here = window.location.pathname
    if (here === to) return
    document.documentElement.dataset.nav = ORDER.indexOf(to) >= ORDER.indexOf(here) ? 'fwd' : 'back'
    if (!document.startViewTransition || document.visibilityState !== 'visible') return navigate(to)
    const t = document.startViewTransition(() => flushSync(() => navigate(to)))
    // si el navegador cancela la animacion, la navegacion igual ocurre
    t.ready.catch(() => {})
    t.finished.catch(() => {})
  }

  const item = (to, icon, label, extra) => (
    <NavLink to={to} end={to === '/'} onClick={go(to)} className={() => 'dock-item' + (current === to ? ' active' : '')}>
      {() => (
        <>
          {current === to && <i className="dock-ind" aria-hidden="true" />}
          <Icon name={icon} />
          {label}
          {extra}
        </>
      )}
    </NavLink>
  )

  return (
    <nav className="dock" aria-label="Secciones">
      {item('/', 'warehouse', 'Bodega')}
      {item('/inventory', 'hanger', 'Inventario')}
      <NavLink to="/scan" onClick={go('/scan')} className={() => 'dock-scan' + (current === '/scan' ? ' active' : '')} aria-label="Escanear">
        <Icon name="scan" size={27} stroke={2.1} />
      </NavLink>
      {item('/reserve', 'reserve', 'Reserva', restockCount > 0 && <span className="dock-badge lime">{restockCount}</span>)}
      {item('/summary', 'summary', 'Resumen', needCount > 0 && <span className="dock-badge">{needCount}</span>)}
    </nav>
  )
}
