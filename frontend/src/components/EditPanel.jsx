import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader } from './Sheet'
import Icon from './Icon'

const PARAMS = {
  bins: [['cols', 'Columnas'], ['rows', 'Filas']],
  shelf: [['w', 'Ancho'], ['levels', 'Niveles']],
  rack: [['w', 'Largo'], ['bars', 'Barras']],
  boxes: [['count', 'Cajas']],
  table: [['w', 'Largo']],
  ladder: [], balloons: [],
}
const STEP = { cols: 1, rows: 1, levels: 1, bars: 1, count: 1, w: 0.2 }
const TYPE_LABEL = { bins: 'Pared de canastas', shelf: 'Estantería', rack: 'Perchero', boxes: 'Cajas', table: 'Mesa', ladder: 'Escalera', balloons: 'Bombas' }
const fmtParam = (k, v) => (k === 'w' ? `${Number(v).toFixed(1)} m` : String(v))

const ICONS = {
  shelf: <svg viewBox="0 0 44 36"><path d="M4 4v30M40 4v30" /><path className="y" d="M4 12h36M4 22h36M4 32h36" /><rect x="8" y="14" width="10" height="7" /><rect x="21" y="14" width="10" height="7" /><rect x="8" y="24" width="10" height="7" /></svg>,
  rack: <svg viewBox="0 0 44 36"><path d="M4 3v31M40 3v31" /><path className="y" d="M4 8h36M4 20h36" /><path d="M10 8v9M15 8v9M20 8v9M25 8v9M10 20v9M15 20v9M20 20v9" /></svg>,
  bins: <svg viewBox="0 0 44 36"><path d="M4 4h36v28H4zM4 11h36M4 18h36M4 25h36M13 4v28M22 4v28M31 4v28" /></svg>,
  boxes: <svg viewBox="0 0 44 36"><path d="M4 18h17v15H4zM23 18h17v15H23zM13 4h17v14H13z" /></svg>,
  table: <svg viewBox="0 0 44 36"><path d="M3 14h38M7 14v18M37 14v18" /></svg>,
  ladder: <svg viewBox="0 0 44 36"><path d="M16 3l-8 30M26 3l8 30M13 12h16M11 21h20" /></svg>,
  balloons: <svg viewBox="0 0 44 36"><circle cx="16" cy="10" r="6" /><circle cx="28" cy="12" r="6" /><path d="M16 16l5 18M28 18l-7 16" /></svg>,
}
const HINTS = {
  shelf: 'Niveles con canastillas grises.',
  rack: 'Barras amarillas para colgar chaquetas.',
  bins: 'Gavetas negras por filas y columnas, como la pared C.',
  boxes: 'Cajas de cartón en el piso.',
  table: 'Mesa de despacho. Solo de referencia.',
  ladder: 'Solo de referencia.',
  balloons: 'Solo de referencia.',
}

function Mini({ value, onMinus, onPlus }) {
  return (
    <div className="mini">
      <button onClick={onMinus} aria-label="Menos"><Icon name="minus" size={17} stroke={2.4} /></button>
      <output>{value}</output>
      <button onClick={onPlus} aria-label="Más"><Icon name="plus" size={17} stroke={2.4} /></button>
    </div>
  )
}

