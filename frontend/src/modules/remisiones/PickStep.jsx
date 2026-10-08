import { useRef } from 'react'
import { SheetHeader } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { useCrop } from '../../ui/PhotoCrop'

export default function PickStep({ onFile, onSkip }) {
  const [cropEl, crop] = useCrop()
  const camera = useRef(null)
  const gallery = useRef(null)
  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const out = await crop(f)
    if (out) onFile(out)
  }
  return (
    <>
      {cropEl}
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Entrada de mercancía</span></div>}
        title="Recibir una remisión"
        subtitle="Toma la foto de la orden de remisión: la tienes a la vista mientras cuentas y queda guardada un mes como prueba de lo que llegó."
      />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
      <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => camera.current.click()}>
        <Icon name="camera" size={20} />Tomar foto de la remisión
      </button>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost" onClick={() => gallery.current.click()}>Elegir foto</button>
        <button className="btn btn-quiet" onClick={onSkip}>Sin foto</button>
      </div>
      <details className="doc-help">
        <summary>Recomendaciones para usarla bien</summary>
        <ul>
          <li>Cuenta lo que llegó: entra lo que cuentes, no lo que diga el papel.</li>
          <li>Si el proveedor quedó debiendo algo, anótalo como pendiente.</li>
          <li>La foto queda guardada un mes con la remisión (se puede ver y descargar en Resumen) y después se borra sola. Lo que registras se queda siempre.</li>
        </ul>
      </details>
    </>
  )
}
