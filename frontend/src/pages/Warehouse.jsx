import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useLayout, useProducts } from '../hooks/useApi'
import WarehouseCanvas from '../components/WarehouseCanvas'
import LocationSheet from '../components/LocationSheet'
import EditPanel from '../components/EditPanel'
import ProductModal from '../components/ProductModal'
import Icon from '../components/Icon'
import { Count, ProductThumb, SearchField, plural } from '../components/Bits'
import { locationGroups } from '../locationGroups'
import { outletIdsOf, stockSplit } from '../utils'

const STORAGE = ['bins', 'shelf', 'rack', 'boxes', 'table']
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
const isWide = () => window.matchMedia('(min-width: 900px)').matches

// Pixeles que tapa la interfaz sobre el 3D (buscador arriba, dock y
// controles abajo, hojas abiertas), para encuadrar en el espacio libre.
function insetsFor({ sheet, editMode }) {
  const wide = isWide()
  const top = editMode ? 76 : wide ? 76 : 120
  if (wide) return { top, bottom: 150, left: 0, right: sheet || editMode ? 440 : 0 }
  if (sheet || editMode) return { top, bottom: Math.min(window.innerHeight * (editMode ? 0.46 : 0.52), 540), left: 0, right: 0 }
  return { top, bottom: 170, left: 0, right: 0 }
}