export default function EditPanel({ room, element, getTheta, onDone, onChanged, onExit }) {
  const showToast = useToast()
  const [adding, setAdding] = useState(false)
  const [armedDelete, setArmedDelete] = useState(false)
  const [armedReset, setArmedReset] = useState(false)
  const [codeInput, setCodeInput] = useState(element?.code || '')

  useEffect(() => { setCodeInput(element?.code || ''); setArmedDelete(false) }, [element?.id, element?.code])

  const fail = (e, fallback) => showToast(e instanceof ApiError ? e.message : fallback, 'err')

  const roomStep = async (field, dir) => {
    const next = { width: room.width, depth: room.depth }
    next[field] = Math.max(4, Math.min(24, Math.round((next[field] + dir * 0.2) * 10) / 10))
    try {
      await api.put('/api/layout/room', next)
      onChanged()
    } catch (e) { fail(e, 'No se pudo cambiar el tamaño del cuarto.') }
  }

  const paramStep = async (key, dir) => {
    try {
      await api.patch(`/api/layout/elements/${element.id}`, { params: { [key]: element.params[key] + dir * STEP[key] } })
      onChanged()
    } catch (e) { fail(e, 'No se pudo cambiar el tamaño.') }
  }

  const move = async (dir) => {
    const th = getTheta ? getTheta() : 0
    let v = { u: [-Math.sin(th), -Math.cos(th)], d: [Math.sin(th), Math.cos(th)], r: [Math.cos(th), -Math.sin(th)], l: [-Math.cos(th), Math.sin(th)] }[dir]
    v = Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, Math.sign(v[1])]
    try {
      await api.patch(`/api/layout/elements/${element.id}`, { x: element.x + v[0] * 0.1, z: element.z + v[1] * 0.1 })
      onChanged()
    } catch (e) { fail(e, 'No se pudo mover.') }
  }

  const rotate = async () => {
    try {
      await api.patch(`/api/layout/elements/${element.id}`, { rot: (element.rot + 1) % 4 })
      onChanged()
    } catch (e) { fail(e, 'No se pudo girar.') }
  }

  const renameCode = async () => {
    const code = codeInput.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    if (!code || code === element.code) return
    try {
      await api.patch(`/api/layout/elements/${element.id}`, { code })
      onChanged()
      showToast(`Código cambiado a ${code}. Las prendas se movieron con él.`)
    } catch (e) { fail(e, 'No se pudo cambiar el código.'); setCodeInput(element.code) }
  }

  const duplicate = async () => {
    try {
      const el = await api.post(`/api/layout/elements/${element.id}/duplicate`)
      onChanged(el.id)
      showToast(`Duplicado como ${el.name}`)
    } catch (e) { fail(e, 'No se pudo duplicar.') }
  }

  const del = async () => {
    if (!armedDelete) { setArmedDelete(true); setTimeout(() => setArmedDelete(false), 3000); return }
    try {
      const name = element.name
      await api.delete(`/api/layout/elements/${element.id}`)
      onChanged(null)
      showToast(`${name} eliminado`)
    } catch (e) { fail(e, 'No se pudo eliminar.') }
  }

  const addElement = async (type) => {
    try {
      const el = await api.post('/api/layout/elements', { type, x: 0, z: 0, rot: 0 })
      setAdding(false)
      onChanged(el.id)
      showToast(`${el.name} agregado. Arrástralo a su lugar.`)
    } catch (e) { fail(e, 'No se pudo agregar.') }
  }

  const resetLayout = async () => {
    if (!armedReset) { setArmedReset(true); setTimeout(() => setArmedReset(false), 3000); return }
    try {
      await api.post('/api/layout/reset')
      onChanged(null)
      showToast('Distribución restaurada')
    } catch (e) { fail(e, 'No se pudo restaurar.') }
  }

  let body
  if (adding) {
    body = (
      <>
        <SheetHeader title="Agregar a la bodega" subtitle="Aparece en el centro. Después lo arrastras a su lugar." onClose={() => setAdding(false)} />
        <div className="types">
          {Object.keys(ICONS).map((k) => (
            <button className="type" key={k} onClick={() => addElement(k)}>
              {ICONS[k]}<b>{TYPE_LABEL[k]}</b><small>{HINTS[k]}</small>
            </button>
          ))}
        </div>
      </>
    )
  } else if (!element) {
    body = (
      <>
        <SheetHeader title="Distribución" subtitle="Toca un mueble para moverlo o cambiarlo." onClose={onExit} />
        <button className="btn btn-lime btn-block" onClick={() => setAdding(true)}><Icon name="plus" size={19} stroke={2.4} />Agregar mueble</button>
        <div className="ctl" style={{ marginTop: 10 }}><span>Ancho del cuarto</span>
          <Mini value={`${room.width.toFixed(1)} m`} onMinus={() => roomStep('width', -1)} onPlus={() => roomStep('width', 1)} />
        </div>
        <div className="ctl"><span>Fondo del cuarto</span>
          <Mini value={`${room.depth.toFixed(1)} m`} onMinus={() => roomStep('depth', -1)} onPlus={() => roomStep('depth', 1)} />
        </div>
        <button className="btn btn-danger btn-block" style={{ marginTop: 10 }} onClick={resetLayout}>
          {armedReset ? 'Toca otra vez para confirmar' : 'Volver a la distribución original'}
        </button>
      </>
    )
  } else {
    const storage = ['bins', 'shelf', 'rack', 'boxes'].includes(element.type)
    body = (
      <>
        <SheetHeader
          title={element.name}
          subtitle={storage ? `${element.locations.length} ${element.locations.length === 1 ? 'ubicación' : 'ubicaciones'}` : HINTS[element.type]}
          onClose={() => onDone()}
        />
        {storage && (
          <div className="ctl"><span>Código</span>
            <input className="code-in" value={codeInput} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck="false"
                   onChange={(e) => setCodeInput(e.target.value)} onBlur={renameCode} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
          </div>
        )}
        <div className="ctl"><span>Mover</span><div className="pad">
          <button onClick={() => move('l')} aria-label="Mover a la izquierda"><Icon name="arrowRight" size={18} stroke={2.3} style={{ transform: 'rotate(180deg)' }} /></button>
          <button onClick={() => move('u')} aria-label="Mover hacia el fondo"><Icon name="arrowRight" size={18} stroke={2.3} style={{ transform: 'rotate(-90deg)' }} /></button>
          <button onClick={() => move('d')} aria-label="Mover hacia el frente"><Icon name="arrowRight" size={18} stroke={2.3} style={{ transform: 'rotate(90deg)' }} /></button>
          <button onClick={() => move('r')} aria-label="Mover a la derecha"><Icon name="arrowRight" size={18} stroke={2.3} /></button>
          <button className="rot" onClick={rotate} aria-label="Girar 90 grados"><Icon name="undo" size={18} stroke={2.3} style={{ transform: 'scaleX(-1)' }} /></button>
        </div></div>
        {PARAMS[element.type].map(([key, label]) => (
          <div className="ctl" key={key}><span>{label}</span>
            <Mini value={fmtParam(key, element.params[key])} onMinus={() => paramStep(key, -1)} onPlus={() => paramStep(key, 1)} />
          </div>
        ))}
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={duplicate}><Icon name="copy" size={18} />Duplicar</button>
          <button className="btn btn-danger" onClick={del}>{armedDelete ? 'Toca otra vez' : 'Eliminar'}</button>
        </div>
        <p className="tip">También lo puedes arrastrar con un dedo. Las flechas lo mueven 10 cm.</p>
      </>
    )
  }

  return (
    <Sheet onClose={onExit} size="half" label="Editar distribución">
      {body}
    </Sheet>
  )
}
