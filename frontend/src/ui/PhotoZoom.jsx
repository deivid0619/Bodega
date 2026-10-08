import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

// la foto en grande: tocar acerca o aleja, y con el dedo se recorre
export default function PhotoZoom({ src, onClose, label = 'Foto de la remisión' }) {
  const [big, setBig] = useState(true)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="zoom" role="dialog" aria-modal="true" aria-label={label}>
      <div className="zoom-scroll" onClick={() => setBig((b) => !b)}>
        <img src={src} alt={label} style={{ width: big ? '230%' : '100%' }} />
      </div>
      <button className="zoom-close" onClick={onClose} aria-label="Cerrar la foto"><Icon name="x" size={22} stroke={2.2} /></button>
      <p className="zoom-hint">Toca para acercar o alejar · desliza para recorrerla</p>
    </div>,
    document.body,
  )
}
