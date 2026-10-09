import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isViewOnly } from '../../core/api'
import { refreshInventory, revalidate, useLayout, usePolling, useProducts } from '../../core/useApi'
import { docPhotoBlob, downloadPhoto, saveDocPhoto } from './docPhotos'
import PhotoZoom from '../../ui/PhotoZoom'
import { useToast } from '../../ui/ToastContext'
import { useConfirm } from '../../ui/ConfirmContext'
import { sizeRank, fmtTime, pedidoLabel } from '../../core/utils'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import Icon from '../../ui/Icon'
import { Empty, SearchField, plural } from '../../ui/Bits'
import AttachSheet from '../facturas/AttachFactura'
import { useCrop } from '../../ui/PhotoCrop'
import { orderBase, orderSummary } from '../remisiones/orderSummary'

// un pedido que espera su factura todavia no tiene numero (PED-...)
export const waiting = (d) => d.kind === 'factura' && d.status === 'espera'
// un pedido que se confirmo sin factura (se queda con su PED-...)
export const noFactura = (d) => d.kind === 'factura' && d.mode === 'sin_factura'

export const docTitle = (d) => (waiting(d) ? pedidoLabel(d) : noFactura(d) ? `${pedidoLabel(d)} · sin factura`
  : d.kind === 'factura' ? `Factura ${d.number}`
  : d.number.startsWith('SN-') ? 'Remisión sin número' : `Remisión ${d.number}`)

const fmtWhen = (iso) => {
  const t = new Date(iso)
  return `${t.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} a las ${t.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}`
}

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

const DAYS = 60
const fmtDate = (d) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })

// La foto del papel: la prueba de lo que llego o salio. Se guarda dos meses;
// se ve en grande, se descarga y, si falta, se puede agregar. Una que se subio
// por error se borra (preguntando antes).
function Photos({ doc, onChange }) {
  const showToast = useToast()
  const confirm = useConfirm()
  const input = useRef(null)
  const [shots, setShots] = useState([]) // [{ blob, url }]
  const [zoom, setZoom] = useState(null)
  const [busy, setBusy] = useState(false)
  const count = doc.photo_count || 0
  const age = (Date.now() - new Date(doc.created_at).getTime()) / 864e5
  const canAdd = count < 4 && age < DAYS
  const name = (i) => `${docTitle(doc).replace(/\s+/g, '-').toLowerCase()}${count > 1 ? `-${i + 1}` : ''}.jpg`

  useEffect(() => {
    let alive = true
    const made = []
    ;(async () => {
      for (let i = 0; i < count; i++) {
        try {
          const blob = await docPhotoBlob(doc.id, i)
          const shot = { blob, url: URL.createObjectURL(blob), index: i } // su numero en el servidor
          made.push(shot)
          if (alive) setShots([...made])
        } catch {
          // ya no esta: se borro a los dos meses
        }
      }
    })()
    return () => {
      alive = false
      made.forEach((s) => URL.revokeObjectURL(s.url))
    }
  }, [doc.id, count])

  const [cropEl, crop] = useCrop()
  const add = async (e) => {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    const f = await crop(picked)
    if (!f) return
    setBusy(true)
    try {
      onChange(await saveDocPhoto(doc.id, f))
      revalidate('/api/documents')
      showToast('Foto guardada: se guarda dos meses')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo guardar la foto.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s) => {
    const ok = await confirm({
      title: '¿Borrar esta foto?',
      body: `Se borra la foto${count > 1 ? ` ${s.index + 1} de ${count}` : ''} de ${docTitle(doc)}. Lo registrado (las prendas) no cambia.`,
      confirmLabel: 'Sí, borrar',
    })
    if (!ok) return
    setBusy(true)
    try {
      onChange(await api.delete(`/api/documents/${doc.id}/photos/${s.index}`))
      revalidate('/api/documents')
      showToast('Foto borrada')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo borrar la foto.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3 className="h-sec">Foto del papel {doc.photos_until && <small>hasta el {fmtDate(new Date(doc.photos_until))}</small>}</h3>
      {count > 0 ? (
        <div className="doc-photos">
          {shots.map((s) => (
            <div className="doc-photo" key={s.url}>
              <button type="button" className="doc-photo-img" onClick={() => setZoom(s.url)} aria-label="Ver la foto en grande">
                <img src={s.url} alt="" />
              </button>
              <div className="doc-photo-acts">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadPhoto(s.blob, name(s.index))}>
                  <Icon name="download" size={16} />Descargar
                </button>
                {!isViewOnly() && (
                  <button type="button" className="btn btn-ghost btn-sm doc-photo-del" onClick={() => remove(s)} disabled={busy}
                          aria-label={`Borrar la foto${count > 1 ? ` ${s.index + 1}` : ''}`}>
                    <Icon name="trash" size={17} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {shots.length < count && <div className="doc-photo skeleton" />}
        </div>
      ) : (
        <p className="muted doc-photo-none">
          {age < DAYS ? 'Sin foto guardada.' : 'La foto ya no está: se guardan dos meses. Lo registrado se queda.'}
        </p>
      )}
      {count > 0 && <p className="mode-hint">Se guarda dos meses como prueba y después se borra sola; lo registrado se queda.</p>}
      {canAdd && (
        <>
          <input ref={input} type="file" accept="image/*" hidden onChange={add} />
          {cropEl}
          <button type="button" className="link-btn see-all" onClick={() => input.current.click()} disabled={busy}>
            <Icon name="camera" size={15} />{busy ? 'Guardando la foto…' : count ? 'Agregar otra foto' : 'Agregar la foto'}
          </button>
        </>
      )}
      {zoom && <PhotoZoom src={zoom} onClose={() => setZoom(null)} label={docTitle(doc)} />}
    </>
  )
}

// Lo que dice una remision o una factura ya aplicada: datos del papel y
// cada prenda con su talla, cuantas y a donde fue (o de donde salio).
function Detail({ doc: initial }) {
  const showToast = useToast()
  const confirm = useConfirm()
  const { close } = useSheet()
  const [doc, setDoc] = useState(initial)
  const [attaching, setAttaching] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const isWaiting = waiting(doc)
  const record = doc.mode === 'registro'
  const sinFactura = noFactura(doc)
  const [closing, setClosing] = useState(false)

  // un pedido que no va a tener factura: queda cerrado como salida
  const confirmNoFactura = async () => {
    const ok = await confirm({
      title: '¿Confirmar sin factura?',
      body: 'El pedido queda cerrado como salida, sin número de factura. Ya se descontó al empacarlo: el inventario no cambia. Si al final llega la factura, puedes volver a dejarlo esperando.',
      confirmLabel: 'Sí, confirmar',
      danger: false,
    })
    if (!ok) return
    setClosing(true)
    try {
      setDoc(await api.post(`/api/documents/${doc.id}/sin-factura`))
      revalidate('/api/documents')
      revalidate('/api/movements')
      showToast('Pedido confirmado sin factura')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo confirmar. Intenta otra vez.', 'err')
    } finally {
      setClosing(false)
    }
  }
  // al final si llego la factura: vuelve a esperarla para anexarla
  const waitAgain = async () => {
    setClosing(true)
    try {
      setDoc(await api.post(`/api/documents/${doc.id}/esperar-factura`))
      revalidate('/api/documents')
      revalidate('/api/movements')
      showToast('El pedido volvió a esperar su factura')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo cambiar. Intenta otra vez.', 'err')
    } finally {
      setClosing(false)
    }
  }

  // deshacer un pedido que espera factura: todo vuelve a donde salio
  const undo = async () => {
    const ok = await confirm({
      title: '¿Deshacer este pedido?',
      body: `Las ${plural(doc.units, 'prenda vuelve', 'prendas vuelven')} a la ubicación de donde salieron y el pedido se borra.`,
      confirmLabel: 'Sí, deshacer',
    })
    if (!ok) return
    setUndoing(true)
    try {
      await api.delete(`/api/documents/${doc.id}`)
      refreshInventory()
      revalidate('/api/documents')
      showToast('Pedido deshecho: las prendas volvieron a su lugar')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo deshacer el pedido.', 'err')
      setUndoing(false)
    }
  }
  const { data: products } = useProducts()
  const { data: layout } = useLayout()
  const locName = useMemo(() => new Map((layout?.elements || []).flatMap((e) => e.locations || []).map((l) => [l.id, l.name])), [layout])
  const bySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])
  const isRem = doc.kind === 'remision'
  const created = new Date(doc.created_at)

  // el PDF de la remision: la orden con todas sus entregas (OPR77, OPR77#2...),
  // que llego, que falta y donde quedo. Se arma aqui y se descarga; no se guarda.
  const [pdfBusy, setPdfBusy] = useState(false)
  const makePdf = async () => {
    setPdfBusy(true)
    try {
      const base = orderBase(doc.number)
      let deliveries = [doc]
      if (!doc.number.startsWith('SN-')) {
        const list = await api.get(`/api/documents?kind=remision&base=${encodeURIComponent(base)}&limit=20`)
        const same = list.filter((d) => orderBase(d.number) === base)
        if (same.length) deliveries = same.some((d) => d.id === doc.id) ? same : [...same, doc]
      }
      const multi = deliveries.length > 1
      const title = doc.number.startsWith('SN-') ? 'Remisión sin número'
        : multi ? `Orden ${base} · ${deliveries.length} entregas` : `Remisión ${doc.number}`
      const { remisionPdf } = await import('../remisiones/remisionPdf')
      const blob = await remisionPdf(orderSummary(deliveries, (id) => locName.get(id)), {
        title, registered: multi ? '' : `${fmtWhen(doc.created_at)} · ${doc.user_name}`,
      })
      await downloadPhoto(blob, `remision-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo armar el PDF. Intenta otra vez.', 'err')
    } finally {
      setPdfBusy(false)
    }
  }

  const groups = useMemo(() => {
    const map = new Map()
    for (const l of doc.lines || []) {
      const p = l.sku ? bySku.get(l.sku) : null
      const name = l.name || p?.name || l.sku
      if (!map.has(name)) map.set(name, [])
      map.get(name).push({ ...l, size: l.size ?? p?.size ?? '' })
    }
    for (const rows of map.values()) rows.sort((a, b) => sizeRank(a.size) - sizeRank(b.size))
    return [...map]
  }, [doc, bySku])

  const where = (l) => {
    if (record) return isRem ? (l.qty ? 'Solo registro: no se sumó' : 'No llegó') : 'Solo registro: no se descontó'
    if (!isRem && l.location_id === 'RESERVA') return 'Salió de la reserva'
    if (!isRem) return l.location_id ? `Salió de ${locName.get(l.location_id) || l.location_id}` : 'Salió de donde había'
    if (!l.qty) return 'No llegó'
    if (l.dest === 'reserva') return 'Quedó en la reserva'
    return `Quedó en ${locName.get(l.location_id) || l.location_id || 'la bodega'}`
  }

  return (
    <>
      <SheetHeader
        eyebrow={
          <div className="sheet-eyebrow">
            <span className={`tag ${isRem ? 'tag-in' : 'tag-out'}`}>{isRem ? 'Entrada' : 'Salida'}</span>
            {isWaiting && <span className="tag tag-warn">Esperando factura</span>}
            {sinFactura && <span className="tag tag-set">Sin factura</span>}
            {record && <span className="tag tag-set">Solo registro</span>}
          </div>
        }
        title={docTitle(doc)}
        subtitle={`Registrada el ${created.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} a las ${created.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })} · ${doc.user_name}`}
      />
      <div className="doc-meta">
        <div><span>{isRem ? 'Entraron' : 'Salieron'}</span><b>{doc.units}</b></div>
        {isRem && doc.pending > 0 && <div><span>Quedaron debiendo</span><b className="warn">{doc.pending}</b></div>}
        {doc.supplier && <div><span>Proveedor</span><b>{doc.supplier}</b></div>}
        {doc.doc_date && <div><span>Fecha del papel</span><b>{fmtDay(doc.doc_date)}</b></div>}
      </div>
      {doc.notes && <p className="doc-notes"><Icon name="pencil" size={15} />{doc.notes}</p>}
      {record && (
        <p className="doc-banner">
          Solo registro: se guardó el papel y lo que dice, sin {isRem ? 'sumar' : 'descontar'} nada del inventario (ya se había {isRem ? 'entrado' : 'descontado'}).
        </p>
      )}
      {isWaiting && (
        <div className="doc-banner wait">
          <p>Se empacó y ya salió del inventario. Falta anexar su factura: el número y la foto.</p>
          <button type="button" className="btn btn-lime btn-block" onClick={() => setAttaching(true)}>
            <Icon name="receipt" size={18} />Anexar factura
          </button>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} disabled={closing || undoing} onClick={confirmNoFactura}>
            <Icon name="check" size={18} stroke={2.4} />{closing ? 'Confirmando…' : 'Confirmar sin factura'}
          </button>
          <button type="button" className="btn btn-quiet btn-block" style={{ marginTop: 8 }} disabled={undoing} onClick={undo}>
            {undoing ? 'Deshaciendo…' : 'Deshacer pedido (las prendas vuelven)'}
          </button>
        </div>
      )}
      {sinFactura && (
        <div className="doc-banner">
          <p>Se armó como pedido el {fmtWhen(doc.created_at)} y se confirmó sin factura el {fmtWhen(doc.closed_at)}.</p>
          {!isViewOnly() && (
            <button type="button" className="link-btn" style={{ marginTop: 6 }} disabled={closing} onClick={waitAgain}>
              Al final llegó la factura: volver a esperarla
            </button>
          )}
        </div>
      )}
      {doc.closed_at && !sinFactura && (
        <p className="doc-banner">Se armó como pedido el {fmtWhen(doc.created_at)} y la factura se anexó el {fmtWhen(doc.closed_at)}</p>
      )}

      {(doc.kind === 'factura' || doc.kind === 'remision') && <Photos doc={doc} onChange={setDoc} />}

      <h3 className="h-sec">Prendas</h3>
      <div className="card panel">
        {groups.map(([name, rows]) => (
          <div className="doc-group" key={name}>
            <b>{name}</b>
            {rows.map((l, i) => (
              <div className="doc-row" key={`${l.sku || l.size}-${i}`}>
                <span className="sz">{l.size || 'U'}</span>
                <span className="doc-row-t">
                  {where(l)}
                  {l.sku && <small className="mono">{l.sku}</small>}
                  {l.pending > 0 && <small className="warn">Quedaron debiendo {l.pending}</small>}
                </span>
                <b className={`doc-row-q ${isRem ? 'in' : 'out'}`}>{isRem ? `+${l.qty}` : `−${l.qty}`}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
      {isRem && (
        <button type="button" className="btn btn-ink btn-block doc-pdf" onClick={makePdf} disabled={pdfBusy}>
          <Icon name="download" size={18} />{pdfBusy ? 'Armando el PDF…' : 'Descargar PDF de la remisión'}
        </button>
      )}
      {isRem && <p className="mode-hint">Lo que llegó de cada talla, lo que falta y dónde quedó (con las otras entregas de la misma orden). Se arma en el momento: no se guarda.</p>}
      {attaching && <AttachSheet pedido={doc} onClose={() => setAttaching(false)} onDone={(d) => setDoc(d)} />}
    </>
  )
}

export default function DocumentSheet({ doc, onClose }) {
  return (
    <Sheet modal onClose={onClose} label={docTitle(doc)}>
      <Detail doc={doc} />
    </Sheet>
  )
}

// Una remision o una factura en una lista: numero, de quien y cuando, lo
// que quedaron debiendo, la nota y cuantas prendas. Si tiene la foto del
// papel, una camarita.
export function DocItem({ doc, onOpen, time = fmtTime }) {
  const isRem = doc.kind === 'remision'
  const sn = doc.number.startsWith('SN-')
  const wait = waiting(doc)
  const sinF = noFactura(doc)
  const owed = isRem ? (doc.lines || []).filter((l) => l.pending > 0) : []
  return (
    <button type="button" className="need doc-item" onClick={() => onOpen(doc)}>
      <span className="need-t">
        <b className={sn || wait || sinF ? '' : 'mono'}>
          {wait || sinF ? pedidoLabel(doc) : sn ? 'Sin número' : doc.number}
          {doc.photo_count > 0 && <Icon name="camera" size={14} stroke={2.2} className="doc-cam" aria-label="Con foto" role="img" aria-hidden={false} />}
        </b>
        {(wait || sinF || doc.mode === 'registro') && (
          <span className={`doc-flag ${wait ? 'wait' : ''}`}>{wait ? 'Esperando factura' : sinF ? 'Sin factura' : 'Solo registro'}</span>
        )}
        <small>{[isRem ? doc.supplier : plural((doc.lines || []).length, 'referencia', 'referencias'), doc.user_name, time(doc.created_at)].filter(Boolean).join(' · ')}</small>
        {owed.length > 0 && <small className="owed">Quedaron debiendo {owed.map((l) => `${l.size || 'única'} ${l.pending}`).join(', ')}</small>}
        {doc.notes && <small className="note">{doc.notes}</small>}
      </span>
      <span className={`need-q ${isRem ? '' : 'dark'}`}>
        <b>{doc.units}</b>
        <span>{isRem ? (doc.units === 1 ? 'entró' : 'entraron') : (doc.units === 1 ? 'salió' : 'salieron')}</span>
      </span>
    </button>
  )
}

const PAGE = 30

// Todas las remisiones (o facturas): de a 30, con "Ver más", y buscando por
// numero, proveedor, nota, quien la registro o una prenda (sin importar
// tildes ni mayusculas). Tocar una abre su detalle.
function All({ kind: asked, onOpen }) {
  // "espera": los pedidos que esperan su factura (son facturas sin numero todavia)
  const pending = asked === 'espera'
  const kind = pending ? 'factura' : asked
  const { data: counts } = usePolling('/api/documents/counts', { interval: 60000 })
  const [q, setQ] = useState('')
  const [list, setList] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const req = useRef(0) // solo vale la ultima busqueda
  const term = q.trim()
  const isRem = kind === 'remision'

  const load = async (before) => {
    const id = ++req.current
    setBusy(true)
    try {
      const page = await api.get(`/api/documents?kind=${kind}&limit=${PAGE}${pending ? '&status=espera' : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}${before ? `&before=${before}` : ''}`)
      if (id !== req.current) return
      setList((cur) => (before ? [...(cur || []), ...page] : page))
      setMore(page.length === PAGE)
      setFailed(false)
    } catch {
      if (id === req.current) setFailed(true)
    } finally {
      if (id === req.current) setBusy(false)
    }
  }
  useEffect(() => {
    const t = setTimeout(() => load(), term ? 300 : 0)
    return () => clearTimeout(t)
  }, [asked, term]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = counts?.[pending ? 'espera' : kind]
  return (
    <>
      <SheetHeader
        title={pending ? 'Pedidos esperando factura' : isRem ? 'Remisiones recibidas' : 'Facturas descontadas'}
        subtitle={total == null ? 'Cargando…' : pending ? `${plural(total, 'pedido', 'pedidos')} · ya salieron del inventario; ábrelos para anexar la factura`
          : `${plural(total, isRem ? 'remisión guardada' : 'factura guardada', isRem ? 'remisiones guardadas' : 'facturas guardadas')} · la más reciente primero`}
      />
      <SearchField value={q} onChange={setQ} placeholder={isRem ? 'Número, proveedor, nota o prenda' : 'Número o prenda'} />
      <div className="card panel" style={{ marginTop: 12 }}>
        {!list ? (
          failed ? <p className="muted doc-photo-none">No se pudo cargar. Revisa la conexión.</p> : <div className="skeleton" style={{ margin: '10px 0' }} />
        ) : list.length ? list.map((d) => <DocItem key={d.id} doc={d} onOpen={onOpen} />) : (
          <Empty icon="search" title={term ? 'Nada coincide' : pending ? 'Ningún pedido espera factura' : isRem ? 'Todavía no hay remisiones' : 'Todavía no hay facturas'}>
            {term ? 'Prueba con otra palabra.' : isRem ? 'Se reciben desde Escanear → Recibir remisión.' : 'Se descuentan desde Escanear → Descontar factura.'}
          </Empty>
        )}
      </div>
      {list && more && (
        <button type="button" className="link-btn see-all" disabled={busy} onClick={() => load(list[list.length - 1].id)}>
          {busy ? 'Cargando…' : 'Ver más'}<Icon name="arrowRight" size={14} stroke={2.4} />
        </button>
      )}
    </>
  )
}

export function DocumentsSheet({ kind, onClose }) {
  const [open, setOpen] = useState(null)
  return (
    <Sheet modal onClose={onClose} label="Documentos">
      <All kind={kind} onOpen={setOpen} />
      {open && <DocumentSheet doc={open} onClose={() => setOpen(null)} />}
    </Sheet>
  )
}
