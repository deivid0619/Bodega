import { useRef, useState } from 'react'
import Icon from './Icon'

// El visor de la camara para escanear etiquetas (lo maneja useBarcodeScanner).
export default function Viewfinder({ scanner, className = '' }) {
  const { status, message, note, videoRef, start, torch, toggleTorch } = scanner
  const camOn = status === 'on'
  return (
    <div className={`viewfinder ${className}`}>
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
      {camOn && (
        <>
          <div className="vf-corners" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="vf-laser" aria-hidden="true" />
        </>
      )}
      {camOn && message && <p className="vf-msg">{message}</p>}
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
