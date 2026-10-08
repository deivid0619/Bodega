import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../core/api'
import { refreshInventory, revalidate, useLayout, usePolling, useProducts, useReserve } from '../../core/useApi'
import { locationGroups } from '../../core/locationGroups'
import { cleanCode } from '../facturas/facturaParser'
import { guessSizeFromSku } from '../../core/utils'
import { saveDocPhoto } from '../documentos/docPhotos'
import { beep } from '../../core/feedback'
import { useToast } from '../../ui/ToastContext'
import { useConfirm } from '../../ui/ConfirmContext'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { plural } from '../../ui/Bits'
import ScanBox from '../escaneo/ScanBox'
import NearPick from '../../ui/NearPick'
import PhotoZoom from '../../ui/PhotoZoom'
import { itemsText, sendNotice, useNotifyPick } from '../avisos/Notices'
import LocationPicker from '../../ui/LocationPicker'
import { RESERVA, blockId, buildRefs, localToday, newRow, norm, partsTotal, rowsOf, shopRef, splitRow } from './refs'
import PickStep from './PickStep'
import { agoText, clearDraft, readDraft, readDraftPhoto, saveDraftPhoto, writeDraft } from './draft'
import RefPicker from './RefPicker'
import SizeRow from './SizeRow'
import SplitRow from './SplitRow'
import './remisiones.css'

