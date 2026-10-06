import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLayout, useProducts, useReserve } from '../hooks/useApi'
import { locationGroups } from '../locationGroups'
import { refCode, refKey, reserveFor, reserveIndex, stockSplit } from '../utils'
import ProductModal from '../components/ProductModal'
import Icon from '../components/Icon'
import { Count, Empty, PageHead, ProductThumb, SearchField, plural } from '../components/Bits'

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL']
const sizeIdx = (s) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? 99 : i }
const isLow = (p, qty = p.qty) => p.min_qty > 0 && qty <= p.min_qty
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

// Una tarjeta por referencia: cada talla con lo que hay en la bodega (sin lo
// de paso) y lo que hay guardado en la reserva; el total suma las dos.
function groupProducts(list, index, reserveOnly) {
  const map = new Map()
  for (const p of [...list].sort((a, b) => a.name.localeCompare(b.name) || sizeIdx(a.size) - sizeIdx(b.size))) {
    const key = refKey(p.name)
    if (!map.has(key)) map.set(key, { base: key, name: p.name, image: null, items: [], bodega: 0, reserve: 0, passing: 0, locs: new Map() })
    const g = map.get(key)
    const split = stockSplit(p, index)
    g.items.push({ key: p.sku, size: p.size, p, ...split })
    g.bodega += split.bodega
    g.reserve += split.reserve
    g.passing += split.passing
    if (!g.image && p.image_url) g.image = p.image_url
    for (const st of p.stock || []) g.locs.set(st.location_id, (g.locs.get(st.location_id) || 0) + st.qty)
  }
  const groups = [...map.values()]
  for (const g of groups) g.code = refCode(g.items.map((x) => x.p.sku))
  // lo que solo esta en la reserva (ningun codigo de la bodega lo tiene) se
  // suma a la tarjeta de su referencia, o tiene una propia
  const byName = new Map(groups.map((g) => [norm(g.name), g]))
  for (const it of reserveOnly) {
    let g = byName.get(norm(it.name))
    if (!g) {
      g = { base: `reserva-${it.id}`, name: it.name, image: null, items: [], bodega: 0, reserve: 0, passing: 0, locs: new Map(), onlyReserve: true }
      byName.set(norm(it.name), g)
      groups.push(g)
    }
    g.items.push({ key: `r-${it.id}`, size: it.size, item: it, bodega: 0, reserve: it.qty, passing: 0 })
    g.reserve += it.qty
  }
  for (const g of groups) g.items.sort((a, b) => sizeIdx(a.size) - sizeIdx(b.size))
  return groups.sort((a, b) => a.name.localeCompare(b.name))
}

const FILTERS = [['all', 'Todo'], ['low', 'Bajo mínimo'], ['zero', 'Agotado'], ['orphan', 'Sin ubicación']]

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const { data: products, reload } = useProducts(search, filter)
  const { data: all } = useProducts()
  const { data: reserve } = useReserve()
  const { data: layout } = useLayout()
  const [openSku, setOpenSku] = useState(null)
  const navigate = useNavigate()

  const index = useMemo(() => reserveIndex(reserve), [reserve])
  // lo de la reserva que no es de ningun codigo de la bodega
  const reserveOnly = useMemo(() => {
    if (!all || !reserve || filter !== 'all') return []
    const used = new Set()
    for (const p of all) for (const it of reserveFor(p, index)) used.add(it.id)
    const q = norm(search)
    return reserve.filter((it) => it.qty > 0 && !used.has(it.id) && (!q || norm(`${it.name} ${it.sku || ''} ${it.size}`).includes(q)))
  }, [all, reserve, index, filter, search])
  const groups = useMemo(() => groupProducts(products || [], index, reserveOnly), [products, index, reserveOnly])
  const groupsLoc = useMemo(() => locationGroups(layout?.elements), [layout])
  const totals = useMemo(() => {
    const list = all || []
    return {
      units: list.reduce((s, p) => s + stockSplit(p).bodega, 0),
      reserve: (reserve || []).reduce((s, i) => s + i.qty, 0),
      refs: new Set(list.map((p) => refKey(p.name))).size,
      low: list.filter((p) => isLow(p)).length,
      zero: list.filter((p) => p.qty === 0).length,
    }
  }, [all, reserve])

  return (
    <section className="page" aria-label="Inventario">
      <div className="page-inner">
        <PageHead
          title="Inventario"
          lede={!all ? 'Cargando…' : totals.reserve > 0
            ? `${plural(totals.units + totals.reserve, 'prenda', 'prendas')} en total: ${totals.units} en la bodega y ${totals.reserve} en la reserva`
            : `${plural(totals.units, 'prenda', 'prendas')} en ${plural(totals.refs, 'referencia', 'referencias')}`}
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
            groups.map((g) => (
              <article className="card ref" key={g.base}>
                <ProductThumb src={g.image} alt={g.name} />
                <div style={{ minWidth: 0 }}>
                  <h3 className="ref-name">{g.name}</h3>
                  <div className="ref-code">{g.onlyReserve ? <span className="tag tag-warn">Solo en la reserva</span> : <span className="code">{g.code}</span>}</div>
                </div>
                <div className="ref-total">
                  <b><Count value={g.bodega + g.reserve} /></b>
                  <span>{g.reserve > 0 ? 'en total' : g.bodega === 1 ? 'prenda' : 'prendas'}</span>
                </div>
                {(g.reserve > 0 || g.passing > 0) && (
                  <p className="ref-split">
                    <span><b>{g.bodega}</b> en la bodega</span>
                    {g.reserve > 0 && (
                      <button type="button" className="res" onClick={() => navigate('/reserve')}><b>+{g.reserve}</b> en la reserva</button>
                    )}
                    {g.passing > 0 && <span><b>{g.passing}</b> de paso</span>}
                  </p>
                )}
                <div className="ref-sizes">
                  {g.items.map((x) => (x.p ? (
                    <button
                      key={x.key}
                      className={`size ${x.bodega <= 0 ? 'zero' : isLow(x.p, x.bodega) ? 'low' : ''}`}
                      onClick={() => setOpenSku(x.p.sku)}
                      aria-label={`Talla ${x.size || 'única'}: ${x.bodega} en la bodega${x.reserve ? ` y ${x.reserve} en la reserva` : ''}`}
                    >
                      {x.size || 'Única'} <b>{x.bodega}</b>{x.reserve > 0 && <i className="size-res">+{x.reserve}</i>}
                    </button>
                  ) : (
                    <button key={x.key} className="size zero" onClick={() => navigate('/reserve')} aria-label={`Talla ${x.size || 'única'}: ${x.reserve} en la reserva`}>
                      {x.size || 'Única'} <b>0</b><i className="size-res">+{x.reserve}</i>
                    </button>
                  )))}
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
