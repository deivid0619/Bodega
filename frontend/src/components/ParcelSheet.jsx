import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../context/AuthContext'
import { mutate, revalidate, useLayout, usePolling } from '../hooks/useApi'
import { DISPATCH, locationGroups } from '../locationGroups'
import { fmtTime } from '../utils'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { Empty, Stepper } from './Bits'

// Lo que esta de paso sin ser inventario: una caja suelta, una canasta, una
// bolsa... con de quien es y que hacer con ella. No suma a la bodega ni a
// los reportes; sale de la lista con "Ya salio".
export const KINDS = [
  { k: 'caja', label: 'Caja', icon: 'box', one: 'caja', many: 'cajas' },
  { k: 'canasta', label: 'Canasta', icon: 'crate', one: 'canasta', many: 'canastas' },
  { k: 'bolsa', label: 'Bolsa', icon: 'bag', one: 'bolsa', many: 'bolsas' },
  { k: 'otro', label: 'Otro', icon: 'tag' },
]
const KIND = Object.fromEntries(KINDS.map((x) => [x.k, x]))
const TODO = ['Enviar', 'Entregar al cliente', 'Vienen a recogerlo', 'Devolver al proveedor', 'Revisar']

// "2 cajas", "1 canasta", "Casco", "Casco (2)": igual que en los avisos
export function parcelName(p) {
  const k = KIND[p.kind]
  if (k?.one) return `${p.qty} ${p.qty === 1 ? k.one : k.many}`
  const label = p.label || 'Otro'
  return p.qty === 1 ? label : `${label} (${p.qty})`
}

export const parcelIcon = (p) => KIND[p.kind]?.icon || 'tag'

// cuanto lleva esperando; pasada una semana se marca: lo de paso debe salir pronto
export function waited(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return { text: days <= 0 ? 'llegó hoy' : days === 1 ? 'llegó ayer' : `lleva ${days} días`, late: days > 7 }
}

// "Ya salio" desde cualquier lista: sale de la lista en el acto, con
// Deshacer en el aviso de abajo por si fue un toque sin querer.
export async function markDone(parcel, showToast) {
  mutate('/api/parcels', (list) => list.filter((x) => x?.id !== parcel.id))
  try {
    await api.post(`/api/parcels/${parcel.id}/done`)
    showToast(`Ya salió: ${parcelName(parcel)}${parcel.owner ? ` · ${parcel.owner}` : ''}`, 'ok', {
      label: 'Deshacer',
      onClick: async () => {
        try {
          await api.post(`/api/parcels/${parcel.id}/reopen`)
          showToast('Volvió a la lista')
        } catch (e) {
          showToast(e instanceof ApiError ? e.message : 'No se pudo deshacer.', 'err')
        }
        revalidate('/api/parcels')
      },
    })
  } catch (e) {
    showToast(e instanceof ApiError ? e.message : 'No se pudo marcar. Intenta otra vez.', 'err')
  }
  revalidate('/api/parcels')
}

