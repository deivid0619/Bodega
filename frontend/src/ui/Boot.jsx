import { useEffect, useState } from 'react'
import { BrandMark } from './Icon'

// La pantalla de carga (la misma de index.html, que se ve antes de que llegue
// el codigo): la marca y una barra que avanza. Si tarda, dice por que: el
// servidor gratuito se duerme cuando nadie lo usa y tarda en despertar.
// variant 'page': dentro de una pantalla (fondo claro), p. ej. el 3D cargando.
export default function Boot({ label = 'Abriendo…', variant }) {
  const [slow, setSlow] = useState(0)
  useEffect(() => {
    const a = setTimeout(() => setSlow(1), 4000)
    const b = setTimeout(() => setSlow(2), 12000)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [])
  const msg = slow === 0 ? label
    : slow === 1 ? 'Conectando con el servidor…'
      : 'El servidor se está despertando (pasa cuando nadie lo ha usado en un rato). Puede tardar hasta un minuto.'
  return (
    <div className={`boot${variant === 'page' ? ' page' : ''}`} role="status" aria-live="polite">
      {variant !== 'page' && (
        <div className="boot-brand">
          <BrandMark size={40} />
          <span className="boot-word">bodega</span>
        </div>
      )}
      <div className="boot-bar"><i /></div>
      <p className="boot-msg" key={slow}>{msg}</p>
    </div>
  )
}
