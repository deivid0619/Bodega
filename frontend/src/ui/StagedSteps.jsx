import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../core/api'
import { bumpStock } from '../core/useApi'
import { useToast } from './ToastContext'
import { plural } from './Bits'

// Los + y − de una prenda (en una ubicacion o en la reserva) no se guardan
// al tocarlos: el numero cambia y queda marcado, y se guarda todo junto con
// "Guardar". Un toque sin querer no suma ni resta nada. Si se cierra sin
// guardar, no se guarda, pero el aviso deja guardarlo con un toque.

const keyOf = (sku, loc) => `${sku}|${loc || ''}`
const signed = (n) => (n > 0 ? `+${n}` : `−${-n}`)

// por defecto, en la bodega: suma o resta en esa ubicacion
const inWarehouse = (sku, loc, d) => bumpStock(sku, d, loc || undefined)

// todos a la vez: cada uno cambia la pantalla en el acto (bodega y reserva
// lo muestran antes de que el servidor responda) y se manda por su lado
async function persist(list, apply) {
  const settled = await Promise.allSettled(list.map(async ([k, d]) => {
    const [sku, loc] = k.split('|')
    return apply(sku, loc, d)
  }))
  const failed = settled.find((x) => x.status === 'rejected')?.reason || null
  return { results: settled.filter((x) => x.status === 'fulfilled' && x.value).map((x) => x.value), failed }
}

// describe(sku) -> "Chaqueta Genesis · M" (para el resumen de la barra);
// apply(sku, ubicacion, cuanto) guarda uno (por defecto, en la bodega)
export function useStagedSteps(describe = (sku) => sku, apply = inWarehouse) {
  const showToast = useToast()
  const [deltas, setDeltas] = useState({}) // "codigo|ubicacion" -> cuanto se suma o resta
  const [sending, setSending] = useState([]) // lo que se esta guardando
  const live = useRef(deltas)
  live.current = deltas
  const describeRef = useRef(describe)
  describeRef.current = describe
  const applyRef = useRef(apply)
  applyRef.current = apply

  const changes = Object.entries(deltas).filter(([, d]) => d)
  const summary = (list) => list.map(([k, d]) => `${signed(d)} ${describeRef.current(k.split('|')[0])}`).join(' · ')

  // al cerrar con cambios sin guardar: no se guardan, pero se puede con un toque
  useEffect(() => () => {
    const pending = Object.entries(live.current).filter(([, d]) => d)
    if (!pending.length) return
    showToast(`No se guardó: ${summary(pending)}`, 'info', {
      label: 'Guardar',
      onClick: async () => {
        const { failed } = await persist(pending, applyRef.current)
        showToast(failed ? (failed instanceof ApiError ? failed.message : 'No se pudo guardar.') : 'Guardado', failed ? 'err' : 'ok')
      },
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const list = changes
    if (!list.length) return []
    // al mandarlo, el numero nuevo ya queda en la pantalla: lo marcado se quita
    // en ese mismo momento (si no, mientras responde se veria restado dos
    // veces: 17, −1, Guardar y salia 15 antes de quedar en 16)
    setDeltas({})
    setSending(list)
    const { results, failed } = await persist(list, applyRef.current)
    setSending([])
    if (failed) showToast(failed instanceof ApiError ? failed.message : 'No se pudo guardar todo. Revisa los números.', 'err')
    else if (results.some((r) => r.queued)) showToast(`Sin señal: ${summary(list)} quedó guardado en el celular y se sube solo`)
    else showToast(`Guardado: ${summary(list)}`)
    return results
  }

  return {
    delta: (sku, loc) => deltas[keyOf(sku, loc)] || 0,
    step: (sku, loc, d) => setDeltas((m) => ({ ...m, [keyOf(sku, loc)]: (m[keyOf(sku, loc)] || 0) + d })),
    forget: (sku, loc) => setDeltas((m) => ({ ...m, [keyOf(sku, loc)]: 0 })),
    changes,
    summary: summary(changes),
    saving: sending.length > 0,
    sendingSummary: summary(sending),
    save,
    discard: () => setDeltas({}),
  }
}

// La barra de abajo: cuantos cambios hay, Cancelar y Guardar. En una hoja va
// pegada abajo; en una pagina (floating) flota encima de la barra de secciones.
export function StagedBar({ staged, onSaved, floating }) {
  const n = staged.changes.length
  if (!n && !staged.saving) return null
  const busy = staged.saving && !n
  return (
    <div className={`staged-bar${floating ? ' floating' : ''}`} role="status">
      <span className="staged-t">
        <b>{busy ? 'Guardando…' : plural(n, 'cambio sin guardar', 'cambios sin guardar')}</b>
        <small>{busy ? staged.sendingSummary : staged.summary}</small>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={staged.discard} disabled={staged.saving}>Cancelar</button>
      <button type="button" className="btn btn-lime btn-sm" onClick={async () => {
        const results = await staged.save() // siempre: onSaved puede no venir
        onSaved?.(results)
      }} disabled={staged.saving}>
        {staged.saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

export const changedLabel = (d) => (d ? `${signed(d)} sin guardar` : '')
