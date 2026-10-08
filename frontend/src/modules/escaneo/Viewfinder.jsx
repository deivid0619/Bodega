import { useEffect, useRef, useState } from 'react'
import Icon from '../../ui/Icon'

// El visor de la camara para escanear etiquetas (lo maneja useBarcodeScanner).
// "overlay": lo ultimo que se registro, encima de la camara (ver Scan).
export default function Viewfinder({ scanner, overlay = null, className = '' }) {
  const { status, message, note, videoRef, start, torch, toggleTorch, paused, resume, setVisible } = scanner
  const camOn = status === 'on'
  const waiting = camOn && paused
  const boxRef = useRef(null)

  // al abrir la camara, la pantalla va al visor (si estaba mas abajo, se
  // quedaba leyendo fuera de la vista)
  useEffect(() => {
    const el = boxRef.current
    if (!camOn || !el) return
    const r = el.getBoundingClientRect()
    const top = 64, bottom = window.innerHeight - 96 // el encabezado y la barra de abajo
    if (r.top < top || r.bottom > bottom) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
    }
  }, [camOn])

  // si el visor sale de la pantalla, la camara no lee: nada se cuenta sin verlo
  useEffect(() => {
    const el = boxRef.current
    if (!el || !setVisible || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] })
    io.observe(el)
    return () => { io.disconnect(); setVisible(true) }
  }, [setVisible])

  return (
    <div ref={boxRef} className={`viewfinder ${overlay ? 'has-hit' : ''} ${waiting ? 'paused' : ''} ${className}`}>
      <video ref={videoRef} playsInline muted style={{ display: camOn ? 'block' : 'none' }} />
      {status === 'off' && (
        <button className="vf-idle" onClick={start}>
          <Icon name="camera" size={34} stroke={1.7} />
          {note ? <>{note}<br />Toca para abrirla otra vez</> : 'Toca para abrir la cámara'}
        </button>
      )}
      {status === 'fail' && (
        <div className="vf-fail">
          <Icon name="alert" size={28} />
          {message}
          <button className="btn btn-lime btn-sm" onClick={start}>Intentar de nuevo</button>
        </div>
      )}
      {camOn && !waiting && (
        <>
          <div className="vf-corners" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="vf-laser" aria-hidden="true" />
        </>
      )}
      {/* una prenda a la vez: la camara espera hasta que se toque */}
      {waiting && (
        <button type="button" className="vf-next" onClick={resume}>
          <Icon name="scan" size={22} stroke={2.2} />Escanear siguiente
        </button>
      )}
      {camOn && !waiting && message && !overlay && <p className="vf-msg">{message}</p>}
      {/* tambien con la camara cerrada: con lector USB o a mano el aviso queda en el mismo sitio */}
      {status !== 'fail' && overlay}
      {camOn && torch !== 'none' && (
        <button type="button" className="vf-torch" aria-pressed={torch === 'on'} onClick={toggleTorch} aria-label={torch === 'on' ? 'Apagar la linterna' : 'Prender la linterna'}>
          <Icon name="flash" size={20} stroke={2} />
        </button>
      )}
    </div>
  )
}

// Plan B: una foto con la camara normal del celular, que enfoca bien de
// cerca. La camara en vivo se cierra antes para no pelear por ella.
export function PhotoRead({ scanner, onMiss }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const open = async () => {
    await scanner.stop()
    input.current.click()
  }
  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      if (!(await scanner.readFile(file))) onMiss?.()
    } catch {
      onMiss?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} disabled={busy} onClick={open}>
        <Icon name="camera" size={18} />{busy ? 'Leyendo la foto…' : '¿No lo coge? Léelo con una foto'}
      </button>
    </>
  )
}
