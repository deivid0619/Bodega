import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../core/api'
import { bumpStock } from '../core/useApi'
import { useToast } from './ToastContext'
import { plural } from './Bits'

// Los + y − de una prenda en una ubicacion no se guardan al tocarlos: el
// numero cambia y queda marcado, y se guarda todo junto con "Guardar". Un
// toque sin querer no suma ni resta nada. Si se cierra sin guardar, no se
// guarda, pero el aviso deja guardarlo con un toque.

const keyOf = (sku, loc) => `${sku}|${loc || ''}`
const signed = (n) => (n > 0 ? `+${n}` : `−${-n}`)

async function persist(list) {
  const results = []
  let failed = null
  for (const [k, d] of list) {
    const [sku, loc] = k.split('|')
    try {
      results.push(await bumpStock(sku, d, loc || undefined))
    } catch (e) {
      failed = e
    }
  }
  return { results: results.filter(Boolean), failed }
}

// describe(sku) -> "Chaqueta Genesis · M" (para el resumen de la barra)
export function useStagedSteps(describe = (sku) => sku) {
  const showToast = useToast()
  const [deltas, setDeltas] = useState({}) // "codigo|ubicacion" -> cuanto se suma o resta
  const [saving, setSaving] = useState(false)
  const live = useRef(deltas)
  live.current = deltas
  const describeRef = useRef(describe)
  describeRef.current = describe

  const changes = Object.entries(deltas).filter(([, d]) => d)
  const summary = (list) => list.map(([k, d]) => `${signed(d)} ${describeRef.current(k.split('|')[0])}`).join(' · ')

  // al cerrar con cambios sin guardar: no se guardan, pero se puede con un toque
  useEffect(() => () => {
    const pending = Object.entries(live.current).filter(([, d]) => d)
    if (!pending.length) return
    showToast(`No se guardó: ${summary(pending)}`, 'info', {
      label: 'Guardar',
      onClick: async () => {
        const { failed } = await persist(pending)
        showToast(failed ? (failed instanceof ApiError ? failed.message : 'No se pudo guardar.') : 'Guardado', failed ? 'err' : 'ok')
      },
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const list = changes
    if (!list.length) return []
    setSaving(true)
    const { results, failed } = await persist(list)
    setSaving(false)
    setDeltas({})
    if (failed) showToast(failed instanceof ApiError ? failed.message : 'No se pudo guardar todo. Revisa los números.', 'err')
    else if (results.some((r) => r.queued)) showToast(`Sin señal: ${summary(list)} quedó guardado en el celular y se sube solo`)
    else showToast(`Guardado: ${summary(list)}`)
    return results
  }

  return {
    delta: (sku, loc) => deltas[keyOf(sku, loc)] || 0,
    step: (sku, loc, d) => setDeltas((m) => ({ ...m, [keyOf(sku, loc)]: (m[keyOf(sku, loc)] || 0) + d })),
    changes,
    summary: summary(changes),
    saving,
    save,
    discard: () => setDeltas({}),
  }
}

// La barra de abajo: cuantos cambios hay, Cancelar y Guardar
export function StagedBar({ staged, onSaved }) {
  const n = staged.changes.length
  if (!n) return null
  return (
    <div className="staged-bar" role="status">
      <span className="staged-t">
        <b>{plural(n, 'cambio sin guardar', 'cambios sin guardar')}</b>
        <small>{staged.summary}</small>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={staged.discard} disabled={staged.saving}>Cancelar</button>
      <button type="button" className="btn btn-lime btn-sm" onClick={async () => onSaved?.(await staged.save())} disabled={staged.saving}>
        {staged.saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

export const changedLabel = (d) => (d ? `${signed(d)} sin guardar` : '')
