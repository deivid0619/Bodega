import { NavLink } from 'react-router-dom'
import { useNeeds } from '../hooks/useApi'

const cls = ({ isActive }) => 'tab' + (isActive ? ' active' : '')

export default function NavBar() {
  const { data: needs } = useNeeds()
  const needCount = needs?.length || 0

  return (
    <nav className="tabs" role="tablist">
      <NavLink to="/" end className={cls}>
        <svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>
        Bodega
      </NavLink>
      <NavLink to="/scan" className={cls}>
        <svg viewBox="0 0 24 24"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13.5 8v8M17 8v8" /></svg>
        Escanear
      </NavLink>
      <NavLink to="/inventory" className={cls}>
        <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        Inventario
      </NavLink>
      <NavLink to="/orders" className={cls} style={{ position: 'relative' }}>
        <svg viewBox="0 0 24 24"><rect x="5.5" y="4.5" width="13" height="16" rx="2" /><path d="M9 4.5h6v3H9zM9 12h6M9 16h4" /></svg>
        Pedidos
        {needCount > 0 && <span className="dot">{needCount}</span>}
      </NavLink>
      <NavLink to="/history" className={cls}>
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
        Historial
      </NavLink>
    </nav>
  )
}
