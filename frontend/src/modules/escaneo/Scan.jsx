import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, isNetworkError } from '../../core/api'
import { cachedProduct, moveStock, refreshInventory, setReserveQty, undoQueued, useLayout, useReserve } from '../../core/useApi'
import { useToast } from '../../ui/ToastContext'
import { useConfirm } from '../../ui/ConfirmContext'
import { locationGroups } from '../../core/locationGroups'
import NewProductModal from '../inventario/NewProductModal'
import NewReserveModal from '../reserva/NewReserveModal'
import { readDraft as readRemisionDraft } from '../remisiones/draft'
import { ProductSearchSheet } from '../reserva/ProductSearch'
import FacturaSheet from '../facturas/FacturaSheet'
import RemisionSheet from '../remisiones/RemisionSheet'
import ParcelSheet from '../despacho/ParcelSheet'
import Icon from '../../ui/Icon'
import { PageHead, Stepper, plural } from '../../ui/Bits'
import { useBarcodeScanner } from './useBarcodeScanner'
import Viewfinder, { PhotoRead } from './Viewfinder'
import { beep } from '../../core/feedback'
import { fmtTime, fromMissing, isSplit, outAvailable, outParts, outletIdsOf, placesOf, reserveFor, reserveIndex } from '../../core/utils'
import FromPick from '../../ui/FromPick'
import { itemsText, sendNotice, useNotifyPick } from '../avisos/Notices'
import LocationPicker, { LocationPickerSheet } from '../../ui/LocationPicker'
import SplitRow from '../remisiones/SplitRow'
import { blockId, partsTotal, splitRow } from '../remisiones/refs'

const MODES = [
  { m: 'in', label: 'Entrada', icon: 'boxIn', hint: 'Cada código suma prendas a su ubicación.' },
  { m: 'out', label: 'Salida', icon: 'boxOut', hint: 'Cada código descuenta prendas: ventas y despachos.' },
  { m: 'set', label: 'Conteo', icon: 'equals', hint: 'Cada código reemplaza el total por lo que contaste.' },
  { m: 'reserve', label: 'Reserva', icon: 'reserve', hint: 'Cada código se guarda en la reserva, aparte y sin ubicación. Se identifica solo, aunque no esté registrado en la bodega.' },
]
const LABEL = { in: 'Entrada', out: 'Salida', set: 'Conteo', new: 'Registro nuevo', move: 'Traslado', reserve: 'A la reserva' }

const qtyText = (m) => (m.type === 'out' ? `−${m.qty}` : m.type === 'set' ? `=${m.after}` : m.type === 'move' ? `↔${m.qty}` : `+${m.qty}`)
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const delta = (m) => (m.type === 'in' || m.type === 'new' ? m.qty : m.type === 'out' ? -m.qty : 0)

// "Confirmar antes de guardar": lo escaneado queda en una lista en este
// celular (sobrevive a recargar) hasta que se confirma
const TO_CONFIRM_KEY = 'bodega_por_confirmar'
const CONFIRM_KEY = 'bodega_confirmar'
const ONE_KEY = 'bodega_una_a_la_vez'
function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // sin almacenamiento (modo privado): la lista vive solo en esta pantalla
  }
}

// "Salió de P-A1 (3) y C-1-2 (1)", "Entró a C-1-3"...
function placesText(res) {
  const parts = res.movements?.length ? res.movements : [res.movement]
  const where = parts.map((m) => (parts.length > 1 ? `${m.location_id} (${m.qty})` : m.location_id)).join(' y ')
  const verb = { in: 'Entró a', out: 'Salió de', set: 'Contado en', new: 'Registrada en', move: 'Movida desde' }[res.movement.type] || 'En'
  return `${verb} ${where}`
}

// donde quedo lo que se escaneo (no la ubicacion principal del codigo):
// "C-1-2", o "C-1-1 +1" si salio de varias
function movedAt(res) {
  const where = [...new Set((res.movements?.length ? res.movements : [res.movement]).map((m) => m.location_id))]
  return where.length > 1 ? `${where[0]} +${where.length - 1}` : where[0]
}

// Lo que se acaba de registrar, encima de la camara: se ve sin dejar de
// apuntar. Antes el aviso quedaba debajo, fuera de la vista, y no se sabia
// si la lectura habia contado (o si conto dos veces)
function ScanHit({ hit, tally, onUndo }) {
  if (hit.err) {
    return (
      <>
        <span key={hit.at} className="vf-pulse err" aria-hidden="true" />
        <div key={`h${hit.at}`} className="vf-hit err" role="status" aria-live="assertive">
          <Icon name="alert" size={22} />
          <span className="vf-hit-t"><b>No se registró</b><small>{hit.err}</small></span>
        </div>
      </>
    )
  }
  const sign = hit.type === 'out' ? `−${hit.qty}` : hit.type === 'set' ? `=${hit.total}` : `+${hit.qty}`
  return (
    <>
      <span key={hit.at} className="vf-pulse" aria-hidden="true" />
      <div key={`h${hit.at}`} className={`vf-hit ${hit.pending ? 'pending' : ''}`} role="status" aria-live="polite">
        <b className={`vf-hit-q ${hit.type === 'out' ? 'out' : ''}`}>{sign}</b>
        {/* la foto de la prenda (de la bodega o de la tienda): se ve que es esa */}
        {hit.image && <img className="vf-hit-img" src={hit.image} alt="" />}
        <span className="vf-hit-t">
          <b>{hit.name}{hit.size ? ` · ${hit.size}` : ''}</b>
          {hit.pending ? (
            <small>
              Por confirmar · llevas {signed(hit.type === 'out' ? -hit.lineQty : hit.lineQty)}{hit.n > 1 ? ` (${hit.n} lecturas)` : ''}
              {hit.type === 'reserve' && (hit.inReserve ? ` · en la reserva hay ${hit.inReserve}` : ' · nueva en la reserva')}
            </small>
          ) : hit.type === 'reserve' ? (
            <small>Guardada en la reserva · ahí hay {hit.total}{hit.created ? ' (nueva)' : ''}</small>
          ) : (
            <small>
              {tally && `${tally.n === 1 ? '1 vez' : `${tally.n} veces`} en esta sesión · llevas ${signed(tally.net)} · `}hay {hit.total}
            </small>
          )}
          {hit.short && <small className="vf-hit-warn">Solo hay {hit.have}: revisa antes de confirmar</small>}
          {!hit.pending && hit.type === 'in' && hit.inReserve > 0 && (
            <small className="vf-hit-warn">Hay {hit.inReserve} en la reserva: si vienen de allá, deshaz y envíalas desde Reserva</small>
          )}
          {hit.queued && <small className="vf-hit-warn">Sin señal: quedó guardado en el celular y se sube solo</small>}
          {hit.label && <small>Etiqueta {hit.label} · se usó el código bueno {hit.sku}</small>}
          {hit.repeat && <small className="vf-hit-warn">Otra vez la misma prenda: ¿la contaste dos veces?</small>}
        </span>
        <button type="button" className="vf-hit-undo" onClick={onUndo}>{hit.pending ? 'Quitar' : 'Deshacer'}</button>
      </div>
    </>
  )
}