function Form({ parcel, defaultLocation, showMap }) {
  const { close } = useSheet()
  const showToast = useToast()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const { data: layout } = useLayout()
  const { data: owners } = usePolling('/api/parcels/owners', { interval: 120000 })
  const groups = useMemo(() => locationGroups(layout?.elements, { dispatch: false }), [layout])
  const editing = !!parcel
  const [kind, setKind] = useState(parcel?.kind || 'caja')
  const [label, setLabel] = useState(parcel?.label || '')
  const [qty, setQty] = useState(parcel?.qty || 1)
  const [owner, setOwner] = useState(parcel?.owner || '')
  const [notes, setNotes] = useState(parcel?.notes || '')
  const [place, setPlace] = useState(parcel?.location_id || defaultLocation || DISPATCH)
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const labelRef = useRef(null)
  const notesRef = useRef(null)

  const known = groups.some((g) => g.options.some((l) => l.id === place))
  const problem = kind === 'otro' && !label.trim() ? 'Escribe qué es.'
    : !owner.trim() && !notes.trim() ? 'Escribe de quién es o qué hay que hacer.' : ''
  const canDelete = editing && (isAdmin || parcel.user_id === user?.id)

  // el foco va en el mismo toque (flushSync): el iPhone solo abre el teclado asi
  const pickKind = (k) => {
    flushSync(() => setKind(k))
    if (k === 'otro') labelRef.current?.focus()
  }

  // el atajo escribe el comienzo y deja el cursor al final para completarlo
  const addTodo = (t) => {
    const cur = notes.trim().replace(/[.,;]$/, '')
    const next = cur ? `${cur}. ${t} ` : `${t} `
    flushSync(() => setNotes(next))
    const el = notesRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(next.length, next.length)
  }

  const save = async () => {
    if (problem || busy) return
    setBusy(true)
    const body = { kind, label: kind === 'otro' ? label : '', qty, owner, notes, location_id: place }
    try {
      const res = editing ? await api.patch(`/api/parcels/${parcel.id}`, body) : await api.post('/api/parcels', body)
      revalidate('/api/parcels')
      showToast(editing ? 'Cambios guardados' : `Anotado: ${parcelName(res)}${res.owner ? ` · ${res.owner}` : ''}`)
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo guardar. Intenta otra vez.', 'err')
      setBusy(false)
    }
  }

  const leave = () => {
    markDone(parcel, showToast)
    close()
  }

  const remove = async () => {
    if (!sure) {
      setSure(true)
      return
    }
    try {
      await api.delete(`/api/parcels/${parcel.id}`)
      revalidate('/api/parcels')
      showToast('Borrado de la lista')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo borrar.', 'err')
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-set">De paso</span></div>}
        title={editing ? parcelName(parcel) : 'Anotar algo de paso'}
        subtitle={editing
          ? `Anotado ${fmtTime(parcel.created_at)} por ${parcel.user_name}`
          : 'Una caja suelta, una canasta o lo que entre aparte y salga pronto.'}
      />

      <span className="field-label">¿Qué es?</span>
      <div className="kind-pick" role="radiogroup" aria-label="Qué es">
        {KINDS.map((x) => (
          <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} onClick={() => pickKind(x.k)}>
            <Icon name={x.icon} size={22} />{x.label}
          </button>
        ))}
      </div>
      {kind === 'otro' && (
        <input
          ref={labelRef}
          className="input"
          style={{ marginTop: 10 }}
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="¿Qué es? Ej. un casco, un rollo de tela"
          aria-label="Qué es"
        />
      )}

      <div className="card scan-qty">
        <div><b>Cantidad</b><small>Cuántas son iguales</small></div>
        <Stepper
          value={qty}
          onMinus={() => setQty((q) => Math.max(1, q - 1))}
          onPlus={() => setQty((q) => Math.min(999, q + 1))}
          disabledMinus={qty <= 1}
        />
      </div>

      <label className="field">
        <span className="field-label">¿De quién es? <small className="opt">o para quién</small></span>
        <input
          className="input"
          value={owner}
          maxLength={120}
          onChange={(e) => setOwner(e.target.value)}
          list="parcel-owners"
          placeholder="Ej. un cliente, una tienda, un taller"
          autoCapitalize="words"
          autoComplete="off"
        />
        <datalist id="parcel-owners">{(owners || []).map((o) => <option key={o} value={o} />)}</datalist>
      </label>

      <label className="field">
        <span className="field-label">¿Qué hay que hacer?</span>
        <textarea
          ref={notesRef}
          className="input notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej. enviar el viernes por la transportadora"
        />
      </label>
      <div className="chips todo-chips" role="toolbar" aria-label="Atajos para qué hacer">
        {TODO.map((t) => <button key={t} type="button" className="chip" onClick={() => addTodo(t)}>{t}</button>)}
      </div>

      <label className="field">
        <span className="field-label">¿Dónde quedó?</span>
        <select className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value={DISPATCH}>Despacho (de paso)</option>
          {place !== DISPATCH && !known && layout && <option value={place}>{parcel?.location_name || place}</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="field-hint">No cuenta como inventario: queda en Resumen, en “Por despachar”, hasta que salga.</span>
      </label>
      {editing && showMap && known && (
        <button type="button" className="link-btn parcel-map" onClick={() => { close(); navigate(`/?loc=${encodeURIComponent(place)}`) }}>
          <Icon name="pin" size={14} stroke={2.2} />Ver {place} en la bodega
        </button>
      )}

      <div className="doc-footer">
        {problem && <p className="mode-hint">{problem}</p>}
        {editing ? (
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button className="btn btn-ghost btn-lg" disabled={!!problem || busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
            <button className="btn btn-ink btn-lg" onClick={leave}><Icon name="check" size={18} stroke={2.4} />Ya salió</button>
          </div>
        ) : (
          <button className="btn btn-lime btn-lg btn-block" disabled={!!problem || busy} onClick={save}>{busy ? 'Guardando…' : 'Anotar'}</button>
        )}
        {canDelete && (
          <button type="button" className={`link-btn parcel-del ${sure ? 'sure' : ''}`} onClick={remove}>
            {sure ? 'Toca otra vez para borrarlo' : 'Borrar: lo anoté por error'}
          </button>
        )}
      </div>
    </>
  )
}

export default function ParcelSheet({ parcel = null, defaultLocation, showMap = true, onClose }) {
  return (
    <Sheet modal onClose={onClose} label={parcel ? parcelName(parcel) : 'Anotar algo de paso'}>
      <Form parcel={parcel} defaultLocation={defaultLocation} showMap={showMap} />
    </Sheet>
  )
}

// Lo que ya salio, con quien lo saco y cuando; "Volver" lo regresa a la lista.
function DoneList() {
  const showToast = useToast()
  const { data } = usePolling('/api/parcels?state=done&limit=60', { interval: 30000 })
  const back = async (p) => {
    try {
      await api.post(`/api/parcels/${p.id}/reopen`)
      showToast(`Volvió a la lista: ${parcelName(p)}`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo.', 'err')
    }
    revalidate('/api/parcels')
  }
  return (
    <>
      <SheetHeader title="Lo que ya salió" subtitle="Lo último que salió de paso: quién lo sacó y cuándo." />
      {!data ? <div className="skeleton" /> : data.length ? (
        <div className="card panel">
          {data.map((p) => (
            <div className="need parcel" key={p.id}>
              <span className="parcel-ico"><Icon name={parcelIcon(p)} size={20} /></span>
              <span className="need-t">
                <b>{parcelName(p)}{p.owner ? ` · ${p.owner}` : ''}</b>
                {p.notes && <small className="note wrap">{p.notes}</small>}
                <small>Salió {fmtTime(p.done_at)} · {p.done_by}</small>
              </span>
              <button type="button" className="link-btn" onClick={() => back(p)}><Icon name="undo" size={14} stroke={2.2} />Volver</button>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="check" title="Nada todavía">Lo que marques con “Ya salió” aparece aquí.</Empty>
      )}
    </>
  )
}

export function ParcelsDoneSheet({ onClose }) {
  return (
    <Sheet modal onClose={onClose} label="Lo que ya salió">
      <DoneList />
    </Sheet>
  )
}
