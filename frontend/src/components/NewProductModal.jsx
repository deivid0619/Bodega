import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { useReserve } from '../hooks/useApi'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import { LocationSelect } from './ProductModal'
import NearPick from './NearPick'
import { guessSizeFromSku, money, reserveFor, reserveIndex, similarInReserve } from '../utils'

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
  // la prenda ya esta en la reserva: si se trae de alla, se descuenta de la
  // reserva (si no, quedaria contada dos veces: en la reserva y en la bodega)
  const { data: reserve } = useReserve()
  const matched = useMemo(() => reserveFor(
    { sku, name: name.trim().toUpperCase(), size: size.trim().toUpperCase() }, reserveIndex(reserve),
  )[0] || null, [reserve, sku, name, size])
  // guardada a mano en la reserva con otro nombre: se elige y queda unida a este codigo
  const [linked, setLinked] = useState(null)
  const similar = useMemo(() => (matched ? [] : similarInReserve(reserve, name, size)), [matched, reserve, name, size])
  const inReserve = matched || linked
  const [fromReserve, setFromReserve] = useState(true)
  const [near, setNear] = useState([]) // codigos casi iguales en la tienda

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
      .catch(() => api.get(`/api/catalog/near/${encodeURIComponent(sku)}`).then((list) => { if (alive) setNear(list) }).catch(() => {}))
    return () => { alive = false }
  }, [sku])

  const pickNear = (o) => {
    setShop({ ...o, near: true })
    setName(o.name)
    if (o.size) setSize(o.size)
    setNear([])
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Escribe la referencia como aparece en la etiqueta.')
    setBusy(true)
    try {
      const n = Number(qty)
      if (inReserve && fromReserve && n > 0) {
        // se trae de la reserva (y si son mas de las que habia, el resto entra como nuevas)
        const take = Math.min(n, inReserve.qty)
        const tr = await api.post(`/api/reserve/${inReserve.id}/transfer`, { qty: take, location_id: locationId, sku })
        const moves = [...tr.movements]
        if (n > take) {
          const more = await api.post('/api/movements', { sku, type: 'in', qty: n - take, location_id: locationId })
          moves.push(...(more.movements?.length ? more.movements : [more.movement]))
        }
        // lo que se escribio aqui: nombre, talla, minimo y foto
        const product = await api.patch(`/api/products/${encodeURIComponent(sku)}`, {
          name: name.trim().toUpperCase(), size: size.trim().toUpperCase(), min_qty: Number(minQty), image_url: shop?.image || undefined,
        })
        showToast(`${product.name} ${product.size} registrada · ${take} ${take === 1 ? 'traída' : 'traídas'} de la reserva`)
        onCreated({ product, movement: moves[moves.length - 1], movements: moves })
        close()
        return
      }
      if (linked) {
        // es la de la reserva aunque no vengan de alla: queda unida por el codigo
        await api.patch(`/api/reserve/${linked.id}`, { sku })
      }
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
            <span className="tag tag-in">{shop.near ? 'Datos de la tienda' : 'Encontrada en la tienda'}</span>
            <b>{shop.name}{shop.size ? ` · ${shop.size}` : ''}</b>
            {shop.near ? <small>En la tienda: {shop.sku} · queda con el código de la etiqueta</small> : shop.price > 0 && <small>{money(shop.price)}</small>}
          </div>
        </div>
      )}
      {!shop && <NearPick options={near} onPick={pickNear} />}
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
        {!inReserve && similar.length > 0 && (
          <div className="near-pick reserve">
            <span className="tag tag-warn">¿Está en la reserva?</span>
            <p>Hay guardada a mano una parecida. Si es la misma, elígela: queda unida a este código y no se cuenta aparte.</p>
            {similar.map((it) => (
              <button type="button" key={it.id} className="near-opt" onClick={() => setLinked(it)}>
                {it.image_url ? <img src={it.image_url} alt="" /> : <span className="shop-noimg" />}
                <span className="near-opt-t"><b>{it.name}{it.size ? ` · ${it.size}` : ''}</b><small>{it.qty} en la reserva</small></span>
              </button>
            ))}
          </div>
        )}
        {linked && (
          <p className="linked-note">
            Unida a la de la reserva: {linked.name}{linked.size ? ` · ${linked.size}` : ''}
            <button type="button" className="link-btn" onClick={() => setLinked(null)}>No es esta</button>
          </p>
        )}
        {inReserve && (
          <label className="from-reserve">
            <input type="checkbox" checked={fromReserve} onChange={(e) => setFromReserve(e.target.checked)} />
            <span>
              <b>Vienen de la reserva</b>
              <small>
                {fromReserve
                  ? `Hay ${inReserve.qty} guardadas allá: se descuentan de la reserva para no contarlas dos veces.`
                  : `Hay ${inReserve.qty} en la reserva y se quedan allá: estas entran como nuevas.`}
              </small>
            </span>
          </label>
        )}
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
