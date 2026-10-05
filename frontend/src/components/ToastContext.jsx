import { createContext, useCallback, useContext, useRef, useState } from 'react'
import Icon from './Icon'

const ToastContext = createContext(null)
const ICON = { ok: 'check', err: 'alert', info: 'bell' }

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const [shown, setShown] = useState(false)
  const timer = useRef(null)

  // action = { label, onClick }: un boton en el aviso (ej. Deshacer)
  const showToast = useCallback((message, kind = 'ok', action = null) => {
    clearTimeout(timer.current)
    setToast({ message, kind, action })
    setShown(true)
    timer.current = setTimeout(() => setShown(false), action ? 6000 : kind === 'err' ? 4200 : 3000)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={`toast ${shown ? 'show' : ''} ${toast?.kind || ''}`} role="status" aria-live="polite">
        {toast && (
          <>
            <span className="toast-icon"><Icon name={ICON[toast.kind] || 'check'} size={15} stroke={2.6} /></span>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-act"
                onClick={() => {
                  clearTimeout(timer.current)
                  setShown(false)
                  toast.action.onClick()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
