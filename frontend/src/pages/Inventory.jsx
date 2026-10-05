import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLayout, useProducts } from '../hooks/useApi'
import { locationGroups } from '../locationGroups'
import ProductModal from '../components/ProductModal'
import Icon from '../components/Icon'
import { Count, Empty, PageHead, ProductThumb, SearchField, plural } from '../components/Bits'

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL']
const sizeIdx = (s) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? 99 : i }
const baseOf = (p) => (p.size && p.sku.endsWith(p.size) ? p.sku.slice(0, -p.size.length) : p.sku)
const isLow = (p) => p.min_qty > 0 && p.qty <= p.min_qty

function groupProducts(list) {
  const map = new Map()
  for (const p of [...list].sort((a, b) => a.name.localeCompare(b.name) || baseOf(a).localeCompare(baseOf(b)) || sizeIdx(a.size) - sizeIdx(b.size))) {
    const base = baseOf(p)
    if (!map.has(base)) map.set(base, { base, name: p.name, image: null, items: [], total: 0, locs: new Map() })
    const g = map.get(base)
    g.items.push(p)
    g.total += p.qty
    if (!g.image && p.image_url) g.image = p.image_url
    for (const st of p.stock || []) g.locs.set(st.location_id, (g.locs.get(st.location_id) || 0) + st.qty)
  }
  return [...map.values()]
}

const FILTERS = [['all', 'Todo'], ['low', 'Bajo mínimo'], ['zero', 'Agotado'], ['orphan', 'Sin ubicación']]

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { data: products, reload } = useProducts(search, filter)
  const { data: all } = useProducts()
  const { data: layout } = useLayout()
  const [openSku, setOpenSku] = useState(null)
  const navigate = useNavigate()

  const groups = useMemo(() => groupProducts(products || []), [products])
  const groupsLoc = useMemo(() => locationGroups(layout?.elements), [layout])
  const totals = useMemo(() => {
    const list = all || []
    return {
      units: list.reduce((s, p) => s + p.qty, 0),
      refs: new Set(list.map(baseOf)).size,
      low: list.filter(isLow).length,
      zero: list.filter((p) => p.qty === 0).length,
    }
  }, [all])

  return (
    <section className="page" aria-label="Inventario">
      <div className="page-inner">
        <PageHead
          title="Inventario"
          lede={all ? `${plural(totals.units, 'prenda', 'prendas')} en ${plural(totals.refs, 'referencia', 'referencias')}` : 'Cargando…'}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Buscar nombre, código o talla" />
        <div className="chips" role="toolbar" aria-label="Filtrar">
          {FILTERS.map(([f, label]) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label}
              {f === 'low' && totals.low > 0 && <span className="n">{totals.low}</span>}
              {f === 'zero' && totals.zero > 0 && <span className="n">{totals.zero}</span>}
            </button>
          ))}
        </div>

        <div className="list" style={{ marginTop: 10 }}>
          {!products ? (
            [0, 1, 2].map((i) => <div key={i} className="skeleton" />)
          ) : groups.length ? (
            groups.map((g, i) => (
              <article className="card ref" key={g.base}>
                <ProductThumb src={g.image} alt={g.name} />
                <div style={{ minWidth: 0 }}>
                  <h3 className="ref-name">{g.name}</h3>
                  <div className="ref-code"><span className="code">{g.base}</span></div>
                </div>
                <div className="ref-total">
                  <b><Count value={g.total} /></b>
                  <span>{g.total === 1 ? 'prenda' : 'prendas'}</span>
                </div>
                <div className="ref-sizes">
                  {g.items.map((p) => (
                    <button
                      key={p.sku}
                      className={`size ${p.qty === 0 ? 'zero' : isLow(p) ? 'low' : ''}`}
                      onClick={() => setOpenSku(p.sku)}
                      aria-label={`Talla ${p.size || 'única'}: ${p.qty}`}
                    >
                      {p.size || 'Única'} <b>{p.qty}</b>
                    </button>
                  ))}
                </div>
                {g.locs.size > 0 && (
                  <div className="ref-locs">
                    {[...g.locs].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                      <button key={id} className="code dark" onClick={() => navigate(`/?loc=${encodeURIComponent(id)}`)} aria-label={`Ver ${id} en 3D, ${n} prendas`}>
                        <Icon name="pin" size={13} stroke={2.2} />{id}<span className="code-n">{n}</span>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))
          ) : products.length === 0 && !search && filter === 'all' ? (
            <Empty icon="scan" title="Todavía no hay prendas" action={<button className="btn btn-lime" onClick={() => navigate('/scan')}>Escanear la primera</button>}>
              Escanea la etiqueta de una prenda para registrarla en su ubicación.
            </Empty>
          ) : (
            <Empty icon="search" title="Nada coincide">Prueba con otra palabra o quita el filtro.</Empty>
          )}
        </div>
      </div>

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
