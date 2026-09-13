import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const showToast = useCallback((message, kind = 'ok') => {
    clearTimeout(timer.current)
    setToast({ message, kind, key: Date.now() })
    timer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={`toast ${toast ? 'show' : ''} ${toast?.kind === 'err' ? 'err' : ''}`} role="status">
        {toast?.message}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
