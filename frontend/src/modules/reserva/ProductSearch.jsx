import { useEffect, useMemo, useState } from 'react'
import { api } from '../../core/api'
import { useProducts, useReserve } from '../../core/useApi'
import { sizeRank } from '../../core/utils'
import { SearchField } from '../../ui/Bits'
import Sheet, { SheetHeader, useSheet } from '../../ui/Sheet'
import { buildRefs } from '../remisiones/refs'

// Buscar la prenda sin escanear ni escribir el codigo: por la referencia o
// parte del codigo. Sale la lista de lo que hay en la bodega, en la reserva y
// en la tienda, cada referencia con sus tallas; tocar una talla la elige.
// needCode: solo las tallas que tienen codigo (para usarlas como un escaneo).
// onPick({ sku, name, size, image })

const where = (s) => (s.reserva > 0 ? `${s.reserva} en reserva` : s.bodega > 0 ? `${s.bodega} en bodega` : s.shop ? 'de la tienda' : 'no hay')

export default function ProductSearch({ onPick, needCode = false, autoFocus = false }) {
  const { data: products } = useProducts()
  const { data: reserve } = useReserve()
  const [q, setQ] = useState('')
  const [shop, setShop] = useState({ term: '', list: [] })
  const term = q.trim().toUpperCase().replace(/\s+/g, ' ')

  const refs = useMemo(() => buildRefs(products || [], reserve || []), [products, reserve])
  const images = useMemo(() => {
    const m = new Map()
    for (const p of [...(products || []), ...(reserve || [])]) if (p.image_url && !m.has(p.name)) m.set(p.name, p.image_url)
    return m
  }, [products, reserve])

  // la tienda: al dejar de escribir un momento
  useEffect(() => {
    if (term.length < 3) return undefined
    const t = setTimeout(() => {
      api.get(`/api/catalog/search?q=${encodeURIComponent(term)}&limit=6`)
        .then((list) => setShop({ term, list }))
        .catch(() => setShop({ term, list: [] }))
    }, 250)
    return () => clearTimeout(t)
  }, [term])

  const rows = useMemo(() => {
    if (term.length < 2) return []
    const code = term.replace(/ /g, '')
    const words = term.split(' ')
    const local = refs
      .filter((r) => words.every((w) => r.name.includes(w)) || [...r.sizes.values()].some((s) => s.sku && s.sku.includes(code)))
      .sort((a, b) => b.bodega + b.reserva - (a.bodega + a.reserva))
      .slice(0, 8)
    const byName = new Map(local.map((r) => [r.name, {
      name: r.name, image: images.get(r.name), bodega: r.bodega, reserva: r.reserva, shop: false,
      sizes: [...r.sizes.values()].map((s) => ({ size: s.size, sku: s.sku, bodega: s.bodega, reserva: s.reserva })),
    }]))
    // de la tienda: las tallas que todavia no estan en la bodega ni en la reserva
    const seen = new Set(refs.flatMap((r) => [...r.sizes.values()].map((s) => s.sku).filter(Boolean)))
    const extra = []
    for (const g of shop.term && term.startsWith(shop.term) ? shop.list : []) {
      // (mientras llega la respuesta de lo ultimo escrito, la anterior filtrada)
      if (!words.every((w) => g.name.includes(w)) && !g.sizes.some((s) => s.sku.startsWith(code))) continue
      const sizes = g.sizes.filter((s) => !seen.has(s.sku)).map((s) => ({ size: s.size || '', sku: s.sku, bodega: 0, reserva: 0, shop: true }))
      if (!sizes.length) continue
      const row = byName.get(g.name)
      if (row) {
        row.sizes.push(...sizes.filter((s) => !row.sizes.some((x) => x.size === s.size)))
        row.image = row.image || g.image
      } else {
        extra.push({ name: g.name, image: g.image, bodega: 0, reserva: 0, shop: true, sizes })
      }
    }
    return [...byName.values(), ...extra]
      .map((r) => ({ ...r, sizes: r.sizes.filter((s) => !needCode || s.sku).sort((a, b) => sizeRank(a.size) - sizeRank(b.size)) }))
      .filter((r) => r.sizes.length)
  }, [term, refs, images, shop, needCode])

  const waiting = term.length >= 3 && shop.term !== term

  return (
    <div className="psearch">
      <SearchField value={q} onChange={setQ} placeholder="Referencia o parte del código" autoFocus={autoFocus} aria-label="Buscar la prenda" />
      {term.length >= 2 && (
        <div className="ref-results">
          {rows.map((r) => (
            <div key={r.name} className={`ps-ref${r.shop ? ' shop' : ''}`}>
              <div className="ps-head">
                {r.image ? <img src={r.image} alt="" loading="lazy" /> : <span className="ps-noimg" aria-hidden="true" />}
                <span className="ref-result-t">
                  <b>{r.name}</b>
                  <small>{r.shop ? 'De la tienda' : `${r.bodega} en bodega${r.reserva ? ` · ${r.reserva} en reserva` : ''}`}</small>
                </span>
              </div>
              <div className="ps-sizes">
                {r.sizes.map((s) => (
                  <button type="button" key={s.sku || s.size} className="ps-size"
                          aria-label={`Elegir ${r.name} talla ${s.size || 'única'} (${where(s)})`}
                          onClick={() => onPick({ sku: s.sku || null, name: r.name, size: s.size, image: r.image || null })}>
                    <b>{s.size || 'Única'}</b>
                    {!r.shop && <small>{where(s)}</small>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!rows.length && (
            <p className="mode-hint">{term.length < 3 ? 'Escribe un poco más…' : waiting ? 'Buscando…' : 'No hay ninguna con ese nombre o código.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

// El buscador en una hoja (al escanear): elegir una talla la cierra
function SheetBody({ title, subtitle, onPick }) {
  const { close } = useSheet()
  return (
    <>
      <SheetHeader title={title} subtitle={subtitle} />
      <ProductSearch needCode autoFocus onPick={(o) => { close(); onPick(o) }} />
    </>
  )
}

export function ProductSearchSheet({ onClose, title = 'Buscar la prenda', subtitle, onPick }) {
  return (
    <Sheet modal onClose={onClose} label={title}>
      <SheetBody title={title} subtitle={subtitle} onPick={onPick} />
    </Sheet>
  )
}
