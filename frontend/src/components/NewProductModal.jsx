import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import { LocationSelect } from './ProductModal'
import { guessSizeFromSku, money } from '../utils'

function Form({ sku, defaultLocation, locations, onCreated }) {
  const showToast = useToast()
  const { close } = useSheet()
  const [name, setName] = useState('')
  const [size, setSize] = useState(guessSizeFromSku(sku))
  const [qty, setQty] = useState(1)
  const [minQty, setMinQty] = useState(3)
  const [locationId, setLocationId] = useState(defaultLocation)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shop, setShop] = useState(null)

  // el codigo de la etiqueta es el de la tienda: nombre, talla y foto de una vez
  useEffect(() => {
    let alive = true
    api.get(`/api/catalog/lookup/${encodeURIComponent(sku)}`)
      .then((hit) => {
        if (!alive) return
        setShop(hit)
        setName((n) => n || hit.name)
        if (hit.size) setSize(hit.size)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [sku])

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Escribe la referencia como aparece en la etiqueta.')
    setBusy(true)
    try {
      const res = await api.post('/api/products', {
        sku, name: name.trim().toUpperCase(), size: size.trim().toUpperCase(),
        location_id: locationId, qty: Number(qty), min_qty: Number(minQty), image_url: shop?.image || undefined,
      })
      showToast(`${res.product.name} ${res.product.size} registrada`)
      onCreated(res)
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la prenda.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-in">Código nuevo</span><span className="code">{sku}</span></div>}
        title="Registrar prenda"
        subtitle="Este código todavía no existe en la bodega."
      />
      {shop && (
        <div className="shop-hit">
          {shop.image ? <img src={shop.image} alt="" /> : <span className="shop-noimg" />}
          <div>
            <span className="tag tag-in">Encontrada en la tienda</span>
            <b>{shop.name}{shop.size ? ` · ${shop.size}` : ''}</b>
            {shop.price > 0 && <small>{money(shop.price)}</small>}
          </div>
        </div>
      )}
      <form onSubmit={submit}>
        <label className="field" style={{ marginTop: shop ? 16 : 0 }}>
          <span className="field-label">Referencia</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Chaqueta Fenix Black Fem" />
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
        <label className="field">
          <span className="field-label">Ubicación</span>
          <LocationSelect value={locationId} onChange={setLocationId} locations={locations} currentName={locationId} />
        </label>
        <label className="field">
          <span className="field-label">Stock mínimo</span>
          <input className="input" type="number" min="0" inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          <span className="field-hint">Al llegar a este número aparece en “Por reponer”. Pon 0 para no avisar.</span>
        </label>
        {error && <p className="form-err" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => close()}>Cancelar</button>
          <button className="btn btn-lime" disabled={busy}>{busy ? 'Registrando…' : 'Registrar prenda'}</button>
        </div>
      </form>
    </>
  )
}

export default function NewProductModal({ onClose, ...props }) {
  return (
    <Sheet modal onClose={onClose} label="Registrar prenda nueva">
      <Form {...props} />
    </Sheet>
  )
}
