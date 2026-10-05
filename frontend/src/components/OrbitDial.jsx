import { useRef } from 'react'
import Icon from './Icon'

// Dial de abajo para mover la vista sin tocar la bodega: arrastrar a los
// lados la gira, arriba o abajo la inclina, y los botones acercan o alejan.
// Al soltar con impulso sigue girando un poco, como con el dedo en la vista.
export default function OrbitDial({ onNudge }) {
  const dial = useRef(null)
  const drag = useRef(null)
  const shift = useRef(0)

  const move = (dx) => {
    shift.current += dx
    dial.current?.style.setProperty('--dial-x', `${shift.current}px`)
  }

  const onDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sin captura: igual sigue */ }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, hist: [[e.timeStamp, e.clientX]] }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.x = e.clientX
    d.y = e.clientY
    d.hist.push([e.timeStamp, e.clientX])
    if (d.hist.length > 6) d.hist.shift()
    move(dx)
    onNudge({ dth: -dx * 0.011, dph: -dy * 0.008 })
  }
  const onUp = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const [t0, x0] = d.hist[0]
    const [t1, x1] = d.hist[d.hist.length - 1]
    if (e.timeStamp - t1 < 80 && t1 > t0) {
      const v = (x1 - x0) / Math.max(16, t1 - t0) // px por ms
      onNudge({ dth: Math.max(-1.6, Math.min(1.6, -v * 0.011 * 240)) })
    }
  }
  const onKey = (e) => {
    const step = { ArrowLeft: [0.2, 0], ArrowRight: [-0.2, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key]
    if (!step) return
    e.preventDefault()
    move(step[0] * -60)
    onNudge({ dth: step[0], dph: step[1] })
  }

  return (
    <div className="wh-dial">
      <button type="button" className="zoom" onClick={() => onNudge({ zoom: 1.25 })} aria-label="Alejar">
        <Icon name="minus" size={20} stroke={2.4} />
      </button>
      <div
        ref={dial}
        className="dial"
        role="slider"
        tabIndex={0}
        aria-label="Girar e inclinar la bodega"
        aria-valuetext="Arrastra a los lados para girar, arriba o abajo para inclinar"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <span aria-hidden="true">Girar</span>
      </div>
      <button type="button" className="zoom" onClick={() => onNudge({ zoom: 0.8 })} aria-label="Acercar">
        <Icon name="plus" size={20} stroke={2.4} />
      </button>
    </div>
  )
}