export default function Scan() {
  const notifyIn = useNotifyPick('in', 'Avisar las entradas a') // a quien de los enlaces se le avisa
  const notifyOut = useNotifyPick('out', 'Avisar las salidas a')
  const { data: layout } = useLayout()
  const showToast = useToast()
  const confirm = useConfirm()
  // desde la reserva se llega con ?modo=reserva
  const [mode, setMode] = useState(() => (new URLSearchParams(window.location.search).get('modo') === 'reserva' ? 'reserve' : 'in'))
  const [qty, setQty] = useState(1)
  const [manual, setManual] = useState('')
  const [searching, setSearching] = useState(false) // buscar la prenda por nombre, sin escanear
  const [pendingSku, setPendingSku] = useState(null)
  const [newReserve, setNewReserve] = useState(null) // { sku, qty }: no esta en la bodega ni en la tienda
  const [lastMove, setLastMove] = useState(null)
  const [factura, setFactura] = useState(false)
  const [remision, setRemision] = useState(false)
  const remisionDraft = !remision && !!readRemisionDraft() // una remision a medias
  const [parcel, setParcel] = useState(false)
  const [session, setSession] = useState([])
  const [hit, setHit] = useState(null) // lo ultimo registrado, para mostrarlo encima de la camara
  // la misma prenda otra vez en pocos segundos: puede ser la misma etiqueta contada dos veces
  const showHit = (res, reserveCheck = true) => {
    const parts = res.movements?.length ? res.movements : [res.movement]
    const at = Date.now()
    setHit((prev) => ({
      id: res.movement.id, type: res.movement.type, qty: parts.reduce((s, m) => s + m.qty, 0), image: res.product.image_url,
      inReserve: reserveCheck ? reserveFor(res.product, rIndex).reduce((t, it) => t + it.qty, 0) : 0,
      sku: res.product.sku, name: res.product.name, size: res.product.size, total: res.product.qty, at, queued: !!res.queued,
      repeat: !!prev && !prev.err && prev.sku === res.product.sku && at - prev.at < 8000,
    }))
  }
  // lo que llevas registrado en esta sesion, por codigo (la lista de abajo
  // solo muestra lo ultimo; esto no se corta): asi no se pierde la cuenta
  const [tally, setTally] = useState({})
  const count = (parts, sign = 1, after) => setTally((t) => {
    const m = parts[parts.length - 1]
    const cur = t[m.sku] || { sku: m.sku, name: m.product_name, size: m.product_size, net: 0, n: 0, counted: false }
    return {
      ...t,
      [m.sku]: {
        ...cur,
        net: cur.net + sign * parts.reduce((s, p) => s + delta(p), 0),
        n: cur.n + sign,
        after: after ?? m.after,
        counted: cur.counted || m.type === 'set',
        at: Date.now(),
      },
    }
  })
  const tallyList = useMemo(() => Object.values(tally).filter((t) => t.n > 0).sort((a, b) => b.at - a.at), [tally])
  // '' = automatica (la ubicacion principal de cada codigo); null = aun sin decidir
  const [place, setPlace] = useState(null)

  // Confirmar antes de guardar (entradas y salidas): cada lectura va a la
  // lista "Por confirmar", ahi se corrige la cuenta y se guarda todo junto
  const [confirmFirst, setConfirmFirst] = useState(() => readStore(CONFIRM_KEY, true) !== false)
  const [toConfirm, setToConfirmState] = useState(() => {
    const v = readStore(TO_CONFIRM_KEY, [])
    return Array.isArray(v) ? v : []
  })
  const toConfirmRef = useRef(toConfirm)
  const setToConfirm = (list) => {
    toConfirmRef.current = list
    setToConfirmState(list)
    writeStore(TO_CONFIRM_KEY, list)
  }
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // una prenda a la vez: la camara espera un toque despues de cada lectura
  const [oneByOne, setOneByOne] = useState(() => readStore(ONE_KEY, true) !== false)
  // "Prendas por escaneo" de mas de 1 vale para una sola lectura y vuelve a
  // 1 (asi no se queda en 5 sin querer), salvo que se pida mantenerla
  const [keepQty, setKeepQty] = useState(false)
  useEffect(() => { if (qty <= 1) setKeepQty(false) }, [qty])
  const outlet = useMemo(() => outletIdsOf(layout), [layout])
  // lo que hay en la reserva: una entrada de algo que esta alla pregunta si viene de alla
  const { data: reserveList } = useReserve()
  const rIndex = useMemo(() => reserveIndex(reserveList), [reserveList])
  const staged = confirmFirst && mode !== 'set'
  const toConfirmUnits = toConfirm.reduce((t, l) => t + l.qty, 0)
  const toConfirmTypes = new Set(toConfirm.map((l) => l.type))
  // salidas de prendas que estan en varios lugares: falta decir de donde salen
  const needsFrom = (l) => l.type === 'out' && !l.loc && fromMissing(l.from, l.qty, placesOf(l, outlet))
  const missingFrom = toConfirm.filter(needsFrom).length
  // entradas de algo que esta en la reserva: falta decir si viene de alla
  const needsRes = (l) => l.type === 'in' && l.res && l.fromRes === undefined
  const missingRes = toConfirm.filter(needsRes).length
  // repartida: que no pase de las que hay y que cada parte diga a donde va
  const badSplit = (l) => l.type === 'in' && !!l.parts && (partsTotal(l.parts) > l.qty || l.parts.some((x) => x.qty > 0 && !x.loc))
  const splitIssues = toConfirm.filter(badSplit).length

  const [params] = useSearchParams()
  const navigate = useNavigate()
  const groups = useMemo(() => (layout ? locationGroups(layout.elements) : []), [layout])
  // "Escanear aqui" desde una ubicacion (?loc=C-4-1): lo que se escanee va
  // ahi, aunque se escanee antes de que cargue el plano o se llegue otra vez
  const urlLoc = params.get('loc') || ''
  const appliedLoc = useRef(null)
  useEffect(() => {
    if (!groups.length) return
    const exists = urlLoc && groups.some((g) => g.options.some((l) => l.id === urlLoc))
    if (exists && appliedLoc.current !== urlLoc) {
      appliedLoc.current = urlLoc
      setPlace(urlLoc)
    } else if (place === null) setPlace('')
  }, [groups, urlLoc, place])
  const curPlace = place ?? urlLoc
  const firstLoc = groups[0]?.options[0]?.id || ''
  const locNames = useMemo(() => new Map(groups.flatMap((g) => g.options).map((o) => [o.id, o.name])), [groups])

  const pendingRef = useRef(null)
  pendingRef.current = pendingSku || newReserve?.sku || null

  // un solo viaje al servidor por codigo: si no existe, responde 404 y se
  // ofrece registrarlo
  const handleCode = async (raw) => {
    const sku = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
    if (!sku || pendingRef.current || savingRef.current) return
    try {
      if (mode === 'reserve') {
        // se identifica sola: de la bodega o, si no esta registrada, de la tienda
        if (staged) {
          stageReserve(await api.get(`/api/reserve/identify/${encodeURIComponent(sku)}`))
        } else {
          recordReserve(await api.post('/api/reserve/scan', { sku, qty }), true)
        }
        beep(true)
        afterRead()
        return
      }
      if (staged) {
        // no se guarda nada todavia: solo se busca la prenda para la lista
        // (sin señal, en lo guardado en el celular)
        let p
        try {
          p = await api.get(`/api/products/${encodeURIComponent(sku)}`)
        } catch (err) {
          p = isNetworkError(err) ? cachedProduct(sku) : null
          if (!p) throw err
        }
        beep(true)
        stage(p)
        // una etiqueta con el codigo mal ya corregida: se dice cual se uso
        if (p.sku !== sku) setHit((h) => (h ? { ...h, label: sku } : h))
        afterRead()
        return
      }
      const res = await moveStock(sku, mode, qty, curPlace || undefined)
      beep(true)
      record(res)
      showHit(res)
      if (res.product.sku !== sku) setHit((h) => (h ? { ...h, label: sku } : h))
      afterRead()
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        beep(true)
        pendingRef.current = sku
        if (mode === 'reserve') setNewReserve({ sku, qty })
        else setPendingSku(sku)
        return
      }
      beep(false)
      const msg = e instanceof ApiError && !isNetworkError(e) ? e.message
        : 'Sin señal y ese código no está guardado en el celular: escanéalo cuando vuelva la señal.'
      setHit({ err: msg, at: Date.now() })
      showToast(msg, 'err')
    }
  }

  const afterRead = () => {
    if (mode !== 'set' && qty > 1 && !keepQty) setQty(1)
  }

  const record = (res) => {
    setLastMove(res)
    const parts = res.movements?.length ? [...res.movements].reverse() : [res.movement]
    setSession((s) => [...parts, ...s].slice(0, 25))
    count(res.movements?.length ? res.movements : [res.movement])
  }

  // lo guardado en la reserva, en "En esta sesion" (y encima de la camara)
  const recordReserve = (res, show = false) => {
    const it = res.item
    const at = Date.now()
    const id = `r${it.id}-${at}`
    setSession((s) => [{ id, type: 'reserve', qty: res.added, product_name: it.name, product_size: it.size,
                         location_id: 'reserva', after: it.qty, created_at: new Date(at).toISOString() }, ...s].slice(0, 25))
    if (show) {
      setHit((prev) => ({
        id, reserveId: it.id, type: 'reserve', qty: res.added, sku: it.sku, name: it.name, size: it.size, total: it.qty, image: it.image_url,
        created: res.created, at, repeat: !!prev && !prev.err && prev.sku === it.sku && at - prev.at < 8000,
      }))
    }
    refreshInventory()
  }

  // "Deshacer" de algo guardado en la reserva: se le quita lo que se sumo
  const undoReserve = async (h) => {
    try {
      await setReserveQty({ id: h.reserveId }, Math.max(0, h.total - h.qty))
      setSession((s) => s.filter((m) => m.id !== h.id))
      setHit(null)
      showToast('Deshecho: se quitó de la reserva')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo deshacer.', 'err')
    }
  }

  // una lectura para la reserva a la lista "Por confirmar"
  const stageReserve = (who) => {
    const key = `reserve|${who.sku}|`
    const list = toConfirmRef.current
    const old = list.find((l) => l.key === key)
    const line = { key, type: 'reserve', sku: who.sku, name: who.name, size: who.size, loc: '', inReserve: who.in_reserve,
                   qty: (old?.qty || 0) + qty, n: (old?.n || 0) + 1, edited: old?.edited }
    setToConfirm([line, ...list.filter((l) => l.key !== key)])
    const at = Date.now()
    setHit((prev) => ({
      pending: true, key, type: 'reserve', qty, sku: who.sku, name: who.name, size: who.size, lineQty: line.qty, n: line.n, image: who.image,
      inReserve: who.in_reserve, at, repeat: !!prev && !prev.err && prev.sku === who.sku && at - prev.at < 8000,
    }))
  }

  // una lectura a la lista: el mismo codigo (y tipo y lugar) se va sumando
  const stage = (p) => {
    const loc = curPlace || ''
    const key = `${mode}|${p.sku}|${loc}`
    const list = toConfirmRef.current
    const old = list.find((l) => l.key === key)
    // donde hay (para preguntar de donde sale) y cuanto se puede sacar
    const stock = (p.stock || []).map((st) => ({ location_id: st.location_id, location_name: st.location_name, qty: st.qty }))
    const from = old?.from
    const have = mode === 'out' ? outAvailable({ stock }, outlet, loc || from) : null
    const r = mode === 'in' ? reserveFor(p, rIndex)[0] : null
    const line = { key, type: mode, sku: p.sku, name: p.name, size: p.size, loc, main: p.location_id,
                   qty: (old?.qty || 0) + qty, n: (old?.n || 0) + 1, stock, from, edited: old?.edited,
                   res: r ? { id: r.id, qty: r.qty } : null, fromRes: old?.fromRes }
    setToConfirm([line, ...list.filter((l) => l.key !== key)])
    const at = Date.now()
    setHit((prev) => ({
      pending: true, key, type: mode, qty, sku: p.sku, name: p.name, size: p.size, lineQty: line.qty, n: line.n, image: p.image_url,
      have, short: have != null && line.qty > have, at,
      repeat: !!prev && !prev.err && prev.sku === p.sku && at - prev.at < 8000,
    }))
  }

  // cambiar la cantidad a mano (o quitar la ultima lectura, reading = true)
  const setLineQty = (key, q, reading = false) => {
    const list = toConfirmRef.current
    setToConfirm(q > 0
      ? list.map((l) => (l.key === key ? { ...l, qty: q, err: null, ...(reading ? { n: Math.max(1, l.n - 1) } : { edited: true }) } : l))
      : list.filter((l) => l.key !== key))
    // lo de encima de la camara ya no dice cuantas llevas
    setHit((h) => (h?.pending && h.key === key ? null : h))
  }

  const setFromRes = (key, fromRes) => {
    setToConfirm(toConfirmRef.current.map((l) => (l.key === key ? { ...l, fromRes, err: null } : l)))
  }

  // repartir una entrada en varias ubicaciones (lo que no se reparte va a la de la linea)
  const setParts = (key, parts) => {
    setToConfirm(toConfirmRef.current.map((l) => (l.key === key ? { ...l, parts, err: null } : l)))
  }

  // lleva lineas de la lista a otra ubicacion; las que quedan iguales se juntan
  const relocate = (pick, v) => {
    const list = toConfirmRef.current
    const moves = list.filter((l) => pick(l) && (l.loc || '') !== (v || ''))
    if (!moves.length) return 0
    const merged = []
    for (const l of list) {
      const m = moves.includes(l) ? { ...l, loc: v || '', key: `${l.type}|${l.sku}|${v || ''}`, from: l.type === 'out' ? undefined : l.from, err: null } : { ...l }
      const same = merged.find((x) => x.key === m.key)
      if (same) {
        same.qty += m.qty
        same.n += m.n
      } else merged.push(m)
    }
    setToConfirm(merged)
    return moves.reduce((t, l) => t + l.qty, 0)
  }
  const placeLabel = (v, l) => (v ? locNames.get(v) || v : l ? `su ubicación principal (${l.main})` : 'su ubicación principal')

  // cambiar "¿Dónde?" tambien mueve lo que ya esta en la lista (sin repartir):
  // si no, lo de arriba seguia yendo a donde estaba al escanearlo
  const changePlace = (v) => {
    setPlace(v)
    const units = relocate((l) => (l.type === 'in' || l.type === 'out') && !l.parts, v)
    if (units) showToast(`${plural(units, 'prenda de la lista pasa', 'prendas de la lista pasan')} a ${placeLabel(v)}`)
  }

  // tocar la ubicacion de una entrada en la lista: elegir otra
  const [locFor, setLocFor] = useState(null) // la linea
  const setLineLoc = (key, v) => {
    const l = toConfirmRef.current.find((x) => x.key === key)
    if (relocate((x) => x.key === key, v)) showToast(`${l.name}${l.size ? ` ${l.size}` : ''} entra en ${placeLabel(v, l)}`)
  }

  const setFrom = (key, from) => {
    setToConfirm(toConfirmRef.current.map((l) => (l.key === key ? { ...l, from, err: null } : l)))
  }

  // "Quitar" encima de la camara: deshace la ultima lectura de esa prenda
  const unstage = (key, q) => {
    const l = toConfirmRef.current.find((x) => x.key === key)
    if (l) setLineQty(key, l.qty - q, true)
  }

  const confirmAll = async () => {
    if (savingRef.current || !toConfirmRef.current.length || toConfirmRef.current.some((l) => needsFrom(l) || needsRes(l) || badSplit(l))) return
    savingRef.current = true
    setSaving(true)
    setHit(null)
    const lines = [...toConfirmRef.current].reverse() // en el orden en que se escanearon
    const failed = []
    const entered = [] // lo que entro y lo que salio, para los avisos
    const left = []
    let units = 0
    let offline = 0 // sin señal: quedaron en el celular
    for (const l of lines) {
      // una salida: primero de donde se eligio y, si ahi no alcanza, el resto de donde haya
      const parts = l.type === 'out' ? outParts(l.qty, l.loc || l.from || '', l) : [{ qty: l.qty, loc: l.loc }]
      let done = 0
      try {
        if (l.type === 'reserve') {
          recordReserve(await api.post('/api/reserve/scan', { sku: l.sku, qty: l.qty }))
          done = l.qty
        } else if (l.type === 'in') {
          // repartida: cada parte a su ubicacion; el resto, a la de la linea.
          // Si viene de la reserva, se descuenta de alla (no queda contada dos veces)
          const { parts: split, rest } = splitRow({ qty: l.qty, parts: l.parts }, !!l.parts)
          const dests = [...split.map((x) => ({ qty: x.qty, loc: x.loc })), ...(rest > 0 ? [{ qty: rest, loc: l.loc }] : [])]
          let fromRes = l.fromRes && l.res ? Math.min(l.qty, l.res.qty) : 0
          for (const d of dests) {
            const take = Math.min(d.qty, fromRes)
            if (take > 0) {
              const tr = await api.post(`/api/reserve/${l.res.id}/transfer`, { qty: take, location_id: d.loc || l.main, sku: l.sku })
              record({ product: tr.product, movement: tr.movement, movements: tr.movements })
              fromRes -= take
              done += take
            }
            if (d.qty > take) {
              const r = await moveStock(l.sku, 'in', d.qty - take, d.loc || undefined)
              record(r)
              if (r?.queued) offline += d.qty - take
              done += d.qty - take
            }
            entered.push({ name: l.name, size: l.size, qty: d.qty, loc: d.loc || l.main })
          }
        } else for (const part of parts) {
          const r = await moveStock(l.sku, l.type, part.qty, part.loc || undefined)
          record(r)
          if (r?.queued) offline += part.qty
          done += part.qty
        }
      } catch (e) {
        // lo que falto queda en la lista (sin el reparto: ya se guardo una parte)
        failed.unshift({ ...l, qty: l.qty - done, parts: undefined, err: e instanceof ApiError ? e.message : 'No hay conexión con el servidor.' })
      }
      units += done
      if (l.type === 'out' && done > 0) left.push({ name: l.name, size: l.size, qty: done })
    }
    setToConfirm(failed)
    setLastMove(null)
    refreshInventory()
    savingRef.current = false
    setSaving(false)
    const inUnits = entered.reduce((t, x) => t + x.qty, 0)
    const where = [...new Set(entered.map((x) => x.loc).filter(Boolean))]
    const told = inUnits ? await sendNotice({
      kind: 'in', ids: notifyIn.ids, names: notifyIn.names,
      title: `Entraron ${plural(inUnits, 'prenda', 'prendas')}`,
      body: `${itemsText(entered)}${where.length ? ` · en ${where.slice(0, 4).join(', ')}` : ''}`,
    }) : ''
    const outUnits = left.reduce((t, x) => t + x.qty, 0)
    const toldOut = outUnits ? await sendNotice({
      kind: 'out', ids: notifyOut.ids, names: notifyOut.names,
      title: `Salieron ${plural(outUnits, 'prenda', 'prendas')}`, body: itemsText(left),
    }) : ''
    if (!failed.length && offline) showToast(`Sin señal: ${plural(offline, 'prenda quedó guardada', 'prendas quedaron guardadas')} en el celular y se suben solas`)
    else if (!failed.length) showToast(`Guardado: ${plural(units, 'prenda', 'prendas')}${told}${toldOut}`)
    else showToast(`${units ? `Se guardaron ${units}. ` : ''}${plural(failed.length, 'código no se pudo', 'códigos no se pudieron')} guardar: revisa la lista${told}${toldOut}`, 'err')
  }

  const discardAll = async () => {
    const units = toConfirmRef.current.reduce((t, l) => t + l.qty, 0)
    const ok = await confirm({
      title: '¿Descartar la lista?',
      body: `Se borran ${plural(units, 'prenda', 'prendas')} que todavía no se han guardado.`,
      confirmLabel: 'Sí, descartar',
    })
    if (!ok) return
    const prev = toConfirmRef.current
    setToConfirm([])
    setHit(null)
    showToast('Lista descartada: no se guardó nada', 'ok', {
      label: 'Deshacer',
      onClick: () => {
        const now = toConfirmRef.current
        setToConfirm([...now, ...prev.filter((l) => !now.some((x) => x.key === l.key))])
      },
    })
  }

  const toggleOneByOne = () => {
    const on = !oneByOne
    writeStore(ONE_KEY, on)
    setOneByOne(on)
  }

  const toggleConfirm = () => {
    const on = !confirmFirst
    writeStore(CONFIRM_KEY, on)
    setConfirmFirst(on)
    setHit(null)
  }

  const scanner = useBarcodeScanner(handleCode, { single: oneByOne })
  const { status, start, stop } = scanner
  const camOn = status === 'on'

  // con un formulario encima (prenda nueva, factura, remision, algo de paso) la camara y
  // la linterna se apagan; al cerrar la prenda nueva, se vuelve a abrir
  const resumeRef = useRef(false)
  const covered = !!pendingSku || !!newReserve || factura || remision || parcel
  useEffect(() => {
    if (covered && camOn) {
      resumeRef.current = !!pendingSku || !!newReserve
      stop()
    } else if (!covered && resumeRef.current) {
      resumeRef.current = false
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered])

  useEffect(() => () => { stop() }, [stop])

  const submitManual = () => {
    handleCode(manual)
    setManual('')
  }

  const undo = async (id) => {
    if (String(id).startsWith('q-')) {
      // todavia no se subia: se quita de la fila del celular
      const mvq = session.find((m) => m.id === id)
      if (mvq && undoQueued(mvq)) {
        count([mvq], -1, mvq.before)
        setSession((s) => s.filter((m) => m.id !== id))
        if (lastMove?.movement?.id === id) setLastMove(null)
        if (hit?.id === id) setHit(null)
        showToast('Deshecho: no se va a subir')
      } else {
        showToast('Ya se subió: deshazlo desde Resumen › Movimientos.', 'err')
      }
      return
    }
    try {
      const product = await api.post(`/api/movements/${id}/undo`)
      refreshInventory()
      const undone = session.find((m) => m.id === id)
      if (undone) count([undone], -1, product.qty)
      setSession((s) => s.filter((m) => m.id !== id))
      if (lastMove?.movement?.id === id) setLastMove(null)
      if (hit?.id === id) setHit(null)
      showToast('Movimiento deshecho')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Solo se puede deshacer el último movimiento.', 'err')
    }
  }

  const current = MODES.find((x) => x.m === mode)
  const mv = lastMove?.movement

  return (
    <section className="page" aria-label="Escanear">
      <div className="page-inner">
        <PageHead title="Escanear" lede={staged ? 'Apunta a la etiqueta: queda en la lista hasta que confirmes.' : 'Apunta a la etiqueta y la prenda se registra sola.'} />

        <div className="doc-cards">
          <button className="doc-card in" onClick={() => setRemision(true)}>
            <span className="doc-ico"><Icon name="boxIn" size={22} /></span>
            <span className="doc-card-t"><b>Recibir remisión</b><small>{remisionDraft ? 'Tienes una a medias: sigue donde ibas' : 'Lo que llega del proveedor'}</small></span>
          </button>
          <button className="doc-card" onClick={() => setFactura(true)}>
            <span className="doc-ico"><Icon name="receipt" size={22} /></span>
            <span className="doc-card-t"><b>Descontar factura</b><small>Lo que salió en cajas</small></span>
          </button>
          <button className="doc-card light wide" onClick={() => setParcel(true)}>
            <span className="doc-ico"><Icon name="box" size={22} /></span>
            <span className="doc-card-t"><b>Anotar algo de paso</b><small>Caja suelta, canasta…: de quién es y qué hacer</small></span>
            <Icon name="arrowRight" size={18} />
          </button>
        </div>

        <div className="seg four" role="toolbar" aria-label="Tipo de movimiento">
          {MODES.map((x) => (
            <button key={x.m} data-m={x.m} aria-pressed={mode === x.m} onClick={() => { setMode(x.m); if (x.m !== 'set' && qty < 1) setQty(1) }}>
              <Icon name={x.icon} size={18} stroke={2.1} />{x.label}
            </button>
          ))}
        </div>
        <p className="mode-hint">{current.hint}</p>
        <div className="card scan-opts">
          {mode !== 'set' && (
            <div className="ctl">
              <span>
                Confirmar antes de guardar
                <small>{confirmFirst ? 'Lo escaneado queda en una lista: revisas la cuenta y confirmas' : 'Cada lectura se guarda al instante'}</small>
              </span>
              <button type="button" className="switch" role="switch" aria-checked={confirmFirst} aria-label="Confirmar antes de guardar" onClick={toggleConfirm} />
            </div>
          )}
          <div className="ctl">
            <span>
              Una prenda a la vez
              <small>{oneByOne ? 'Después de cada lectura la cámara espera: tocas "Escanear siguiente"' : 'La cámara lee una tras otra sin parar'}</small>
            </span>
            <button type="button" className="switch" role="switch" aria-checked={oneByOne} aria-label="Una prenda a la vez" onClick={toggleOneByOne} />
          </div>
        </div>
        {mode === 'set' && (
          <button className="link-btn count-link" onClick={() => navigate(`/count${place ? `?loc=${encodeURIComponent(place)}` : ''}`)}>
            ¿Vas a contar toda una ubicación? Usa el conteo por ubicación<Icon name="arrowRight" size={14} stroke={2.4} />
          </button>
        )}

        <Viewfinder
          scanner={scanner}
          overlay={hit && (
            <ScanHit hit={hit} tally={hit.sku && tally[hit.sku]}
                     onUndo={() => (hit.pending ? unstage(hit.key, hit.qty) : hit.type === 'reserve' ? undoReserve(hit) : undo(hit.id))} />
          )}
        />
        <button className={`btn btn-lg btn-block ${camOn ? 'btn-ink' : 'btn-lime'}`} style={{ marginTop: 12 }} onClick={() => (camOn ? stop() : start())}>
          <Icon name={camOn ? 'x' : 'camera'} size={20} />{camOn ? 'Cerrar cámara' : 'Escanear con la cámara'}
        </button>
        <PhotoRead scanner={scanner} onMiss={() => showToast('No encontré un código en la foto. Tómala más de cerca, derecha y con luz.', 'err')} />

        {toConfirm.length > 0 && (
          <div className="card to-confirm" aria-label="Por confirmar">
            <div className="to-confirm-head">
              <div>
                <b>Por confirmar</b>
                <small>{plural(toConfirmUnits, 'prenda', 'prendas')} · {plural(toConfirm.length, 'código', 'códigos')} · aún no se guarda nada</small>
              </div>
              {missingRes > 0 && (
                <p className="to-confirm-ask">
                  {missingRes === 1 ? 'Falta decir si una prenda viene de la reserva' : `Falta decir si ${missingRes} prendas vienen de la reserva`}
                </p>
              )}
              {splitIssues > 0 && (
                <p className="to-confirm-ask">Revisa el reparto: cada parte con su ubicación y sin pasar de las que hay</p>
              )}
              {missingFrom > 0 && (
                <p className="to-confirm-ask">
                  {missingFrom === 1 ? 'Falta elegir de dónde sale una prenda' : `Falta elegir de dónde salen ${missingFrom} prendas`}: está en varios lugares
                </p>
              )}
              <button type="button" className="btn btn-lime" onClick={confirmAll} disabled={saving || missingFrom > 0 || missingRes > 0 || splitIssues > 0}>
                <Icon name="check" size={18} stroke={2.4} />
                {saving ? 'Guardando…' : toConfirmTypes.size > 1 ? 'Confirmar'
                  : toConfirmTypes.has('out') ? 'Confirmar salida' : toConfirmTypes.has('reserve') ? 'Guardar en la reserva' : 'Confirmar entrada'}
              </button>
            </div>
            {toConfirm.map((l) => {
              const places = l.type === 'out' && !l.loc ? placesOf(l, outlet) : []
              const have = l.type === 'out' && l.stock ? outAvailable(l, outlet, l.loc || l.from) : null
              return (
              <div className={`need to-confirm-row ${l.err ? 'err' : ''}`} key={l.key}>
                <div className="need-t">
                  <b>{l.name}{l.size ? ` · ${l.size}` : ''}</b>
                  <small>
                    <span className={`to-confirm-type ${l.type}`}>{l.type === 'out' ? 'Salida' : l.type === 'reserve' ? 'Reserva' : 'Entrada'}</span>
                    {l.type === 'reserve'
                      ? (l.inReserve ? ` · ya hay ${l.inReserve}` : ' · nueva')
                      : l.type === 'in'
                        ? <>{' en '}{l.parts ? 'varias ubicaciones' : (
                          <button type="button" className="to-confirm-loc" disabled={saving} onClick={() => setLocFor(l.key)}
                                  aria-label={`Cambiar dónde entra: ${l.loc || l.main}`}>
                            {l.loc || l.main}<Icon name="pencil" size={11} stroke={2.4} />
                          </button>
                        )}</>
                        : <>{' de '}{l.loc || (isSplit(l.from) ? 'varias ubicaciones' : l.from || 'donde haya')}</>}
                    {' · '}{l.edited ? 'cantidad ajustada' : plural(l.n, 'lectura', 'lecturas')}
                  </small>
                  {l.err ? <small className="to-confirm-msg">{l.err}</small>
                    : have != null && l.qty > have && <small className="to-confirm-msg">Solo hay {have}</small>}
                </div>
                <Stepper value={l.qty} small disabledMinus={l.qty <= 1 || saving}
                         onMinus={() => setLineQty(l.key, l.qty - 1)} onPlus={() => setLineQty(l.key, l.qty + 1)}
                         minusLabel={`Quitar 1 de ${l.name}`} plusLabel={`Sumar 1 a ${l.name}`} />
                <button type="button" className="to-confirm-x" disabled={saving} aria-label={`Quitar ${l.name} de la lista`}
                        onClick={async () => {
                          if (await confirm({ title: `¿Quitar ${l.name}${l.size ? ` ${l.size}` : ''} de la lista?`, body: `${plural(l.qty, 'prenda', 'prendas')} sin guardar.`, confirmLabel: 'Sí, quitar' })) setLineQty(l.key, 0)
                        }}>
                  <Icon name="x" size={16} stroke={2.4} />
                </button>
                {places.length > 0 && (
                  <FromPick places={places} value={l.from} qty={l.qty} disabled={saving} onChange={(v) => setFrom(l.key, v)} />
                )}
                {l.type === 'in' && l.qty > 1 && !l.parts && (
                  <button type="button" className="link-btn to-confirm-split" disabled={saving}
                          onClick={() => setParts(l.key, [{ key: blockId(), loc: '', qty: 0 }])}>
                    <Icon name="pin" size={13} stroke={2.4} />Repartir en varias ubicaciones
                  </button>
                )}
                {l.type === 'in' && l.parts && (
                  <div className="to-confirm-splitbox">
                    <SplitRow row={{ qty: l.qty, parts: l.parts }} size={l.size} groups={groups} allowReserve={false}
                              mainLabel={locNames.get(l.loc || l.main) || l.loc || l.main}
                              onChange={(parts) => setParts(l.key, parts)} />
                    <button type="button" className="link-btn" disabled={saving} onClick={() => setParts(l.key, undefined)}>
                      <Icon name="x" size={13} stroke={2.4} />No repartir: todas a {l.loc || l.main}
                    </button>
                  </div>
                )}
                {l.type === 'in' && l.res && (
                  <div className="from-pick" role="group" aria-label={`${l.name}: vienen de la reserva`}>
                    <span className={l.fromRes === undefined ? 'ask' : ''}>¿Vienen de la reserva? Allá hay {l.res.qty}</span>
                    <button type="button" className="any" aria-pressed={l.fromRes === true} disabled={saving} onClick={() => setFromRes(l.key, true)}>Sí, de la reserva</button>
                    <button type="button" className="any" aria-pressed={l.fromRes === false} disabled={saving} onClick={() => setFromRes(l.key, false)}>No, son nuevas</button>
                    {l.fromRes && l.qty > l.res.qty && (
                      <small>De la reserva salen {l.res.qty}; {l.qty - l.res.qty === 1 ? 'la otra entra' : `las otras ${l.qty - l.res.qty} entran`} como nuevas.</small>
                    )}
                  </div>
                )}
              </div>
              )
            })}
            {toConfirmTypes.has('in') && notifyIn.el}
            {toConfirmTypes.has('out') && notifyOut.el}
            <button type="button" className="link-btn to-confirm-discard" onClick={discardAll} disabled={saving}>Descartar todo</button>
          </div>
        )}

        <div className={`card scan-qty ${mode !== 'set' && qty > 1 ? 'bulk' : ''}`}>
          <div>
            <b>{mode === 'set' ? 'Cantidad contada' : 'Prendas por escaneo'}</b>
            <small>
              {mode === 'set' ? 'Así queda el total de ese código'
                : qty <= 1 ? 'Normalmente 1'
                  : keepQty ? `Ojo: cada lectura ${mode === 'out' ? 'descuenta' : 'suma'} ${qty}`
                    : `Solo la próxima lectura ${mode === 'out' ? 'descuenta' : 'suma'} ${qty}; luego vuelve a 1`}
            </small>
            {mode !== 'set' && qty > 1 && (
              <label className="keep-qty">
                <input type="checkbox" checked={keepQty} onChange={(e) => setKeepQty(e.target.checked)} />
                Mantener {qty} en las siguientes
              </label>
            )}
          </div>
          <Stepper
            onMinus={() => setQty((q) => Math.max(mode === 'set' ? 0 : 1, q - 1))}
            onPlus={() => setQty((q) => Math.min(9999, q + 1))}
            minusLabel="Menos"
            plusLabel="Más"
            large
          >
            <input aria-label="Cantidad" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(0, Math.floor(+e.target.value) || 0))} />
          </Stepper>
        </div>

        {mode !== 'reserve' && <div className="field">
          <span className="field-label">¿Dónde?</span>
          <LocationPicker value={place || ''} onChange={changePlace} groups={groups} ariaLabel="¿Dónde?"
                          emptyLabel="Automática: la ubicación principal de cada código" />
          <span className="field-hint">
            {mode === 'out'
              ? place
                ? staged ? `Salen primero de ${place}; si ahí no alcanza, el resto de donde haya.` : `Las salidas se descuentan solo de ${place}.`
                : staged ? 'Si la prenda está en varios lugares, en la lista eliges de cuál salió.' : 'Sale primero de la ubicación principal y, si no alcanza, de donde haya.'
              : place ? `Lo que escanees ${mode === 'set' ? 'se cuenta' : 'entra'} en ${place}.` : `Cada código ${mode === 'set' ? 'se cuenta' : 'entra'} en su ubicación principal.`}
          </span>
        </div>}

        <div className="manual">
          <input
            className="input mono"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitManual())}
            placeholder="Código a mano"
            autoCapitalize="characters"
            spellCheck="false"
            enterKeyHint="done"
            aria-label="Código"
          />
          <button className="btn btn-ink" onClick={submitManual} disabled={!manual.trim()}>{staged ? 'Agregar' : 'Registrar'}</button>
        </div>
        <p className="mode-hint">Con un lector USB o Bluetooth: toca el campo y escanea.</p>
        <button type="button" className="btn btn-ghost btn-block scan-search-btn" onClick={() => setSearching(true)}>
          <Icon name="search" size={18} stroke={2.4} />Buscar la prenda por nombre
        </button>


        {lastMove && mv && (
          <article className="result rise" key={mv.id} aria-live="polite">
            <div className="result-top">
              <span className={`tag ${mv.type === 'out' ? 'tag-set' : 'tag-in'}`}>
                {mv.type === 'in' ? `Entrada +${mv.qty}` : mv.type === 'out' ? `Salida −${mv.qty}` : mv.type === 'new' ? `Nuevo +${mv.qty}` : `Conteo ${lastMove.product.qty}`}
              </span>
              <span className="code dark" style={{ background: 'rgba(255,255,255,.1)' }}><Icon name="pin" size={13} stroke={2.2} />{movedAt(lastMove)}</span>
            </div>
            <h3 className="result-name">{lastMove.product.name}</h3>
            <div className="result-code mono">{lastMove.product.sku}</div>
            <p className="result-left">
              {placesText(lastMove)} · quedan <b>{lastMove.product.qty}</b> en total
              {tally[lastMove.product.sku]?.n > 1 && <> · llevas <b>{signed(tally[lastMove.product.sku].net)}</b> en esta sesión</>}
            </p>
            <button className="undo" onClick={() => undo(mv.id)}><Icon name="undo" size={16} />Deshacer</button>
            <div className="result-size">{lastMove.product.size || 'U'}</div>
          </article>
        )}

        <h2 className="h-sec">En esta sesión {session.length > 0 && <small>{session.length}</small>}</h2>
        {tallyList.length > 0 && (
          <div className="card panel tally" aria-label="Lo que llevas por código">
            {tallyList.map((t) => (
              <div className="need" key={t.sku}>
                <div className="need-t">
                  <b>{t.name}{t.size ? ` · ${t.size}` : ''}</b>
                  <small><span className="mono">{t.sku}</span> · {t.n === 1 ? '1 registro' : `${t.n} registros`} · hay {t.after} en total</small>
                </div>
                <div className={`need-q ${t.net < 0 ? 'dark' : !t.net ? 'idle' : ''}`}>
                  <b>{t.net || !t.counted ? signed(t.net) : `=${t.after}`}</b><span>{t.net || !t.counted ? 'llevas' : 'contado'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {session.length ? (
          <ul className="moves card panel">
            {session.map((m) => (
              <li key={m.id} className={`move ${m.type === 'move' ? 't-move' : m.type}`}>
                <div className="move-q">{qtyText(m)}</div>
                <div className="move-t">
                  <b>{m.product_name}{m.product_size ? ` · ${m.product_size}` : ''}</b>
                  <small>{m.type === 'reserve' ? `A la reserva · ahí hay ${m.after}` : `${LABEL[m.type]} en ${m.location_id} · quedan ${m.after}`}</small>
                </div>
                <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('es-CO')}>{fmtTime(m.created_at)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Lo que escanees aparece aquí, con opción de deshacer.</p>
        )}
      </div>

      {factura && <FacturaSheet onClose={() => setFactura(false)} />}
      {remision && <RemisionSheet onClose={() => setRemision(false)} />}
      {parcel && <ParcelSheet defaultLocation={place || undefined} onClose={() => setParcel(false)} />}
      {locFor && (() => {
        const l = toConfirm.find((x) => x.key === locFor)
        return l ? (
          <LocationPickerSheet value={l.loc} groups={groups} emptyLabel={`Automática: su ubicación principal (${l.main})`}
                               onChange={(v) => setLineLoc(l.key, v)} onClose={() => setLocFor(null)} />
        ) : null
      })()}
      {searching && (
        <ProductSearchSheet
          subtitle={staged ? 'Toca la talla: queda en la lista como si la escanearas.'
            : `Toca la talla: ${mode === 'reserve' ? 'se guarda en la reserva' : mode === 'out' ? 'sale' : mode === 'set' ? 'se cuenta' : 'entra'} como si la escanearas.`}
          // entrada: tambien lo de la tienda (se registra como al escanearlo); salida y conteo: lo de la bodega
          onlyBodega={mode === 'out' || mode === 'set'}
          inStock={mode === 'out'}
          focus={mode === 'reserve' ? 'reserva' : 'bodega'}
          onClose={() => setSearching(false)}
          onPick={(o) => handleCode(o.sku)}
        />
      )}
      {newReserve && (
        <NewReserveModal
          sku={newReserve.sku}
          defaultQty={newReserve.qty}
          onClose={() => setNewReserve(null)}
          onCreated={(item) => recordReserve({ item, added: item.qty, created: true }, true)}
        />
      )}
      {pendingSku && (
        <NewProductModal
          sku={pendingSku}
          defaultLocation={place || firstLoc}
          locations={groups}
          onClose={() => setPendingSku(null)}
          onCreated={(res) => {
            refreshInventory()
            record(res) // puede traer varios movimientos (lo traido de la reserva y lo nuevo)
            showHit(res, false) // lo de la reserva ya se pregunto en el formulario
          }}
        />
      )}
    </section>
  )
}