// Recibir una remision: la foto, lo que llego (por referencia y talla),
// donde queda y confirmar. Lo que se va anotando queda guardado en el
// celular (draft.js): salirse no lo borra; solo "Descartar cambios" o
// confirmarla. Ver README.md de este modulo.
function Body() {
  const showToast = useToast()
  const ask = useConfirm()
  const notify = useNotifyPick('remision') // a quien de los enlaces se le avisa
  const { close } = useSheet()
  const { data: products } = useProducts()
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  const { data: recent } = usePolling('/api/documents?kind=remision&limit=50', { interval: 60000 })
  const refs = useMemo(() => buildRefs(products || [], reserve || []), [products, reserve])
  const known = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const inBodega = useMemo(() => new Set((products || []).map((p) => p.name)), [products])
  // la ubicacion de la bodega; Despacho es su propio destino (de paso)
  const groups = useMemo(() => locationGroups(layout?.elements, { dispatch: false }), [layout])
  const suppliers = useMemo(() => [...new Set((recent || []).map((d) => d.supplier).filter(Boolean))], [recent])

  // la que se dejo a medias: se sigue donde iba
  const [draft] = useState(readDraft)
  const [step, setStep] = useState(draft ? 'form' : 'pick')
  const [photo, setPhoto] = useState(null)
  const [photoFile, setPhotoFile] = useState(null) // se guarda como prueba al confirmar
  const [zoom, setZoom] = useState(false)
  const [number, setNumber] = useState(draft?.number ?? '')
  const [supplier, setSupplier] = useState(draft?.supplier ?? '')
  const [date, setDate] = useState(draft?.date ?? localToday)
  const [blocks, setBlocks] = useState(() => (draft?.blocks || []).map((b) => ({
    ...b,
    id: blockId(),
    rows: b.rows.map(({ toRes, ...r }) => (toRes > 0 && !r.parts ? { ...r, parts: [{ key: blockId(), loc: RESERVA, qty: toRes }] } : r)),
  })))
  const [picking, setPicking] = useState(draft ? !!draft.picking : true)
  const [showPending, setShowPending] = useState(!!draft?.showPending)
  const [dest, setDest] = useState(draft?.dest ?? 'bodega')
  const [history, setHistory] = useState(null)
  const [delivery, setDelivery] = useState(draft?.delivery ?? 0)
  const [addingSize, setAddingSize] = useState(null)
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [flash, setFlash] = useState(null) // lo ultimo que se escaneo
  const [unknown, setUnknown] = useState(null) // un codigo que no esta en ningun lado: { code, near, newRef, ref }
  const [recentIn, setRecentIn] = useState([]) // lo que ya entro escaneando de estos codigos

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo) }, [photo])

  // la foto de la que se dejo a medias
  const photoLoading = useRef(!!draft?.hasPhoto)
  useEffect(() => {
    if (!draft?.hasPhoto) return
    readDraftPhoto().then((blob) => {
      photoLoading.current = false
      if (!blob) return
      setPhotoFile(blob)
      setPhoto(URL.createObjectURL(blob))
    })
  }, [draft])
  const takePhoto = (f) => {
    setPhoto(URL.createObjectURL(f))
    setPhotoFile(f)
    saveDraftPhoto(f)
  }

  // todo lo anotado queda guardado al instante (hasta confirmar o descartar)
  const finished = useRef(false)
  const dirty = step === 'form' && !!(blocks.length || number.trim() || supplier.trim() || notes.trim() || photoFile)
  useEffect(() => {
    if (finished.current || step !== 'form') return
    if (!dirty && !photoLoading.current) {
      clearDraft()
      return
    }
    writeDraft({ number, supplier, date, blocks, picking, showPending, dest, delivery, notes,
                 hasPhoto: !!photoFile || photoLoading.current })
  }, [dirty, step, number, supplier, date, blocks, picking, showPending, dest, delivery, notes, photoFile])

  // entregas anteriores de la misma orden (OPR77, OPR77#2...)
  const base = norm(number).split('#')[0]
  const lastBase = useRef(base) // al seguir una guardada, se queda su entrega
  useEffect(() => {
    if (lastBase.current !== base) {
      lastBase.current = base
      setDelivery(0)
    }
    if (base.length < 2) { setHistory(null); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/documents?kind=remision&base=${encodeURIComponent(base)}&limit=20`)
        .then(setHistory)
        .catch(() => setHistory(null))
    }, 300)
    return () => clearTimeout(t)
  }, [base])

  const effective = delivery ? `${base}#${delivery}` : norm(number)
  const dup = (history || []).find((d) => d.number === effective)
  const nextDelivery = 1 + Math.max(1, ...(history || []).map((d) => (d.number.includes('#') ? parseInt(d.number.split('#')[1], 10) || 1 : 1)))
  const prevPending = useMemo(() => {
    const last = history?.[0]
    const m = new Map()
    // una talla repartida en dos ubicaciones viene en dos lineas: se suman
    if (last && (delivery || norm(number).includes('#'))) for (const l of last.lines || []) if (l.pending) m.set(`${l.name}|${l.size}`, (m.get(`${l.name}|${l.size}`) || 0) + l.pending)
    return m
  }, [history, delivery, number])

  const pickRef = (ref) => {
    // place: la ubicacion de esta referencia ('' = donde ya esta cada talla)
    setBlocks((bs) => [...bs, { id: blockId(), name: ref.name, isNew: !!ref.isNew, shop: !!ref.shop, rows: rowsOf(ref), place: '' }])
    setPicking(false)
  }
  const setPlace = (bid, place) => setBlocks((bs) => bs.map((b) => (b.id === bid ? { ...b, place } : b)))
  // dos toques seguidos suman dos: cada cambio parte del valor actual
  const setRow = (bid, size, patch) =>
    setBlocks((bs) => bs.map((b) => (b.id !== bid ? b : {
      ...b, rows: b.rows.map((r) => (r.size === size ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)),
    })))
  const addSize = (bid, raw) => {
    const s = String(raw || '').trim().toUpperCase().replace(/^T(?=\w)/, '')
    setAddingSize(null)
    if (!s) return
    setBlocks((bs) => bs.map((b) => (b.id !== bid || b.rows.some((r) => r.size === s) ? b : { ...b, rows: [...b.rows, newRow(s)] })))
  }
  // una prenda escaneada suma 1 a su talla; si su referencia no esta en la
  // remision, se agrega con todas sus tallas. Devuelve cuantas van.
  const addScanned = ({ name, size, sku, code, ref }) => {
    const s = String(size || '').trim().toUpperCase()
    const had = blocks.find((b) => b.name === name)?.rows.find((r) => r.size === s)?.qty || 0
    setBlocks((bs) => {
      let b = bs.find((x) => x.name === name)
      let list = bs
      if (!b) {
        b = { id: blockId(), name, isNew: ref ? !!ref.isNew : !inBodega.has(name), shop: !!ref?.shop, rows: ref ? rowsOf(ref) : [], place: '' }
        list = [...bs, b]
      }
      const rows = b.rows.some((r) => r.size === s)
        ? b.rows.map((r) => (r.size !== s ? r : {
          ...r, sku: r.sku || sku || null, code: r.sku || sku ? r.code : (r.code || code || ''), qty: r.qty + 1,
        }))
        : [...b.rows, { ...newRow(s, sku ? { sku } : null), code: sku ? '' : (code || ''), qty: 1 }]
      return list.map((x) => (x.id === b.id ? { ...b, rows } : x))
    })
    setPicking(false)
    return had + 1
  }
  const said = (name, size, n) => setFlash({ text: `+1 · ${name}${size ? ` · ${size}` : ''}${n > 1 ? ` (van ${n})` : ''}`, at: Date.now() })
  // de la bodega, la reserva o la tienda: la referencia completa con todas sus tallas
  const addFound = async (who, code) => {
    let ref = refs.find((r) => r.name === who.name) || null
    if (!ref && who.source === 'tienda') {
      try {
        const g = (await api.get(`/api/catalog/search?q=${encodeURIComponent(who.name)}&limit=4`)).find((x) => x.name === who.name)
        if (g) ref = shopRef(g, known)
      } catch { /* solo con la talla escaneada */ }
    }
    beep(true)
    said(who.name, who.size, addScanned({ name: who.name, size: who.size, sku: who.sku, code, ref }))
  }
  const onScan = async (raw) => {
    const code = cleanCode(raw)
    if (!code) return
    // ya esta en la remision: suma una mas
    for (const b of blocks) {
      const r = b.rows.find((x) => x.sku === code || (x.code && cleanCode(x.code) === code))
      if (r) {
        beep(true)
        setRow(b.id, r.size, (x) => ({ qty: x.qty + 1 }))
        said(b.name, r.size, r.qty + 1)
        return
      }
    }
    try {
      await addFound(await api.get(`/api/reserve/identify/${encodeURIComponent(code)}`), code)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // no esta en la bodega ni en la tienda: el parecido (etiqueta mal) o una prenda nueva
        beep(true)
        setUnknown({ code, near: null })
        api.get(`/api/catalog/near/${encodeURIComponent(code)}`)
          .then((near) => setUnknown((u) => (u?.code === code ? { ...u, near } : u)))
          .catch(() => setUnknown((u) => (u?.code === code ? { ...u, near: [] } : u)))
        return
      }
      beep(false)
      setFlash({ err: true, at: Date.now(), text: e instanceof ApiError ? e.message : 'No hay conexión con el servidor.' })
    }
  }
  // la etiqueta trae el codigo mal: se usa el bueno y queda reconocida
  const pickNear = (o) => {
    const code = unknown.code
    setUnknown(null)
    api.post('/api/catalog/alias', { code, sku: o.sku }).catch(() => {})
    addFound({ sku: o.sku, name: o.name, size: o.size || '', source: o.in_bodega ? 'bodega' : 'tienda' }, o.sku)
  }
  // una prenda nueva: su referencia y su talla; se registra al confirmar la remision
  const addNew = (size) => {
    const u = unknown
    setUnknown(null)
    said(u.ref.name, size.trim().toUpperCase(), addScanned({ name: u.ref.name, size, sku: null, code: u.code, ref: u.ref }))
  }

  // repartir: de cada talla, cuantas van a cada ubicacion (o a la reserva);
  // el resto entra a la ubicacion de la referencia. Al abrirlo, cada talla que
  // llego trae una parte vacia para llenar.
  const toggleSplit = (bid) => setBlocks((bs) => bs.map((b) => (b.id !== bid ? b : {
    ...b,
    split: !b.split,
    rows: b.rows.map((r) => (b.split ? { ...r, parts: [] }
      : r.qty > 0 && !r.parts?.length ? { ...r, parts: [{ key: blockId(), loc: '', qty: 0 }] } : r)),
  })))
  const setParts = (bid, size, parts) => setRow(bid, size, { parts })
  const removeBlock = (bid) => {
    setBlocks((bs) => {
      const left = bs.filter((b) => b.id !== bid)
      if (!left.length) setPicking(true)
      return left
    })
  }

  // repartida: una linea por ubicacion (el servidor junta la misma talla si va al mismo lugar)
  const splitting = (b) => dest === 'bodega' && !!b.split
  const lines = blocks.flatMap((b) => b.rows
    .filter((r) => r.qty > 0 || r.pending > 0)
    .flatMap((r) => {
      const base = { name: b.name, size: r.size, sku: r.sku || cleanCode(r.code) || null, isNew: b.isNew }
      const { parts, rest } = splitRow(r, splitting(b))
      const out = rest > 0 || r.pending > 0 ? [{ ...base, place: b.place, qty: Math.max(0, rest), pending: r.pending }] : []
      return [...out, ...parts.map((x) => (x.loc === RESERVA
        ? { ...base, place: '', qty: x.qty, pending: 0, toReserve: true }
        : { ...base, place: x.loc, qty: x.qty, pending: 0 }))]
    }))
  const units = lines.reduce((t, l) => t + l.qty, 0)
  const pend = lines.reduce((t, l) => t + l.pending, 0)
  const passing = dest === 'despacho'
  const record = dest === 'registro' // solo el papel: no se suma nada
  const toReserve = passing || record ? 0 : dest === 'reserva' ? units : lines.filter((l) => !l.sku || l.toReserve).reduce((t, l) => t + l.qty, 0)
  const toBodega = passing || record ? 0 : units - toReserve

  // lo que ya entro escaneando en los ultimos dias: si es lo de esta remision, va como solo registro
  const codes = [...new Set(lines.filter((l) => l.sku && l.qty > 0).map((l) => l.sku))].sort().join(',')
  useEffect(() => {
    if (!codes || record) { setRecentIn([]); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/documents/recent-entries?skus=${encodeURIComponent(codes)}&days=3`).then(setRecentIn).catch(() => setRecentIn([]))
    }, 600)
    return () => clearTimeout(t)
  }, [codes, record])
  // de paso se cuenta por codigo: una talla sin codigo no puede quedar en Despacho
  const noCode = passing && lines.find((l) => l.qty > 0 && !l.sku)
  const clash = lines.some((l) => l.sku && known.get(l.sku) && known.get(l.sku).name !== l.name)
  // un codigo nuevo se guarda junto a las otras tallas; si la referencia no tiene ninguna en la bodega, hay que elegir
  const withKnown = new Set(blocks.filter((b) => b.rows.some((r) => r.sku && known.has(r.sku))).map((b) => b.name))
  const homeless = (b) => !inBodega.has(b.name) && !withKnown.has(b.name)
  const needsPlace = dest === 'bodega'
    ? blocks.find((b) => !b.place && homeless(b) && b.rows.some((r) => {
      const code = r.sku || cleanCode(r.code) // de la tienda o escrito
      return splitRow(r, splitting(b)).rest > 0 && code && !known.get(code) // lo repartido ya tiene su ubicacion
    }))
    : null
  // repartida: que no pase de lo que llego y que cada parte diga a donde va
  const overSplit = blocks.find((b) => splitting(b) && b.rows.some((r) => partsTotal(r.parts) > r.qty))
  const unplaced = blocks.find((b) => splitting(b) && b.rows.some((r) => r.qty > 0 && (r.parts || []).some((x) => x.qty > 0 && !x.loc)))
  // lo que dice "automatica" en cada referencia: donde estan hoy sus tallas
  const autoLabel = (b) => {
    const here = [...new Set(b.rows.map((r) => known.get(r.sku)).filter(Boolean).map((p) => p.location_name || p.location_id))]
    if (here.length) return `Automática: donde ya está (${here.slice(0, 2).join(', ')}${here.length > 2 ? '…' : ''})`
    return homeless(b) ? 'Elige dónde guardarla' : 'Automática: con sus otras tallas'
  }
  // a donde va lo que no se repartio ("Quedan 5 → ...")
  const mainLabel = (b) => {
    if (b.place) return groups.flatMap((g) => g.options).find((o) => o.id === b.place)?.name || b.place
    const auto = autoLabel(b)
    return auto.startsWith('Automática: ') ? auto.slice(12) : 'la ubicación de arriba (elígela)'
  }

  const problem = dup ? 'Esta remisión ya entró.'
      : !blocks.length ? 'Elige la referencia que llegó.'
        : !units && !pend ? 'Pon cuántas llegaron de cada talla.'
          : clash ? 'Un código escrito es de otra referencia.'
            : overSplit ? `En ${overSplit.name} repartiste más de las que llegaron.`
              : unplaced ? `Elige la ubicación de cada parte de ${unplaced.name}.`
              : needsPlace ? `Elige dónde guardar ${needsPlace.name}.`
              : noCode ? `Las prendas de paso necesitan su código (talla ${noCode.size || 'única'}).`
                : ''

  const discard = async () => {
    const ok = await ask({
      title: '¿Descartar los cambios?',
      body: `Se borra lo que llevas de esta remisión${units ? ` (${plural(units, 'prenda', 'prendas')})` : ''}${photoFile ? ' y su foto' : ''}. No entra nada al inventario.`,
      confirmLabel: 'Sí, descartar',
    })
    if (!ok) return
    finished.current = true
    await clearDraft()
    showToast('Remisión descartada')
    close()
  }

  const confirm = async () => {
    setSaving(true)
    try {
      const res = await api.post('/api/documents/remision', {
        number: effective, supplier: supplier.trim(), date: date || undefined, destination: dest, notes: notes.trim(),
        lines: lines.map(({ name, size, sku, qty, pending, place, toReserve: res }) => ({
          name, size, sku: sku || undefined, qty, pending,
          location_id: dest === 'bodega' && place && !res ? place : undefined,
          to_reserve: res || undefined,
        })),
      })
      refreshInventory()
      finished.current = true
      clearDraft() // ya entro: el borrador no sigue
      const d = res.document
      // la foto queda como prueba (dos meses); si no sube, la remision igual entro
      let kept = false
      if (photoFile) {
        try {
          await saveDocPhoto(d.id, photoFile)
          kept = true
        } catch {
          kept = false
        }
      }
      revalidate('/api/documents')
      // el aviso a quienes se eligio en "Avisar a"
      const shown = d.number.startsWith('SN-') ? 'sin número' : d.number
      const where = [toBodega && `${toBodega} a la bodega`, toReserve && `${toReserve} a la reserva`, passing && `${units} de paso`].filter(Boolean).join(' · ')
      const told = await sendNotice({
        kind: 'remision', ids: notify.ids, names: notify.names,
        title: `Remisión ${shown}${supplier.trim() ? ` · ${supplier.trim()}` : ''}`,
        body: `${record ? `Se registró (no se sumó): ${plural(d.units, 'prenda', 'prendas')}` : `Entraron ${plural(d.units, 'prenda', 'prendas')}${where ? ` (${where})` : ''}`}${
          d.pending ? `, faltan ${d.pending} por llegar` : ''}. ${itemsText(lines)}`,
      })
      showToast(`Remisión ${shown}: ${record ? `registro de ${plural(d.units, 'prenda', 'prendas')} (no se sumaron)` : plural(d.units, 'prenda entró', 'prendas entraron')}${d.pending ? ` · ${d.pending} pendientes` : ''}${
        photoFile ? (kept ? ' · foto guardada dos meses' : ' · la foto no se guardó: agrégala desde Resumen') : ''}${told}`, kept || !photoFile ? 'ok' : 'err')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. No entró nada; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  if (step === 'pick') {
    return (
      <PickStep
        onFile={(f) => { takePhoto(f); setStep('form') }}
        onSkip={() => setStep('form')}
      />
    )
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Entrada de mercancía</span></div>}
        title="Revisa lo que llegó"
        subtitle="Cuenta las prendas y pon lo que contaste. Si te sales, lo que llevas queda guardado."
      />
      {draft && (
        <div className="rem-resumed" role="note">
          <Icon name="check" size={18} stroke={2.6} />
          <span>
            <b>Sigues con la remisión que dejaste {agoText(draft.at)}</b>
            <small>Todo lo que anotaste sigue aquí. Si no la vas a terminar, abajo está «Descartar cambios».</small>
          </span>
        </div>
      )}
      {photo && (
        <button type="button" className="rem-photo" onClick={() => setZoom(true)} aria-label="Ver la foto en grande">
          <img src={photo} alt="" />
          <span><Icon name="search" size={15} stroke={2.2} />Ampliar</span>
        </button>
      )}

      <label className="field" style={{ marginTop: photo ? 14 : 0 }}>
        <span className="field-label">Número de la remisión u OPR <small className="opt">si lo tiene</small></span>
        <input className="input mono" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej. OPR 1234" autoCapitalize="characters" spellCheck="false" />
      </label>
      {dup && !delivery && (
        <div className="form-err" role="alert">
          Ya entró el {new Date(dup.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} ({dup.user_name}) con {plural(dup.units, 'prenda', 'prendas')}.
          <button type="button" className="btn btn-ink btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => setDelivery(nextDelivery)}>
            Es otra entrega de la misma orden
          </button>
        </div>
      )}
      {delivery > 0 && (
        <p className="rem-delivery">
          <span className="tag tag-out">Entrega {delivery}</span> de la orden <b className="mono">{base}</b>
          <button type="button" className="link-btn" onClick={() => setDelivery(0)}>Quitar</button>
        </p>
      )}
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Proveedor <small className="opt">si lo tiene</small></span>
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} list="rem-suppliers" placeholder="Taller o persona" />
          <datalist id="rem-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span className="field-label">Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <h3 className="h-sec">Lo que llegó</h3>
      {scanning ? (
        <div className="rem-scan">
          <ScanBox onCode={onScan} flash={flash} hint="Cada etiqueta suma una prenda a su talla. Si el código no existe, te pregunta qué prenda es." />
          {unknown && (
            <div className="scan-unknown" role="dialog" aria-label="Código nuevo">
              <div className="sheet-eyebrow"><span className="tag tag-warn">Código nuevo</span><span className="code mono">{unknown.code}</span></div>
              <p className="mode-hint" style={{ margin: '8px 0 0' }}>No está en la bodega ni en la tienda.</p>
              {unknown.near === null
                ? <p className="mode-hint">Buscando uno parecido en la tienda…</p>
                : <NearPick options={unknown.near} onPick={pickNear} />}
              {!unknown.newRef ? (
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-ink" onClick={() => setUnknown((u) => ({ ...u, newRef: true }))}>Es una prenda nueva</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setUnknown(null)}>No contarla</button>
                </div>
              ) : !unknown.ref ? (
                <>
                  <p className="mode-hint">¿De qué referencia es? Búscala o escribe el nombre si es nueva.</p>
                  <RefPicker refs={refs} known={known} onPick={(ref) => setUnknown((u) => ({ ...u, ref }))} onCancel={() => setUnknown((u) => ({ ...u, newRef: false }))} />
                </>
              ) : (
                <form className="rem-add" onSubmit={(e) => { e.preventDefault(); addNew(e.currentTarget.elements.size.value) }}>
                  <span className="rem-add-ref">{unknown.ref.name}</span>
                  <input name="size" className="rem-code" defaultValue={guessSizeFromSku(unknown.code)} placeholder="Talla" autoCapitalize="characters" aria-label="Talla" />
                  <button className="btn btn-ink btn-sm">Agregar</button>
                </form>
              )}
            </div>
          )}
          <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => { setScanning(false); setUnknown(null) }}>Cerrar el escáner</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ink btn-block" onClick={() => setScanning(true)}>
          <Icon name="scan" size={18} />Escanear lo que llegó
        </button>
      )}
      {blocks.map((b) => (
        <section className="rem-block" key={b.id} aria-label={b.name}>
          <div className="rem-block-head">
            <b>{b.name}{b.isNew && <span className="tag tag-warn" style={{ marginLeft: 8 }}>Nueva</span>}{b.shop && <span className="tag tag-set" style={{ marginLeft: 8 }}>Tienda</span>}</b>
            <button type="button" className="link-btn" onClick={() => removeBlock(b.id)}>Quitar</button>
          </div>
          {b.rows.map((r) => (
            <SizeRow
              key={r.size}
              row={r}
              dest={dest}
              showPending={showPending}
              prevPending={prevPending.get(`${b.name}|${r.size}`) || 0}
              known={known}
              onChange={(patch) => setRow(b.id, r.size, patch)}
            />
          ))}
          {addingSize === b.id ? (
            <form className="rem-add" onSubmit={(e) => { e.preventDefault(); addSize(b.id, e.currentTarget.elements.size.value) }}>
              <input name="size" className="rem-code" placeholder="Talla, ej. 5XL o 32" autoFocus autoCapitalize="characters" />
              <button className="btn btn-ink btn-sm">Agregar</button>
            </form>
          ) : (
            <button type="button" className="link-btn rem-more" onClick={() => setAddingSize(b.id)}>
              <Icon name="plus" size={14} stroke={2.4} />Otra talla
            </button>
          )}
        </section>
      ))}
      {picking ? (
        <RefPicker refs={refs} known={known} onPick={pickRef} onCancel={blocks.length ? () => setPicking(false) : null} />
      ) : (
        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
          <Icon name="plus" size={18} stroke={2.2} />Otra referencia en esta remisión
        </button>
      )}

      <div className="menu-check rem-toggle">
        <span>Quedaron unidades pendientes<small>Lo que el proveedor quedó debiendo: solo se anota en la remisión, no se suma al inventario hasta que llegue</small></span>
        <button type="button" className="switch" role="switch" aria-checked={showPending} aria-label="Anotar pendientes" onClick={() => setShowPending((v) => !v)} />
      </div>

      <label className="field">
        <span className="field-label">Notas <small className="opt">lo demás que diga el papel</small></span>
        <textarea
          className="input notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej. parcial, falta el color negro, llegó con una prenda dañada…"
        />
      </label>

      <h3 className="h-sec">Dónde queda</h3>
      <div className="seg four" role="toolbar" aria-label="Dónde queda la mercancía">
        <button type="button" data-m="in" aria-pressed={dest === 'bodega'} onClick={() => setDest('bodega')}>
          <Icon name="warehouse" size={18} stroke={2.1} />Bodega
        </button>
        <button type="button" data-m="out" aria-pressed={dest === 'reserva'} onClick={() => setDest('reserva')}>
          <Icon name="reserve" size={18} stroke={2.1} />Reserva
        </button>
        <button type="button" data-m="set" aria-pressed={dest === 'despacho'} onClick={() => setDest('despacho')}>
          <Icon name="boxOut" size={18} stroke={2.1} />De paso
        </button>
        <button type="button" data-m="reserve" aria-pressed={dest === 'registro'} onClick={() => setDest('registro')}>
          <Icon name="pencil" size={18} stroke={2.1} />Registro
        </button>
      </div>
      {recentIn.length > 0 && !record && (
        <div className="rem-recent" role="note">
          <b>Ojo: algunas ya entraron escaneando</b>
          <small>
            En los últimos 3 días entraron {recentIn.map((r) => {
              const p = known.get(r.sku)
              return `${p ? `${p.name}${p.size ? ` · ${p.size}` : ''}` : r.sku}: ${r.qty}`
            }).join('; ')}. Si son las mismas de esta remisión, guárdala como solo registro para no sumarlas dos veces.
          </small>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => setDest('registro')}>Guardar como solo registro</button>
        </div>
      )}
      {record ? (
        <p className="mode-hint">Solo se guarda el papel, la foto y lo que llegó: no suma nada al inventario. Úsalo cuando ya lo entraste escaneando.</p>
      ) : passing ? (
        <p className="mode-hint">Se cuentan, pero no entran a la bodega: quedan en Despacho hasta que salgan con la factura o una salida. No cuentan para lo que hay que pedir.</p>
      ) : dest === 'bodega' ? (
        <div className="field" style={{ marginTop: 12 }}>
          <span className="field-label">{blocks.length > 1 ? 'Ubicación de cada referencia' : 'Ubicación'}</span>
          {blocks.length ? (
            <div className="rem-places">
              {blocks.map((b) => {
                const arrived = b.rows.filter((r) => r.qty > 0)
                return (
                  <div key={b.id} className={`rem-place${needsPlace?.id === b.id ? ' need' : ''}`}>
                    <span className="rem-place-name">{b.name}</span>
                    <LocationPicker value={b.place} onChange={(v) => setPlace(b.id, v)} groups={groups}
                                    emptyLabel={autoLabel(b)} ariaLabel={`Ubicación de ${b.name}`} />
                    {arrived.length > 0 && (
                      <button type="button" className="link-btn rem-split-toggle" onClick={() => toggleSplit(b.id)}>
                        <Icon name={b.split ? 'x' : 'pin'} size={14} stroke={2.4} />
                        {b.split ? 'No repartir: todo a la ubicación de arriba' : 'Repartir en varias ubicaciones'}
                      </button>
                    )}
                    {b.split && arrived.map((r) => (
                      <SplitRow key={r.size} row={r} size={r.size} mainLabel={mainLabel(b)} groups={groups}
                                onChange={(parts) => setParts(b.id, r.size, parts)} />
                    ))}
                    {b.split && <small className="rem-split-hint">Pon cuántas van a cada canasta o percha (o a la reserva). Las que no repartas entran a la ubicación de arriba.</small>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mode-hint" style={{ marginTop: 4 }}>Cuando agregues lo que llegó, aquí eliges dónde se guarda cada referencia.</p>
          )}
          <span className="field-hint">Cada referencia puede ir a una ubicación distinta. Las tallas sin código quedan en la reserva hasta que les pongas el código.</span>
        </div>
      ) : (
        <p className="mode-hint">Todo queda en la reserva. Desde ahí lo envías a la bodega cuando haga falta.</p>
      )}

      {notify.el}

      <div className="doc-footer">
        <p className="mode-hint">
          {problem || [toBodega && `${toBodega} a la bodega`, toReserve && `${toReserve} a la reserva`, passing && units && `${units} de paso`,
            record && units && `${units} solo registro (no se suman)`, pend && `${plural(pend, 'pendiente', 'pendientes')} (solo anotadas, no se suman)`].filter(Boolean).join(' · ')}
        </p>
        <button className="btn btn-lime btn-lg btn-block" disabled={!!problem || saving} onClick={confirm}>
          {saving ? 'Guardando…' : record ? `Guardar registro de ${plural(units, 'prenda', 'prendas')}` : units ? `Confirmar entrada de ${plural(units, 'prenda', 'prendas')}` : 'Guardar remisión'}
        </button>
        {dirty && (
          <button type="button" className="link-btn rem-discard" disabled={saving} onClick={discard}>
            Descartar cambios
          </button>
        )}
      </div>
      {zoom && photo && <PhotoZoom src={photo} onClose={() => setZoom(false)} />}
    </>
  )
}

export default function RemisionSheet({ onClose }) {
  const showToast = useToast()
  // al salirse a medias: queda guardada (confirmada o descartada ya no hay borrador)
  const closed = () => {
    if (readDraft()) showToast('La remisión quedó guardada: ábrela otra vez para seguir donde ibas.')
    onClose()
  }
  return (
    <Sheet modal onClose={closed} label="Recibir una remisión">
      <Body />
    </Sheet>
  )
}
