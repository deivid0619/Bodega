import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion, project, rubberband, springTo } from '../motion'

// Hoja inferior arrastrable. En el celular entra con un resorte y se puede
// agarrar desde la barra o el encabezado; al soltarla, la velocidad del dedo
// pasa directo a la animacion (un "flick" basta para cerrarla). En pantallas
// grandes se vuelve un panel lateral, o un dialogo centrado si es modal.
const SheetContext = createContext({ close: () => {}, handle: {} })
export const useSheet = () => useContext(SheetContext)

const isWide = () => window.matchMedia('(min-width: 900px)').matches

const Sheet = forwardRef(function Sheet({ onClose, modal = false, size = 'auto', label, children, className = '' }, ref) {
  const panel = useRef(null)
  const scrim = useRef(null)
  const st = useRef({ y: 0, h: 1, stop: null, closing: false })
  const drag = useRef(null)
  const [wide] = useState(isWide)
  const [still] = useState(prefersReducedMotion)
  const springy = !wide && !still

  const setY = useCallback((y) => {
    st.current.y = y
    if (panel.current) panel.current.style.transform = `translate3d(0,${y}px,0)`
    if (scrim.current) scrim.current.style.opacity = String(Math.max(0, Math.min(1, 1 - y / st.current.h)))
  }, [])

  useLayoutEffect(() => {
    if (!springy) return
    const h = panel.current.offsetHeight || 400
    st.current.h = h
    setY(h)
    st.current.stop = springTo(h, 0, { damping: 1, response: 0.42, onUpdate: setY })
    return () => st.current.stop?.()
  }, [springy, setY])

  const close = useCallback((velocity = 0) => {
    if (st.current.closing) return
    st.current.closing = true
    if (!springy) {
      panel.current?.classList.add('leaving')
      scrim.current?.classList.add('leaving')
      setTimeout(() => onClose?.(), 160)
      return
    }
    st.current.stop?.()
    const h = panel.current?.offsetHeight || st.current.h
    st.current.h = h
    st.current.stop = springTo(st.current.y, h + 30, {
      velocity, damping: 1, response: 0.3, onUpdate: setY, onDone: () => onClose?.(),
    })
  }, [onClose, springy, setY])

  useImperativeHandle(ref, () => ({ close }), [close])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const onPointerDown = (e) => {
    if (!springy || drag.current || st.current.closing) return
    if (e.target.closest('button, input, select, textarea, a')) return
    st.current.stop?.()
    st.current.h = panel.current.offsetHeight
    drag.current = { id: e.pointerId, y0: e.clientY, from: st.current.y, hist: [[e.timeStamp, e.clientY]], live: false }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dy = e.clientY - d.y0
    if (!d.live) {
      if (Math.abs(dy) < 5) return
      d.live = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const y = d.from + dy
    setY(y < 0 ? -rubberband(-y, st.current.h) : y)
    d.hist.push([e.timeStamp, e.clientY])
    if (d.hist.length > 6) d.hist.shift()
  }
  const onPointerUp = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.live) return
    const [t0, y0] = d.hist[0]
    const [t1, y1] = d.hist[d.hist.length - 1]
    const v = ((y1 - y0) / Math.max(8, t1 - t0)) * 1000
    if (st.current.y + project(v) > st.current.h * 0.45 || v > 800) close(v)
    else st.current.stop = springTo(st.current.y, 0, { velocity: v, damping: 0.86, response: 0.34, onUpdate: setY })
  }
  const handle = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }

  return (
    <SheetContext.Provider value={{ close, handle }}>
      {modal && <div ref={scrim} className={`scrim ${springy ? '' : 'css-motion'}`} onClick={() => close()} />}
      <section
        ref={panel}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal || undefined}
        aria-label={label}
        className={`sheet ${modal ? 'is-modal' : 'is-docked'} size-${size} ${springy ? '' : 'css-motion'} ${className}`}
      >
        <div className="sheet-grab" {...handle} />
        <div className="sheet-scroll">{children}</div>
      </section>
    </SheetContext.Provider>
  )
})

export default Sheet

export function SheetHeader({ eyebrow, title, subtitle, onClose, children }) {
  const { close, handle } = useSheet()
  return (
    <header className="sheet-head" {...handle}>
      <div className="sheet-head-text">
        {eyebrow}
        <h2 className="sheet-title">{title}</h2>
        {subtitle && <p className="sheet-sub">{subtitle}</p>}
      </div>
      {children}
      <button type="button" className="close-btn" onClick={() => (onClose ? onClose() : close())} aria-label="Cerrar">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
      </button>
    </header>
  )
}
