import { useRef } from 'react'
import { SheetHeader } from './Sheet'
import Icon from './Icon'
import { matchAll, parseFactura } from '../lib/facturaParser'
import { readPhoto } from '../lib/ocr'

// Lee la foto de una factura: el numero y las lineas, cada una con la prenda
// de la bodega que le corresponde (si la encontro). Sin lineas, error.
export async function readFactura(file, known, opts) {
  const text = await readPhoto(file, opts)
  const parsed = parseFactura(text)
  return { number: parsed.number, lines: parsed.lines, matches: matchAll(parsed.lines, known) }
}

export function ReadingStep({ preview, stage, progress }) {
  return (
    <>
      <SheetHeader title="Leyendo la factura…" subtitle={stage === 'reading' ? 'Buscando códigos y cantidades.' : 'Preparando el lector (la primera vez tarda un poco más).'} />
      <div className="doc-reading">
        {preview && <img src={preview} alt="" />}
        <div className="doc-scanline" aria-hidden="true" />
      </div>
      <div className="doc-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
      </div>
      <p className="mode-hint" style={{ textAlign: 'center' }}>{Math.round(progress * 100)}%</p>
    </>
  )
}

// Tomar la foto de la factura o elegir una guardada
export function PhotoButtons({ onFile }) {
  const camera = useRef(null)
  const gallery = useRef(null)
  const pick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f)
  }
  return (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
      <button type="button" className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => camera.current.click()}>
        <Icon name="camera" size={20} />Tomar foto de la factura
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={() => gallery.current.click()}>
        Elegir una foto guardada
      </button>
    </>
  )
}
