import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

const MIN = 0.12 // el recorte mas pequeno (de lo ancho y lo alto de la foto)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// mover una esquina (o todo el recuadro) sin salirse de la foto
function apply(r, mode, dx, dy) {
  let { x, y, w, h } = r
  const right = x + w
  const bottom = y + h
  if (mode === 'move') return { w, h, x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h) }
  if (mode.includes('w')) { x = clamp(x + dx, 0, right - MIN); w = right - x }
  if (mode.includes('e')) { w = clamp(right + dx, x + MIN, 1) - x }
  if (mode.includes('n')) { y = clamp(y + dy, 0, bottom - MIN); h = bottom - y }
  if (mode.includes('s')) { h = clamp(bottom + dy, y + MIN, 1) - y }
  return { x, y, w, h }
}

// La foto recortada, en buena calidad (despues se achica para guardarla)
async function cropFile(file, url, r) {
  const img = new Image()
  img.src = url
  await img.decode()
  const sx = Math.round(r.x * img.naturalWidth)
  const sy = Math.round(r.y * img.naturalHeight)
  const sw = Math.max(1, Math.round(r.w * img.naturalWidth))
  const sh = Math.max(1, Math.round(r.h * img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) return file
  return new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '-recortada.jpg', { type: 'image/jpeg' })
}

function CropView({ src, onDone, onCancel }) {
  const imgRef = useRef(null)
  const [rect, setRect] = useState({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  // arrastrar: con el dedo o el mouse, en proporcion al tamano de la foto en pantalla
  const drag = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    const box = imgRef.current.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, rect }
    const move = (ev) => setRect(apply(start.rect, mode, (ev.clientX - start.x) / box.width, (ev.clientY - start.y) / box.height))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const done = async (whole) => {
    setBusy(true)
    await onDone(whole ? null : rect)
  }

  const pct = (v) => `${v * 100}%`
  return createPortal(
    <div className="crop" role="dialog" aria-modal="true" aria-label="Recortar la foto">
      <div className="crop-head">
        <span><b>Recorta la foto</b><small>Arrastra las esquinas para dejar solo el papel</small></span>
        <button type="button" className="crop-x" onClick={onCancel} aria-label="Cancelar"><Icon name="x" size={22} stroke={2.2} /></button>
      </div>
      <div className="crop-stage">
        <div className="crop-img">
          <img ref={imgRef} src={src} alt="Foto para recortar" draggable={false} />
          <div className="crop-box" style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
               onPointerDown={drag('move')}>
            {['nw', 'ne', 'sw', 'se'].map((c) => (
              <span key={c} className={`crop-h ${c}`} onPointerDown={drag(c)} aria-hidden="true"><i /></span>
            ))}
          </div>
        </div>
      </div>
      <div className="crop-foot">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => done(true)}>Usar la foto entera</button>
        <button type="button" className="btn btn-lime" disabled={busy} onClick={() => done(false)}>
          <Icon name="check" size={18} stroke={2.4} />{busy ? 'Recortando…' : 'Recortar'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

// Recortar una foto antes de usarla: crop(file) abre el recorte y devuelve la
// foto recortada (o la entera), o null si se cancelo. El elemento que
// devuelve se pone en la pantalla que lo usa.
export function useCrop() {
  const [job, setJob] = useState(null) // { file, url, resolve }
  const crop = useCallback((file) => new Promise((resolve) => setJob({ file, url: URL.createObjectURL(file), resolve })), [])
  const finish = async (out) => {
    URL.revokeObjectURL(job.url)
    setJob(null)
    job.resolve(out)
  }
  const el = job ? (
    <CropView
      src={job.url}
      onCancel={() => finish(null)}
      onDone={async (r) => finish(r ? await cropFile(job.file, job.url, r) : job.file)}
    />
  ) : null
  return [el, crop]
}