export default function Warehouse() {
  const { isAdmin } = useAuth()
  const { data: layout, reload: reloadLayout } = useLayout()
  // lo que se cambia en el editor se ve en el acto (borrador) mientras el
  // servidor lo guarda; despues manda lo que diga el servidor
  const [draft, setDraft] = useState({})
  const shown = useMemo(() => {
    if (!layout || !Object.keys(draft).length) return layout
    return {
      ...layout,
      elements: layout.elements.map((e) => {
        const d = draft[e.id]
        if (!d) return e
        const { _v, params, ...rest } = d
        return { ...e, ...rest, params: { ...e.params, ...params } }
      }),
    }
  }, [layout, draft])
  const { data: products, reload: reloadProducts } = useProducts()
  const [editMode, setEditMode] = useState(false)
  const [selLoc, setSelLoc] = useState(null)
  const [selEl, setSelEl] = useState(null)
  const [openSku, setOpenSku] = useState(null)
  const [highlightSku, setHighlightSku] = useState(null)
  const [view, setView] = useState('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const sceneRef = useRef(null)
  const sheetRef = useRef(null)
  const searchRef = useRef(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  // en el 3D solo cuenta lo que esta en la bodega: no lo de paso (Despacho) ni el outlet
  const outlet = useMemo(() => outletIdsOf(layout), [layout])
  const units = useMemo(() => (products || []).reduce((s, p) => s + stockSplit(p, null, outlet).bodega, 0), [products, outlet])
  const withStock = useMemo(() => (products || []).filter((p) => p.qty > 0).length, [products])
  const needCount = useMemo(() => (products || []).filter((p) => p.min_qty > 0 && p.qty <= p.min_qty).length, [products])
  const groupsLoc = useMemo(() => locationGroups(layout?.elements), [layout])
  const storageEls = useMemo(() => (layout?.elements || []).filter((e) => STORAGE.includes(e.type) && e.code), [layout])
  const locIndex = useMemo(() => {
    const m = new Map()
    for (const el of layout?.elements || []) for (const l of el.locations) m.set(l.id, { ...l, el })
    return m
  }, [layout])

  const results = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return []
    const out = []
    const loc = locIndex.get(q)
    if (loc) out.push({ type: 'loc', id: loc.id, label: loc.name })
    const el = storageEls.find((e) => norm(e.code) === q)
    if (el) out.push({ type: 'el', id: el.id, label: el.name })
    // una fila por cada lugar donde esta el codigo (puede estar en varios) y,
    // si esta en mas de uno, primero "todas las ubicaciones"
    const found = []
    for (const p of products || []) {
      const places = p.stock?.length ? p.stock : [{ location_id: p.location_id, qty: 0 }]
      const text = norm(`${p.name} ${p.sku} ${p.size} ${places.map((s) => s.location_id).join(' ')}`)
      if (!text.includes(q)) continue
      const rows = places.map((s) => ({ type: 'prod', p, loc: s.location_id, here: s.qty })).sort((a, b) => b.here - a.here)
      const stocked = rows.filter((r) => r.here > 0 && locIndex.has(r.loc))
      found.push({ p, rows, stocked: stocked.length, total: stocked.reduce((t, r) => t + r.here, 0) })
    }
    found.sort((a, b) => (b.stocked > 0) - (a.stocked > 0) || a.p.name.localeCompare(b.p.name) || a.p.size.localeCompare(b.p.size))
    const hits = []
    for (const f of found) {
      if (f.stocked >= 2) hits.push({ type: 'all', p: f.p, n: f.stocked, total: f.total })
      hits.push(...f.rows)
    }
    return [...out, ...hits.slice(0, 10)]
  }, [query, products, locIndex, storageEls])

  const prevEdit = useRef(editMode)
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    s.setViewInsets(insetsFor({ sheet: !!selLoc, editMode }))
    if (prevEdit.current !== editMode) {
      prevEdit.current = editMode
      s.applyPreset(editMode ? 'plan' : 'all')
    }
  }, [selLoc, editMode])

  const locate = (loc, sku = null) => {
    if (!locIndex.has(loc)) return
    setQuery('')
    setSearchOpen(false)
    searchRef.current?.blur()
    setHighlightSku(sku)
    setSelLoc(loc)
    setView(null)
    sceneRef.current?.setViewInsets(insetsFor({ sheet: true, editMode: false }))
    sceneRef.current?.selectLocation(loc)
    sceneRef.current?.focusLocation(loc)
    sceneRef.current?.pulse()
  }

  // enlace directo desde Inventario o el detalle de una prenda: /?loc=C-1-1
  // (una ubicacion) o /?sku=CODIGO (todas las ubicaciones de esa prenda)
  useEffect(() => {
    const loc = params.get('loc')
    const sku = params.get('sku')
    if (loc && layout) {
      locate(loc)
      setParams({}, { replace: true })
    } else if (sku && layout && products) {
      markProduct(sku)
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, params, products])

  // Todas las ubicaciones de una prenda marcadas en verde a la vez (no solo
  // una): "donde esta la XL", con cuantas hay en cada lugar
  const [marked, setMarked] = useState(null) // { sku, name, size, places: [{ id, qty }] }
  const markedOutlet = (marked?.places || []).reduce((t, x) => t + (outlet.has(x.id) ? x.qty : 0), 0)
  const placesOf = (p) => (p.stock || []).filter((s) => s.qty > 0 && locIndex.has(s.location_id)).map((s) => ({ id: s.location_id, qty: s.qty }))
  const markProduct = (sku) => {
    const p = (products || []).find((x) => x.sku === sku)
    if (!p) return
    const places = placesOf(p)
    setQuery('')
    setSearchOpen(false)
    searchRef.current?.blur()
    if (places.length < 2) {
      // en un solo lugar (o sin prendas): como siempre, esa ubicacion
      clearMarks()
      locate(places[0]?.id || p.location_id, p.sku)
      return
    }
    if (selLoc) sheetRef.current?.close()
    setMarked({ sku: p.sku, name: p.name, size: p.size, places })
    setView(null)
    sceneRef.current?.setViewInsets(insetsFor({ sheet: false, editMode: false }))
    sceneRef.current?.markLocations(places)
    sceneRef.current?.focusLocations(places.map((x) => x.id))
  }
  const clearMarks = () => {
    setMarked(null)
    sceneRef.current?.markLocations([])
  }
  // si cambia lo que hay (alguien saca o mete), las marcas se actualizan solas
  useEffect(() => {
    if (!marked) return
    const p = (products || []).find((x) => x.sku === marked.sku)
    const places = p ? placesOf(p) : []
    if (JSON.stringify(places) === JSON.stringify(marked.places)) return
    setMarked({ ...marked, places })
    sceneRef.current?.markLocations(places)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])

  const closeLocation = () => {
    setSelLoc(null)
    setHighlightSku(null)
    sceneRef.current?.selectLocation(null)
  }

  const tapLocation = (id) => {
    if (!id) {
      if (selLoc) sheetRef.current?.close()
      return
    }
    setHighlightSku(null)
    setSelLoc(id)
    sceneRef.current?.selectLocation(id)
  }

  const focusEl = (id) => {
    if (editMode) {
      setSelEl(id)
      sceneRef.current?.selectElement(id)
      return
    }
    if (selLoc) sheetRef.current?.close()
    setView(id)
    sceneRef.current?.setViewInsets(insetsFor({ sheet: false, editMode: false }))
    sceneRef.current?.focusElement(id)
  }

  const preset = (name) => {
    setView(name)
    sceneRef.current?.applyPreset(name)
  }

  const moveElement = async (id, x, z) => {
    try {
      await api.patch(`/api/layout/elements/${id}`, { x, z })
    } finally {
      reloadLayout()
    }
  }

  const enterEdit = () => {
    clearMarks()
    closeLocation()
    setView('plan')
    setEditMode(true)
  }
  const exitEdit = () => {
    setSelEl(null)
    setEditMode(false)
    setView('all')
  }
  const onEditChanged = (focusId) => {
    reloadLayout()
    reloadProducts()
    if (focusId !== undefined) {
      setSelEl(focusId)
      sceneRef.current?.selectElement(focusId)
    }
  }

  const currentElement = shown?.elements.find((e) => e.id === selEl) || null

  const draftElement = (id, fields, v) => setDraft((d) => {
    const cur = d[id] || {}
    return { ...d, [id]: { ...cur, ...fields, params: { ...(cur.params || {}), ...(fields.params || {}) }, _v: v } }
  })
  // el servidor ya lo guardo: se trae la distribucion y, si no se toco
  // nada mas desde entonces, se borra el borrador
  const settleElement = async (id, v) => {
    await reloadLayout()
    reloadProducts()
    setDraft((d) => {
      if (!d[id] || d[id]._v !== v) return d
      const { [id]: _, ...rest } = d
      return rest
    })
  }
  const showResults = searchOpen && query.trim().length > 0

  return (
    <section className="page full wh" aria-label="Bodega en 3D">
      <WarehouseCanvas
        layout={shown}
        products={products}
        editMode={editMode}
        onTapLocation={tapLocation}
        onTapElement={(id) => { setSelEl(id); sceneRef.current?.selectElement(id) }}
        onTapTag={focusEl}
        onElementMoved={moveElement}
        sceneRef={sceneRef}
      />

      {!editMode && (
        <div className="wh-top">
          <SearchField
            className="wh-search"
            inputRef={searchRef}
            value={query}
            onChange={(v) => { setQuery(v); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                const r = results[0]
                if (r.type === 'prod') locate(r.loc, r.p.sku)
                else if (r.type === 'all') markProduct(r.p.sku)
                else if (r.type === 'loc') locate(r.id)
                else { setQuery(''); focusEl(r.id) }
              }
              if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
            }}
            placeholder="¿Dónde está…? Busca una prenda"
            aria-label="Buscar en la bodega"
          />
          {showResults && (
            <div className="wh-results" role="listbox">
              {results.length ? results.map((r) => (
                r.type === 'all' ? (
                  <button key={`${r.p.sku}-all`} className="wh-result all" role="option" onClick={() => markProduct(r.p.sku)}>
                    <ProductThumb src={r.p.image_url} alt="" size="sm" />
                    <span className="wh-result-t">
                      <b>{r.p.name}{r.p.size ? ` · ${r.p.size}` : ''}</b>
                      <small><span className="code lime"><Icon name="pin" size={12} stroke={2.2} />Todas</span>Ver las {r.n} ubicaciones a la vez</small>
                    </span>
                    <span className="qty">{r.total}</span>
                  </button>
                ) : r.type === 'prod' ? (
                  <button key={`${r.p.sku}-${r.loc}`} className="wh-result" role="option" onClick={() => locate(r.loc, r.p.sku)}>
                    <ProductThumb src={r.p.image_url} alt="" size="sm" />
                    <span className="wh-result-t">
                      <b>{r.p.name}{r.p.size ? ` · ${r.p.size}` : ''}</b>
                      <small><span className="code dark"><Icon name="pin" size={12} stroke={2.2} />{r.loc}</span>{r.p.sku}</small>
                    </span>
                    <span className="qty">{r.here}</span>
                  </button>
                ) : (
                  <button key={`${r.type}-${r.id}`} className="wh-result" role="option" onClick={() => (r.type === 'loc' ? locate(r.id) : (setQuery(''), setSearchOpen(false), focusEl(r.id)))}>
                    <span className="thumb sm" style={{ background: 'var(--ink)', color: 'var(--lime)' }}><Icon name={r.type === 'loc' ? 'pin' : 'warehouse'} size={20} /></span>
                    <span className="wh-result-t"><b>{r.label}</b><small>{r.type === 'loc' ? 'Ubicación' : 'Mueble completo'}</small></span>
                  </button>
                )
              )) : <p className="wh-noresult">Nada con “{query.trim()}” en la bodega.</p>}
            </div>
          )}
          {!showResults && (
            <div className="wh-stats">
              <span className="pill dark"><b><Count value={units} /></b>prendas</span>
              <span className="pill"><b>{withStock}</b>{withStock === 1 ? 'código' : 'códigos'}</span>
              {needCount > 0 && (
                <button className="pill warn" onClick={() => navigate('/summary')}><i /><b>{needCount}</b>por reponer</button>
              )}
            </div>
          )}
          {!showResults && marked && (
            <div className="wh-mark" role="status">
              <span className="wh-mark-ico"><Icon name="pin" size={16} stroke={2.2} /></span>
              <span className="wh-mark-t">
                <b>{marked.name}{marked.size ? ` · ${marked.size}` : ''}</b>
                <small>
                  En {plural(marked.places.length, 'ubicación', 'ubicaciones')} · {plural(marked.places.reduce((t, x) => t + x.qty, 0), 'prenda', 'prendas')}
                  {markedOutlet > 0 && ` (${markedOutlet} en outlet)`} · toca una para ver qué hay
                </small>
              </span>
              <button type="button" className="wh-mark-x" onClick={clearMarks} aria-label="Quitar las marcas"><Icon name="x" size={18} stroke={2.2} /></button>
            </div>
          )}
        </div>
      )}
      {showResults && <div className="menu-scrim" style={{ zIndex: 9 }} onClick={() => setSearchOpen(false)} />}

      {editMode && (
        <div className="wh-editbar">
          <span><i />Editando la distribución</span>
          <button className="btn btn-lime btn-sm" onClick={exitEdit}>Listo</button>
        </div>
      )}

      {!editMode && !selLoc && (
        <div className="wh-bottom">
          <div className="wh-views" role="toolbar" aria-label="Vista">
            <button aria-pressed={view === 'all'} onClick={() => preset('all')}><Icon name="orbit" size={17} />General</button>
            <button aria-pressed={view === 'plan'} onClick={() => preset('plan')}><Icon name="plan" size={17} />Planta</button>
          </div>
          <div className="wh-els">
            {storageEls.map((e) => (
              <button key={e.id} className="el-btn" aria-pressed={view === e.id} onClick={() => focusEl(e.id)} aria-label={e.name}>{e.code}</button>
            ))}
          </div>
          {isAdmin && (
            <button className="wh-edit" onClick={enterEdit} aria-label="Editar distribución"><Icon name="pencil" size={20} /></button>
          )}
        </div>
      )}

      {!editMode && layout && products && units === 0 && !selLoc && (
        <div className="wh-empty">
          <h3>La bodega está vacía en el sistema</h3>
          <p>Escanea la etiqueta de cada prenda y la verás aparecer en su canasta o perchero.</p>
          <button className="btn btn-lime btn-block" onClick={() => navigate('/scan')}><Icon name="scan" size={20} />Escanear</button>
        </div>
      )}

      {!editMode && selLoc && layout && (
        <LocationSheet
          ref={sheetRef}
          locationId={selLoc}
          locationName={locIndex.get(selLoc)?.name || selLoc}
          products={products || []}
          highlightSku={highlightSku}
          locations={groupsLoc}
          outlet={!!locIndex.get(selLoc)?.outlet}
          canEditOutlet={isAdmin}
          onOutletChanged={reloadLayout}
          onClose={closeLocation}
          onScanHere={() => navigate(`/scan?loc=${encodeURIComponent(selLoc)}`)}
          onCount={() => navigate(`/count?loc=${encodeURIComponent(selLoc)}`)}
          onOpenProduct={setOpenSku}
        />
      )}

      {editMode && layout && isAdmin && (
        <EditPanel
          room={layout.room}
          element={currentElement}
          getTheta={() => sceneRef.current?.getTheta() || 0}
          onDone={() => { setSelEl(null); sceneRef.current?.selectElement(null) }}
          onChanged={onEditChanged}
          onDraft={draftElement}
          onSettled={settleElement}
          onExit={exitEdit}
        />
      )}

      {openSku && (
        <ProductModal
          sku={openSku}
          locations={groupsLoc}
          onClose={() => setOpenSku(null)}
          onChanged={reloadProducts}
          onLocate={(loc) => { setOpenSku(null); locate(loc) }}
          onShowAll={(p) => { setOpenSku(null); markProduct(p.sku) }}
        />
      )}
    </section>
  )
}
