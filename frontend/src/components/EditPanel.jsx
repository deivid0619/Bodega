import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import { useConfirm } from './ConfirmContext'
import Sheet, { SheetHeader } from './Sheet'
import Icon from './Icon'

const PARAMS = {
  bins: [['cols', 'Columnas'], ['rows', 'Filas']],
  shelf: [['w', 'Ancho'], ['levels', 'Niveles']],
  rack: [['w', 'Largo'], ['bars', 'Barras']],
  boxes: [['count', 'Cajas'], ['levels', 'Una encima de otra']],
  table: [['w', 'Largo'], ['bins', 'Canastas debajo']],
  ladder: [], balloons: [],
}
const STEP = { cols: 1, rows: 1, levels: 1, bars: 1, count: 1, bins: 1, w: 0.2 }
// los mismos limites que valida el servidor (layout_logic.PARAM_RANGES): aqui
// solo sirven para mostrar el cambio en el acto; el servidor manda
const RANGES = {
  bins: { cols: [1, 16], rows: [1, 10] },
  shelf: { w: [0.8, 5], levels: [1, 6] },
  rack: { w: [0.8, 6], bars: [1, 4] },
  boxes: { count: [1, 40], levels: [1, 6] },
  table: { w: [1, 4], bins: [0, 30] },
}
const PARAM_DEFAULT = { boxes: { levels: 2 } }
const paramOf = (el, key) => el.params[key] ?? PARAM_DEFAULT[el.type]?.[key] ?? 0
const round = (v, step = 0.1) => +(Math.round(v / step) * step).toFixed(2)
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
  table: 'Mesa de despacho, apoyada sobre pilas de canastas que también guardan prendas.',
  ladder: 'Solo de referencia.',
  balloons: 'Solo de referencia.',
}

