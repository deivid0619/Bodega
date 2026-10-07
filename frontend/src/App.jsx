import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import NavBar from './components/NavBar'
import NotificationBell from './components/NotificationBell'
import Icon, { BrandMark } from './components/Icon'
import Sheet, { SheetHeader } from './components/Sheet'
import { useMovementNotifications } from './hooks/useMovementNotifications'
import { useInstall } from './install'
import { useToast } from './components/ToastContext'
import Login from './pages/Login'
import Scan from './pages/Scan'
import Inventory from './pages/Inventory'
import Reserve from './pages/Reserve'
import Summary from './pages/Summary'
import Count from './pages/Count'
import Reports from './pages/Reports'

// el 3D (three.js) es lo mas pesado: se descarga aparte, asi el login y las
// demas pantallas abren rapido en el celular
const Warehouse = lazy(() => import('./pages/Warehouse'))

function RequireAuth({ children }) {
  const { token, ready } = useAuth()
  if (!ready) return null
  if (!token) return <Navigate to="/login" replace />
  return children
}

const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || 'B'

function AccountMenu() {
  const { user, logout } = useAuth()
  const install = useInstall()
  const showToast = useToast()
  const [open, setOpen] = useState(false)
  const [iosHelp, setIosHelp] = useState(false)

  const doInstall = async () => {
    setOpen(false)
    if (install.canPrompt) {
      if (await install.prompt()) showToast('Bodega quedó instalada en este dispositivo')
    } else {
      setIosHelp(true)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label="Tu cuenta" aria-expanded={open}>
        {initials(user?.name)}
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-head">
              <b>{user?.name}</b>
              <span>{user?.email} · {user?.role === 'admin' ? 'Administrador' : 'Operador'}</span>
            </div>
            {!install.standalone && (
              <button className="menu-item" role="menuitem" onClick={doInstall}>
                <Icon name="install" size={20} /> Instalar en este celular
              </button>
            )}
            <button className="menu-item" role="menuitem" onClick={logout}>
              <Icon name="logout" size={20} /> Cerrar sesión
            </button>
          </div>
        </>
      )}
      {iosHelp && (
        <Sheet modal onClose={() => setIosHelp(false)} label="Instalar la app">
          <SheetHeader title="Instalar Bodega" subtitle="Queda como una app más, con su ícono y en pantalla completa." />
          {install.ios ? (
            <ol className="install-steps">
              <li>Toca el botón <b>Compartir</b> de Safari (el cuadro con la flecha hacia arriba).</li>
              <li>Elige <b>Agregar a pantalla de inicio</b>.</li>
              <li>Toca <b>Agregar</b>. El ícono de Bodega aparece con tus apps.</li>
            </ol>
          ) : (
            <ol className="install-steps">
              <li>Abre el menú del navegador (los tres puntos).</li>
              <li>Elige <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b>.</li>
              <li>Confirma. El ícono de Bodega aparece con tus apps.</li>
            </ol>
          )}
        </Sheet>
      )}
    </div>
  )
}

function Shell() {
  useMovementNotifications()
  const { isViewer } = useAuth()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Bodega, inicio">
          <BrandMark size={26} />
          <span className="brand-word">bodega</span>
        </Link>
        <div className="topbar-actions">
          {isViewer && <span className="view-chip" title="Puedes recorrer todo; los cambios no se guardan">Solo ver</span>}
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Suspense fallback={<div className="page full wh" />}><Warehouse /></Suspense>} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/count" element={<Count />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/orders" element={<Navigate to="/summary" replace />} />
          <Route path="/history" element={<Navigate to="/summary" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<RequireAuth><Shell /></RequireAuth>} />
    </Routes>
  )
}
