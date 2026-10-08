import { useEffect, useMemo, useState } from 'react'
import { api } from '../../core/api'
import Icon from '../../ui/Icon'
import { SearchField, plural } from '../../ui/Bits'
import { norm, shopRef } from './refs'

// onScan: con el, al lado del buscador va "Escanear" (la etiqueta dice cual es)
export default function RefPicker({ refs, known, onPick, onCancel, onScan }) {
  const [q, setQ] = useState('')
  const [shop, setShop] = useState([])
  const term = q.trim().toUpperCase()
  // referencias de la tienda que aun no estan (todas) en la bodega
  useEffect(() => {
    if (term.length < 3) { setShop([]); return undefined }
    const t = setTimeout(() => {
      api.get(`/api/catalog/search?q=${encodeURIComponent(term)}&limit=6`)
        .then((list) => setShop(list.filter((g) => !g.sizes.every((s) => known.has(s.sku)))))
        .catch(() => setShop([]))
    }, 250)
    return () => clearTimeout(t)
  }, [term, known])
  const fromShop = (g) => shopRef(g, known)
  const results = useMemo(() => {
    if (term.length < 2) return []
    const code = norm(term)
    const words = term.split(/\s+/)
    const hits = refs.filter((r) => words.every((w) => r.name.includes(w)) || [...r.sizes.values()].some((s) => s.sku && s.sku.includes(code)))
    return hits.sort((a, b) => b.bodega + b.reserva - (a.bodega + a.reserva)).slice(0, 6)
  }, [term, refs])
  const exact = results.some((r) => r.name === term)
  return (
    <div className="rem-pick">
      <div className={`rem-pick-top${onScan ? ' with-scan' : ''}`}>
        <SearchField value={q} onChange={setQ} placeholder={onScan ? "Buscar" : "Referencia o código de una talla"} />
        {onScan && (
          <button type="button" className="btn btn-ink rem-pick-scan" onClick={onScan} aria-label="Escanear la etiqueta de la prenda">
            <Icon name="scan" size={18} />Escanear
          </button>
        )}
      </div>
      {(results.length > 0 || term.length >= 3) && (
        <div className="ref-results">
          {results.map((r) => (
            <button key={r.name} type="button" className="ref-result" onClick={() => onPick(r)}>
              <span className="ref-result-t">
                <b>{r.name}</b>
                <small>
                  {plural(r.sizes.size, 'talla', 'tallas')} · {r.bodega} en bodega{r.reserva ? ` · ${r.reserva} en reserva` : ''}
                </small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          ))}
          {shop.map((g) => (
            <button key={`tienda-${g.name}`} type="button" className="ref-result shop" onClick={() => onPick(fromShop(g))}>
              {g.image ? <img src={g.image} alt="" /> : null}
              <span className="ref-result-t">
                <b>{g.name}</b>
                <small>De la tienda · tallas {g.sizes.map((s) => s.size || 'única').join(', ')}</small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          ))}
          {term.length >= 3 && !exact && (
            <button type="button" className="ref-result new" onClick={() => onPick({ name: term.replace(/\s+/g, ' '), sizes: new Map(), isNew: true })}>
              <span className="ref-result-t">
                <b>Referencia nueva: {term.replace(/\s+/g, ' ')}</b>
                <small>Todavía no está en la bodega</small>
              </span>
              <Icon name="plus" size={18} stroke={2.2} />
            </button>
          )}
        </div>
      )}
      {onCancel && <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={onCancel}>Cancelar</button>}
    </div>
  )
}