// el outlet puede ser todo el mueble o solo algunas ubicaciones (esas se
// marcan tocandolas en la bodega, fuera del editor)
function outletHint(element) {
  if (element.params.outlet) return 'Todo el mueble: lo que haya aquí no cuenta en el inventario'
  const some = (element.locations || []).filter((l) => l.outlet).map((l) => l.id)
  if (some.length) return `Solo ${some.slice(0, 4).join(', ')}${some.length > 4 ? '…' : ''}. Actívalo para todo el mueble`
  return 'Todo el mueble. Para una sola ubicación, tócala en la bodega fuera del editor'
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

export default function EditPanel({ room, element, getTheta, onDone, onChanged, onDraft, onSettled, onExit }) {
  const showToast = useToast()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  const [codeInput, setCodeInput] = useState(element?.code || '')
  const [armedType, setArmedType] = useState(null)
  const typeTimer = useRef(null)

  useEffect(() => { setCodeInput(element?.code || ''); setArmedDelete(false); setArmedType(null) }, [element?.id, element?.code, element?.type])

  const fail = (e, fallback) => showToast(e instanceof ApiError ? e.message : fallback, 'err')

  // Lo que se cambia se ve en el acto (borrador) y va al servidor en un solo
  // envio cuando se deja de tocar: cinco toques en + no son cinco viajes.
  const pending = useRef(null) // { id, body }
  const ver = useRef(0)
  const flushTimer = useRef(null)
  const chain = useRef(Promise.resolve())
  const flush = () => {
    clearTimeout(flushTimer.current)
    const job = pending.current
    pending.current = null
    if (!job) return chain.current
    const v = ver.current
    chain.current = chain.current.then(async () => {
      try {
        await api.patch(`/api/layout/elements/${job.id}`, job.body)
      } catch (e) {
        fail(e, 'No se pudo guardar el cambio.')
      }
      await onSettled(job.id, v)
    })
    return chain.current
  }
  const queue = (fields) => {
    if (pending.current && pending.current.id !== element.id) flush()
    const body = pending.current?.body || {}
    const params = fields.params ? { params: { ...(body.params || {}), ...fields.params } } : {}
    pending.current = { id: element.id, body: { ...body, ...fields, ...params } }
    ver.current += 1
    onDraft(element.id, fields, ver.current)
    clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(flush, 450)
  }
  // antes de otra accion (o al cambiar de mueble / salir), lo pendiente se guarda primero
  const saved = () => flush()
  useEffect(() => () => { flush() }, [element?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const roomStep = async (field, dir) => {
    const next = { width: room.width, depth: room.depth }
    next[field] = Math.max(4, Math.min(24, Math.round((next[field] + dir * 0.2) * 10) / 10))
    try {
      await api.put('/api/layout/room', next)
      onChanged()
    } catch (e) { fail(e, 'No se pudo cambiar el tamaño del cuarto.') }
  }

  const paramStep = (key, dir) => {
    const [lo, hi] = RANGES[element.type]?.[key] || [0, 99]
    const cur = Number(paramOf(element, key))
    const next = round(Math.min(hi, Math.max(lo, cur + dir * STEP[key])), key === 'w' ? 0.1 : 1)
    if (next !== cur) queue({ params: { [key]: next } })
  }

  const move = (dir) => {
    const th = getTheta ? getTheta() : 0
    let v = { u: [-Math.sin(th), -Math.cos(th)], d: [Math.sin(th), Math.cos(th)], r: [Math.cos(th), -Math.sin(th)], l: [-Math.cos(th), Math.sin(th)] }[dir]
    v = Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, Math.sign(v[1])]
    const inRoom = (val, size) => round(Math.min(size / 2, Math.max(-size / 2, val)), 0.01)
    queue({ x: inRoom(element.x + v[0] * 0.1, room.width), z: inRoom(element.z + v[1] * 0.1, room.depth) })
  }

  const rotate = () => queue({ rot: (element.rot + 1) % 4 })

  // subirlo para ponerlo encima de otro mueble (cajas sobre canastas...)
  const heightStep = (dir) => {
    const cur = element.y0 || 0
    const next = round(Math.min(2.6, Math.max(0, cur + dir * 0.1)))
    if (next !== cur) queue({ y0: next })
  }

  const renameCode = async () => {
    const code = codeInput.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    if (!code || code === element.code) return
    await saved()
    try {
      await api.patch(`/api/layout/elements/${element.id}`, { code })
      onChanged()
      showToast(`Código cambiado a ${code}. Las prendas se movieron con él.`)
    } catch (e) { fail(e, 'No se pudo cambiar el código.'); setCodeInput(element.code) }
  }

  // canastas <-> cajas: el segundo toque confirma, porque mueve lo que tenga guardado
  const changeType = async (type) => {
    if (type === element.type) return
    clearTimeout(typeTimer.current)
    if (armedType !== type) {
      setArmedType(type)
      typeTimer.current = setTimeout(() => setArmedType(null), 4000)
      return
    }
    setArmedType(null)
    await saved()
    try {
      const el = await api.patch(`/api/layout/elements/${element.id}`, { type })
      onChanged(el.id)
      const where = el.locations[0]?.id
      showToast(`Ahora es ${el.name}.${where ? ` Si había algo guardado, quedó en ${where}.` : ''}`)
    } catch (e) { fail(e, 'No se pudo cambiar el tipo.') }
  }

  const duplicate = async () => {
    await saved()
    try {
      const el = await api.post(`/api/layout/elements/${element.id}/duplicate`)
      onChanged(el.id)
      showToast(`Duplicado como ${el.name}`)
    } catch (e) { fail(e, 'No se pudo duplicar.') }
  }

  const del = async () => {
    const ok = await confirm({
      title: `¿Eliminar ${element.name}?`,
      body: 'Se quita este mueble de la bodega. Si tiene prendas, no se deja eliminar hasta que las muevas a otro lugar.',
      confirmLabel: 'Sí, eliminar',
    })
    if (!ok) return
    await saved()
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
    const ok = await confirm({
      title: '¿Volver a la distribución original?',
      body: 'Se pierden los muebles agregados y los cambios de tamaño y de lugar. Las prendas no se tocan: si alguna quedaría sin ubicación, no se hace.',
      confirmLabel: 'Sí, restaurar',
    })
    if (!ok) return
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
          Volver a la distribución original
        </button>
      </>
    )
  } else {
    const storage = ['bins', 'shelf', 'rack', 'boxes', 'table'].includes(element.type)
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
        {(element.type === 'bins' || element.type === 'boxes') && (
          <>
            <div className="ctl"><span>Tipo</span>
              <div className="type-seg" role="group" aria-label="Tipo de mueble">
                {[['bins', 'Canastas'], ['boxes', 'Cajas']].map(([t, label]) => (
                  <button key={t} type="button" aria-pressed={element.type === t} className={armedType === t ? 'armed' : ''} onClick={() => changeType(t)}>
                    {armedType === t ? '¿Seguro?' : label}
                  </button>
                ))}
              </div>
            </div>
            {armedType && (
              <p className="tip type-tip">
                Toca “¿Seguro?” otra vez para cambiarlo a {armedType === 'boxes'
                  ? 'cajas: lo que haya en las canastas pasa a las cajas.'
                  : 'canastas: lo que haya en las cajas pasa a la primera canasta.'}
              </p>
            )}
          </>
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
            <Mini value={fmtParam(key, paramOf(element, key))} onMinus={() => paramStep(key, -1)} onPlus={() => paramStep(key, 1)} />
          </div>
        ))}
        {storage && (
          <div className="ctl outlet-ctl">
            <span>Outlet<small>{outletHint(element)}</small></span>
            <button type="button" className="switch" role="switch" aria-checked={!!element.params.outlet} aria-label="Outlet"
                    onClick={() => queue({ params: { outlet: !element.params.outlet } })} />
          </div>
        )}
        {(element.type === 'bins' || element.type === 'boxes') && (
          <div className="ctl"><span>Altura del piso</span>
            <Mini value={`${(element.y0 || 0).toFixed(1)} m`} onMinus={() => heightStep(-1)} onPlus={() => heightStep(1)} />
          </div>
        )}
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={duplicate}><Icon name="copy" size={18} />Duplicar</button>
          <button className="btn btn-danger" onClick={del}>Eliminar</button>
        </div>
        <p className="tip">
          También lo puedes arrastrar con un dedo. Las flechas lo mueven 10 cm.
          {(element.type === 'bins' || element.type === 'boxes') && ' Para ponerlo encima de otro mueble, ponlo en el mismo sitio y súbelo con “Altura del piso”.'}
        </p>
      </>
    )
  }

  return (
    <Sheet onClose={onExit} size="half" label="Editar distribución">
      {body}
    </Sheet>
  )
}
