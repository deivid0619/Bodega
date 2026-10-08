import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './core/install.js'
import App from './App.jsx'
import { AuthProvider } from './core/AuthContext.jsx'
import { ToastProvider } from './ui/ToastContext.jsx'
import { ConfirmProvider } from './ui/ConfirmContext.jsx'
import { NotificationPrefsProvider } from './modules/avisos/NotificationPrefsContext.jsx'
import './styles/global.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <NotificationPrefsProvider>
              <App />
            </NotificationPrefsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
