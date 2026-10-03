import { NavLink } from 'react-router-dom'
import { useNeeds } from '../hooks/useApi'
import Icon from './Icon'

const cls = ({ isActive }) => 'dock-item' + (isActive ? ' active' : '')

export default function NavBar() {
  const { data: needs } = useNeeds()
  const needCount = needs?.length || 0

  return (
    <nav className="dock" aria-label="Secciones">
      <NavLink to="/" end className={cls}>
        <Icon name="warehouse" />
        Bodega
      </NavLink>
      <NavLink to="/inventory" className={cls}>
        <Icon name="hanger" />
        Inventario
      </NavLink>
      <NavLink to="/scan" className={({ isActive }) => 'dock-scan' + (isActive ? ' active' : '')} aria-label="Escanear">
        <Icon name="scan" size={27} stroke={2.1} />
      </NavLink>
      <NavLink to="/reserve" className={cls}>
        <Icon name="reserve" />
        Reserva
      </NavLink>
      <NavLink to="/summary" className={cls}>
        <Icon name="summary" />
        Resumen
        {needCount > 0 && <span className="dock-badge">{needCount}</span>}
      </NavLink>
    </nav>
  )
}
