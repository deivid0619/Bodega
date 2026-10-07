import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { usePolling } from '../hooks/useApi'
import { fmtTime } from '../utils'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import PushBox from './PushBox'

// Avisos para las personas de los enlaces "solo ver": quien registra una
// remision o unas entradas elige a quien avisarle ("Avisar a"); ellos los
// ven en su campana y les llegan al celular si lo activaron.

const SEEN = 'bodega_avisos_visto'
const readSeen = () => { try { return Number(localStorage.getItem(SEEN)) || 0 } catch { return 0 } }
const KEY = { remision: 'remision', in: 'entradas' }

// "Avisar a": las personas de los enlaces, marcadas segun lo que eligio el
// administrador para cada una; se puede cambiar antes de confirmar.
export function useNotifyPick(kind) {
  const { data } = usePolling('/api/notices/recipients', { interval: 60000 })
  const people = Array.isArray(data) ? data : [] // la cuenta "solo ver" recibe la lista vacia
  const [picked, setPicked] = useState(null) // Set de ids; null hasta que llega la lista
  useEffect(() => {
    if (picked === null && people.length) setPicked(new Set(people.filter((p) => p[KEY[kind]]).map((p) => p.id)))
  }, [people, picked, kind])
  const ids = people.filter((p) => picked?.has(p.id)).map((p) => p.id)
  const toggle = (id) => setPicked((s) => {
    const next = new Set(s || [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const el = people.length ? (
    <div className="notify-pick">
      <span className="notify-pick-t"><Icon name="bell" size={16} />Avisar a</span>
      <div className="notify-pick-chips">
        {people.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={!!picked?.has(p.id)} onClick={() => toggle(p.id)}>
            {picked?.has(p.id) && <Icon name="check" size={14} stroke={2.6} />}{p.name}
          </button>
        ))}
      </div>
      <small>{ids.length ? 'Le llega a su app y a su celular si activó los avisos.' : 'No se le avisa a nadie.'}</small>
    </div>
  ) : null
  return { el, ids, names: people.filter((p) => ids.includes(p.id)).map((p) => p.name) }
}

// Manda el aviso; devuelve lo que se agrega al mensaje de "listo"
export async function sendNotice({ kind, ids, names, title, body, url = '/summary' }) {
  if (!ids.length) return ''
  try {
    await api.post('/api/notices', { kind, links: ids, title: title.slice(0, 140), body: body.slice(0, 1000), url })
    return ` · aviso a ${names.join(' y ')}`
  } catch {
    return ' · el aviso no se mandó'
  }
}

// "CHAQUETA TOURING GRIS · M ×5, L ×2 · GUANTES VORTEX · XL ×1" (la misma
// talla repartida en dos lugares se suma)
export function itemsText(items) {
  const by = new Map()
  for (const it of items) {
    if (!it.qty) continue
    const sizes = by.get(it.name) || new Map()
    const size = it.size || 'única'
    sizes.set(size, (sizes.get(size) || 0) + it.qty)
    by.set(it.name, sizes)
  }
  return [...by].map(([name, sizes]) => `${name} · ${[...sizes].map(([s, q]) => `${s} ×${q}`).join(', ')}`).join(' · ')
}

function NoticeList() {
  const { close } = useSheet()
  const navigate = useNavigate()
  const { data, loading } = usePolling('/api/notices?limit=50', { interval: 20000 })
  const list = Array.isArray(data) ? data : []
  return (
    <>
      <SheetHeader title="Avisos" subtitle="Lo que te mandan desde la bodega: remisiones y entradas." />
      {loading && <p className="mode-hint">Cargando…</p>}
      {!loading && !list.length && (
        <p className="mode-hint">Todavía no hay avisos. Cuando te manden uno, aparece aquí.</p>
      )}
      {list.length > 0 && (
        <div className="card panel notice-list">
          {list.map((n) => (
            <button key={n.id} type="button" className="notice" onClick={() => { close(); navigate(n.url || '/summary') }}>
              <span className={`notice-dot ${n.kind}`} aria-hidden="true"><Icon name={n.kind === 'remision' ? 'receipt' : 'boxIn'} size={16} /></span>
              <span className="notice-t">
                <b>{n.title}</b>
                {n.body && <span>{n.body}</span>}
                <small>{fmtTime(n.created_at)}{n.user_name ? ` · ${n.user_name}` : ''}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <PushBox intro="Te llegan al celular aunque la app esté cerrada." />
    </>
  )
}

// La campana de la cuenta "solo ver": cuantos avisos nuevos hay y la lista
export function NoticesBell() {
  const showToast = useToast()
  const { data } = usePolling('/api/notices?limit=50', { interval: 20000 })
  const list = Array.isArray(data) ? data : []
  const [seen, setSeen] = useState(readSeen)
  const [open, setOpen] = useState(false)
  const toasted = useRef(null)
  const newest = list[0]?.id || 0
  const fresh = list.filter((n) => n.id > seen).length

  // con la app abierta, el aviso nuevo tambien sale en pantalla
  useEffect(() => {
    if (!data) return
    if (toasted.current === null) { toasted.current = newest; return }
    for (const n of list.filter((x) => x.id > toasted.current).reverse()) showToast(n.title, 'info')
    toasted.current = Math.max(toasted.current, newest)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const show = () => {
    setOpen(true)
    setSeen(newest)
    try { localStorage.setItem(SEEN, String(newest)) } catch { /* sin almacenamiento */ }
  }

  return (
    <>
      <button className="icon-btn" onClick={show} aria-label={fresh ? `Avisos: ${fresh} ${fresh === 1 ? 'nuevo' : 'nuevos'}` : 'Avisos'}>
        <Icon name="bell" />
        {fresh > 0 && <span className="pip count">{fresh > 9 ? '9+' : fresh}</span>}
      </button>
      {open && (
        <Sheet modal onClose={() => setOpen(false)} label="Avisos">
          <NoticeList />
        </Sheet>
      )}
    </>
  )
}
