import { useEffect, useState } from 'react'
import { api, ApiError } from '../../core/api'
import NearPick from '../../ui/NearPick'
import ProductSearch from './ProductSearch'
import { useToast } from '../../ui/ToastContext'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'

// sku: un codigo escaneado que no esta en la bodega ni en la tienda (hay
// que escribir la referencia). Sin sku: se busca la prenda por nombre (la
// lista de la bodega, la reserva y la tienda) o se agrega a mano; si se
// escribe un codigo, se busca solo como al escanear.
function Form({ sku: scanned = '', defaultQty = 1, onCreated }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [name, setName] = useState('')
  const [size, setSize] = useState('')
  const [qty, setQty] = useState(defaultQty)
  const [sku, setSku] = useState(scanned)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null)
  const [near, setNear] = useState([]) // codigos casi iguales en la tienda
  const [photo, setPhoto] = useState(null)
  const [picks, setPicks] = useState(0) // al elegir de la lista, el buscador se limpia

  const lookNear = (code) => api.get(`/api/catalog/near/${encodeURIComponent(code)}`).then(setNear).catch(() => setNear([]))
  // escaneado y no encontrado: puede estar en la tienda con un codigo casi igual
  useEffect(() => { if (scanned) lookNear(scanned) }, [scanned])

  const identify = () => identifyCode(sku.trim().toUpperCase())
  const identifyCode = async (code) => {
    if (!code || code === scanned) return
    try {
      const who = await api.get(`/api/reserve/identify/${encodeURIComponent(code)}`)
      setFound(who)
      setName(who.name)
      setSize(who.size)
      setNear([])
    } catch {
      setFound(null)
      lookNear(code)
    }
  }

  // elegida de la lista: con codigo se identifica como al escanearla; sin
  // codigo (una de la reserva sin etiqueta) se llenan la referencia y la talla
  const pickFound = (o) => {
    setPicks((n) => n + 1)
    setError('')
    setName(o.name)
    setSize(o.size || '')
    setPhoto(o.image)
    setSku(o.sku || '')
    if (o.sku) identifyCode(o.sku)
    else setFound(null)
  }

  const pickNear = (o) => {
    setName(o.name)
    setSize(o.size || '')
    setPhoto(o.image || null)
    setFound({ ...o, source: 'parecida' })
    setNear([])
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Escribe la referencia.')
    setBusy(true)
    try {
      // un codigo conocido se suma a lo que ya haya en la reserva (no se repite)
      const label = (scanned || sku).trim().toUpperCase()
      if (found?.source === 'parecida' && Number(qty) > 0) {
        // la etiqueta traia el codigo mal: queda reconocida y se guarda con el bueno
        await api.post('/api/catalog/alias', { code: label, sku: found.sku })
      }
      const item = found && Number(qty) > 0
        ? (await api.post('/api/reserve/scan', { sku: found.source === 'parecida' ? label : found.sku, qty: Number(qty) })).item
        : await api.post('/api/reserve', {
          name: name.trim().toUpperCase(), size: size.trim().toUpperCase(),
          qty: Number(qty), sku: sku.trim().toUpperCase() || undefined, image_url: photo || undefined,
        })
      showToast(`${item.name} ${item.size} guardada en la reserva`)
      onCreated(item)
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={scanned ? <div className="sheet-eyebrow"><span className="tag tag-in">Código nuevo</span><span className="code">{scanned}</span></div> : null}
        title="Agregar a la reserva"
        subtitle={scanned
          ? near.length && !found
            ? 'Este código no está igual en la tienda: elige la parecida o escribe la referencia y la talla.'
            : 'Este código no está en la bodega ni en la tienda: escribe la referencia y la talla.'
          : 'Busca la prenda y toca la talla, o escríbela a mano. Queda guardada aparte, sin ubicación todavía.'}
      />
      {!scanned && (
        <div className="field" style={{ marginTop: 0, marginBottom: 14 }}>
          <span className="field-label">Buscar la prenda</span>
          <ProductSearch key={picks} onPick={pickFound} autoFocus={!picks} />
        </div>
      )}
      {/* como al registrar una prenda: la foto y el nombre de la tienda */}
      {found && (
        <div className="shop-hit" style={{ marginBottom: 14 }}>
          {found.image ? <img src={found.image} alt="" /> : <span className="shop-noimg" />}
          <div>
            <span className="tag tag-in">
              {found.source === 'parecida' ? 'Datos de la tienda' : found.source === 'tienda' ? 'Encontrada en la tienda' : found.source === 'bodega' ? 'Está en la bodega' : 'Ya está en la reserva'}
            </span>
            <b>{found.name}{found.size ? ` · ${found.size}` : ''}</b>
            {found.source === 'parecida' && <small>Código bueno: <b className="mono">{found.sku}</b>. La etiqueta queda reconocida: la próxima vez que la escanees, se usa este.</small>}
          </div>
        </div>
      )}
      {!found && <NearPick options={near} onPick={pickNear} />}
      <form onSubmit={submit}>
        {!scanned && (
          <label className="field" style={{ marginTop: 0 }}>
            <span className="field-label">Código (si tiene etiqueta)</span>
            <input className="input mono" value={sku} onChange={(e) => { setSku(e.target.value); setFound(null) }} onBlur={identify}
                   placeholder="Escríbelo y se busca solo" autoCapitalize="characters" />
            {found && (
              <span className="field-hint">
                {found.source === 'reserva' ? 'Ya está en la reserva' : `Encontrada en la ${found.source}`}
                {found.in_reserve ? ` · ya hay ${found.in_reserve} guardadas: se suman` : ''}
              </span>
            )}
          </label>
        )}
        <label className="field" style={scanned ? { marginTop: 0 } : undefined}>
          <span className="field-label">Referencia</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Chaqueta Fenix Black Fem" autoFocus={!!scanned} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Talla</span>
            <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Única" />
          </label>
          <label className="field">
            <span className="field-label">Cantidad</span>
            <input className="input" type="number" min="0" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
        </div>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={busy}>{busy ? 'Guardando…' : 'Guardar en reserva'}</button>
        </div>
      </form>
    </>
  )
}

export default function NewReserveModal({ onClose, ...props }) {
  return (
    <Sheet modal onClose={onClose} label="Agregar a la reserva">
      <Form {...props} />
    </Sheet>
  )
}
