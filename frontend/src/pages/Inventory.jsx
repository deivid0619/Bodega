import { useMemo, useState } from 'react'
import { useLayout, useProducts } from '../hooks/useApi'
import { locationGroups } from '../locationGroups'
import BarcodeBars from '../components/BarcodeBars'
import ProductModal from '../components/ProductModal'
import { useNavigate } from 'react-router-dom'

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL']
const sizeIdx = (s) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? 99 : i }
const baseOf = (p) => (p.size && p.sku.endsWith(p.size) ? p.sku.slice(0, -p.size.length) : p.sku)

function groupProducts(list) {
  const map = new Map()
  for (const p of [...list].sort((a, b) => baseOf(a).localeCompare(baseOf(b)) || sizeIdx(a.size) - sizeIdx(b.size))) {
    const base = baseOf(p)
    if (!map.has(base)) map.set(base, { base, name: p.name, items: [], total: 0, locs: new Set() })
    const g = map.get(base)
    g.items.push(p)
    g.total += p.qty
    g.locs.add(p.location_name)
  }
  return [...map.values()]
}

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { data: products, reload } = useProducts(search, filter)
  const { data: layout } = useLayout()
  const [openSku, setOpenSku] = useState(null)
  const navigate = useNavigate()

  const groups = useMemo(() => groupProducts(products || []), [products])
  const groupsLoc = useMemo(() => locationGroups(layout?.elements), [layout])

  const isLow = (p) => p.min_qty > 0 && p.qty <= p.min_qty

  return (
    <section className="view" aria-label="Inventario">
      <h2>Inventario</h2>
      <input className="search" type="search" placeholder="Buscar por código, nombre, talla o ubicación"
             value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="chips">
        {[['all', 'Todo'], ['low', 'Bajo mínimo'], ['zero', 'Agotado'], ['orphan', 'Sin ubicación']].map(([f, label]) => (
          <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>
      {!products ? (
        <p className="muted">Cargando…</p>
      ) : groups.length ? (
        groups.map((g) => (
          <article className="label" key={g.base}>
            <BarcodeBars code={g.base} />
            <div className="sku">{g.base}</div>
            <div className="total"><b>{g.total}</b><span>{g.total === 1 ? 'prenda' : 'prendas'}</span></div>
            <h3 className="name">{g.name}</h3>
            <div className="sizes">
              {g.items.map((p) => (
                <button key={p.sku} className={`size ${p.qty === 0 ? 'zero' : isLow(p) ? 'low' : ''}`} onClick={() => setOpenSku(p.sku)}>
                  {p.size || 'Única'} <b>{p.qty}</b>
                </button>
              ))}
            </div>
            <div className="where">
              {[...g.locs].map((l) => <span key={l}>{l}</span>)}
            </div>
          </article>
        ))
      ) : products.length === 0 && !search && filter === 'all' ? (
        <div className="empty">
          El inventario está vacío. Escanea una etiqueta para registrar la primera prenda.
          <br /><button className="btn primary" onClick={() => navigate('/scan')}>Escanear</button>
        </div>
      ) : (
        <div className="empty">Nada coincide con la búsqueda o el filtro.</div>
      )}
      {openSku && (
        <ProductModal
          sku={openSku}
          locations={groupsLoc}
          onClose={() => setOpenSku(null)}
          onChanged={reload}
          onLocate={(loc) => navigate(`/?loc=${encodeURIComponent(loc)}`)}
        />
      )}
    </section>
  )
}
