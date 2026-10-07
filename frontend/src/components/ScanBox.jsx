import { useEffect, useState } from 'react'
import { useBarcodeScanner } from '../hooks/useBarcodeScanner'
import Viewfinder from './Viewfinder'
import Icon from './Icon'

// El escaner dentro de una hoja (la remision, el pedido): la camara, el
// codigo a mano o con un lector USB/Bluetooth, y lo ultimo que se leyo
// encima del visor. Cada lectura llama a onCode con el codigo.
// flash: { text, err, at } (lo que se acaba de leer)
export default function ScanBox({ onCode, flash, hint }) {
  const scanner = useBarcodeScanner(onCode)
  const { stop, start, status } = scanner
  const [manual, setManual] = useState('')
  const camOn = status === 'on'
  // al cerrar la hoja se apaga la camara (y la linterna)
  useEffect(() => () => { stop() }, [stop])

  const submit = () => {
    const v = manual.trim()
    if (!v) return
    onCode(v)
    setManual('')
  }

  return (
    <div className="scan-box">
      <Viewfinder
        scanner={scanner}
        overlay={flash ? <p key={flash.at} className={`vf-msg scan-flash${flash.err ? ' err' : ''}`} role="status">{flash.text}</p> : null}
      />
      <button type="button" className={`btn btn-block ${camOn ? 'btn-ink' : 'btn-lime'}`} style={{ marginTop: 10 }} onClick={() => (camOn ? stop() : start())}>
        <Icon name={camOn ? 'x' : 'camera'} size={18} />{camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
      </button>
      <div className="manual">
        <input
          className="input mono"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          placeholder="Código a mano"
          autoCapitalize="characters"
          spellCheck="false"
          enterKeyHint="done"
          aria-label="Código"
        />
        <button type="button" className="btn btn-ink" onClick={submit} disabled={!manual.trim()}>Agregar</button>
      </div>
      {hint && <p className="mode-hint">{hint}</p>}
    </div>
  )
}
