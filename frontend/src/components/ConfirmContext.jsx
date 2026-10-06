import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Confirmar antes de borrar o quitar algo: un dialogo con "Cancelar" (el que
// queda marcado, para que un toque sin querer no borre nada) y el boton de
// la accion en rojo. Uso: if (!(await confirm({ title, body }))) return
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null) // { title, body, confirmLabel, danger }
  const resolveRef = useRef(null)
  const cancelRef = useRef(null)

  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolveRef.current?.(false) // si habia otra pregunta abierta, queda en "no"
    resolveRef.current = resolve
    setAsk({ confirmLabel: 'Eliminar', danger: true, ...opts })
  }), [])

  const answer = useCallback((yes) => {
    resolveRef.current?.(yes)
    resolveRef.current = null
    setAsk(null)
  }, [])

  useEffect(() => {
    if (!ask) return undefined
    cancelRef.current?.focus()
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation() // la hoja que hay debajo no se cierra
      answer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ask, answer])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && createPortal(
        <div className="confirm-layer">
          <div className="confirm-scrim" onClick={() => answer(false)} aria-hidden="true" />
          <div className="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
            <h2 id="confirm-title">{ask.title}</h2>
            {ask.body && <p id="confirm-body">{ask.body}</p>}
            <div className="confirm-actions">
              <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={() => answer(false)}>Cancelar</button>
              <button type="button" className={`btn ${ask.danger ? 'btn-danger-solid' : 'btn-ink'}`} onClick={() => answer(true)}>{ask.confirmLabel}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>')
  return ctx
}
