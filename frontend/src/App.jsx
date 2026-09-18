import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import NavBar from './components/NavBar'
import NotificationBell from './components/NotificationBell'
import { useMovementNotifications } from './hooks/useMovementNotifications'
import Login from './pages/Login'
import Warehouse from './pages/Warehouse'
import Scan from './pages/Scan'
import Inventory from './pages/Inventory'
import Reserve from './pages/Reserve'
import Orders from './pages/Orders'
import History from './pages/History'

function RequireAuth({ children }) {
  const { token, ready } = useAuth()
  if (!ready) return null
  if (!token) return <Navigate to="/login" replace />
  return children
}

function Shell() {
  const { user } = useAuth()
  useMovementNotifications()
  return (
    <div className="app">
      <header className="top">
        <div className="zone" aria-hidden="true">C</div>
        <div>
          <h1>Bodega</h1>
          <p>Conectado a la base de datos compartida</p>
        </div>
        <div className="who">
          {user?.name}
          <NotificationBell />
          <LogoutButton />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Warehouse />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  )
}

function LogoutButton() {
  const { logout } = useAuth()
  return <button onClick={logout}>Salir</button>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
