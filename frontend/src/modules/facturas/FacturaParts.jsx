import { useEffect, useRef, useState } from 'react'
import { SheetHeader } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { useCrop } from '../../ui/PhotoCrop'
import { matchAll, parseFactura } from './facturaParser'
import { readPhoto } from './ocr'
import { saveDocPhoto } from '../documentos/docPhotos'

// Guarda las fotos en orden (si una falla, sigue con las demas). Devuelve
// cuantas quedaron y el documento como quedo.
export async function savePhotos(docId, files) {
  let kept = 0
  let doc = null
  for (const f of files) {
    try {
      doc = await saveDocPhoto(docId, f)
      kept++
    } catch { /* se puede agregar despues desde Resumen */ }
  }
  return { kept, doc }
}

export function photoNote(total, kept) {
  if (!total) return ''
  if (kept === total) return total === 1 ? ' · foto guardada dos meses' : ` · ${total} fotos guardadas dos meses`
  if (!kept) return total === 1 ? ' · la foto no se guardó: agrégala desde Resumen' : ' · las fotos no se guardaron: agrégalas desde Resumen'
  return ` · ${total - kept} de ${total} fotos no se guardaron: agrégalas desde Resumen`
}

// filas con un valor en plata ($ 000.000,00): las de la tabla mas los totales
const moneyRows = (text) => String(text || '').split('\n')
  .filter((l) => /[$§]\s*\d|\d{1,3}(?:[.,\s]\d{3})+[.,]\d{2}\b/.test(l)).length

// Lee la foto de una factura: el numero y las lineas, cada una con la prenda
// de la bodega que le corresponde (si la encontro). Si salieron muchas menos
// lineas que las filas que se ven, la foto quedo borrosa: se lee otra vez con
// mas nitidez y se queda la que reconocio mas prendas.
export async function readFactura(file, known, opts = {}) {
  const read = async (sharp, o) => {
    const text = await readPhoto(file, { ...o, sharp })
    const parsed = parseFactura(text)
    const matches = matchAll(parsed.lines, known)
    return { text, number: parsed.number, lines: parsed.lines, matches, found: matches.filter((m) => m.product).length }
  }
  const first = await read(false, opts)
  const expected = Math.max(1, moneyRows(first.text) - 3) // sin subtotal, IVA y total
  if (first.lines.length >= expected) return first
  const second = await read(true, { ...opts, onStage: () => opts.onStage?.('again') })
  const better = second.found > first.found || (second.found === first.found && second.lines.length > first.lines.length)
  const best = better ? second : first
  return { ...best, number: best.number || first.number || second.number }
}

// Solo el numero (va en letra grande arriba: se lee aunque la foto sea de lejos)
export async function readNumber(file) {
  return parseFactura(await readPhoto(file)).number
}

const STAGES = {
  preparing: 'Preparando el lector (la primera vez tarda un poco más).',
  reading: 'Buscando códigos y cantidades.',
  again: 'La foto quedó un poco borrosa: leyéndola otra vez con más nitidez.',
}

export function ReadingStep({ preview, stage, progress }) {
  return (
    <>
      <SheetHeader title="Leyendo la factura…" subtitle={STAGES[stage] || STAGES.preparing} />
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

// Tomar una foto (camara) o elegir una guardada; antes de usarla se recorta
function usePhotoPick(onFile) {
  const camera = useRef(null)
  const gallery = useRef(null)
  const [cropEl, crop] = useCrop()
  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const out = await crop(f)
    if (out) onFile(out)
  }
  const inputs = (
    <>
      {cropEl}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
    </>
  )
  return { inputs, camera: () => camera.current.click(), gallery: () => gallery.current.click() }
}

// La foto para leer: de cerca, solo la tabla (recortarla deja solo lo que se lee)
export function PhotoButtons({ onFile, label = 'Tomar foto de la tabla' }) {
  const { inputs, camera, gallery } = usePhotoPick(onFile)
  return (
    <>
      {inputs}
      <button type="button" className="btn btn-lime btn-lg btn-block" style={{ marginTop: 16 }} onClick={camera}>
        <Icon name="camera" size={20} />{label}
      </button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={gallery}>
        Elegir una foto guardada
      </button>
    </>
  )
}

// Otra foto de cerca para la parte de la tabla que no salio en la primera
export function ReadMoreButton({ onFile }) {
  const { inputs, camera } = usePhotoPick(onFile)
  return (
    <>
      {inputs}
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={camera}>
        <Icon name="camera" size={18} />Leer otra parte de la tabla
      </button>
    </>
  )
}

const thumb = (f) => (f ? URL.createObjectURL(f) : null)

// La foto que queda guardada dos meses: la factura completa, tomada ahi mismo
// despues de leer (de lejos esta bien: no se vuelve a leer, salvo el numero
// si todavia falta). Sin ella se guardan las fotos con las que se leyo.
export function ProofPhoto({ file, onChange, reads = 0, findNumber }) {
  const { inputs, camera, gallery } = usePhotoPick(onChange)
  const [url, setUrl] = useState(null)
  const [looking, setLooking] = useState(false)
  useEffect(() => {
    const u = thumb(file)
    setUrl(u)
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [file])
  // si falta el numero, se busca en la foto completa (va arriba, en letra grande)
  useEffect(() => {
    if (!file || !findNumber) return undefined
    let live = true
    setLooking(true)
    readNumber(file).then((n) => { if (live && n) findNumber(n) }).catch(() => {}).finally(() => { if (live) setLooking(false) })
    return () => { live = false }
  }, [file, findNumber])

  return (
    <div className="field proof">
      {inputs}
      <span className="field-label">Foto de la factura completa <small className="opt">se guarda dos meses</small></span>
      {file ? (
        <div className="proof-row">
          {url && <img src={url} alt="La factura completa" />}
          <span className="proof-t">
            <b>Lista para guardar</b>
            <small>{looking ? 'Buscando el número de la factura…' : reads ? `Se guarda con ${reads === 1 ? 'la foto que se leyó' : `las ${reads} fotos que se leyeron`}.` : 'Se guarda con la factura.'}</small>
          </span>
          <span className="proof-act">
            <button type="button" className="link-btn" onClick={camera}>Cambiar</button>
            <button type="button" className="link-btn" onClick={() => onChange(null)}>Quitar</button>
          </span>
        </div>
      ) : (
        <>
          <div className="proof-btns">
            <button type="button" className="btn btn-ink btn-block" onClick={camera}>
              <Icon name="camera" size={18} />Tomar la foto completa
            </button>
            <button type="button" className="btn btn-ghost" onClick={gallery} aria-label="Elegir una foto guardada">
              <Icon name="image" size={18} />
            </button>
          </div>
          <span className="field-hint">
            Toda la factura, aunque sea de lejos: no se vuelve a leer, es la prueba de lo que salió.
            {reads ? ` Si no la tomas, se guarda${reads === 1 ? ' la foto que se leyó' : `n las ${reads} fotos que se leyeron`}.` : ''}
          </span>
        </>
      )}
    </div>
  )
}
