import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useLayout, useProducts } from '../hooks/useApi'
import WarehouseCanvas from '../components/WarehouseCanvas'
import LocationSheet from '../components/LocationSheet'
import OrbitDial from '../components/OrbitDial'
import EditPanel from '../components/EditPanel'
import ProductModal from '../components/ProductModal'
import Icon from '../components/Icon'
import { Count, ProductThumb, SearchField } from '../components/Bits'
import { locationGroups } from '../locationGroups'

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
  return { top, bottom: 156, left: 0, right: 0 }
}

export default function Warehouse() {
  const { isAdmin } = useAuth()
  const { data: layout, reload: reloadLayout } = useLayout()
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

  // en el 3D solo cuenta lo que esta en la bodega, no lo de paso (Despacho)
  const units = useMemo(() => (products || []).reduce((s, p) => s + (p.stock || []).reduce((t, r) => t + (r.location_id === 'DESPACHO' ? 0 : r.qty), 0), 0), [products])
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
    // una fila por cada lugar donde esta el codigo (puede estar en varios)
    const hits = []
    for (const p of products || []) {
      const places = p.stock?.length ? p.stock : [{ location_id: p.location_id, qty: 0 }]
      const text = norm(`${p.name} ${p.sku} ${p.size} ${places.map((s) => s.location_id).join(' ')}`)
      if (!text.includes(q)) continue
      for (const s of places) hits.push({ type: 'prod', p, loc: s.location_id, here: s.qty })
    }
    hits.sort((a, b) => (b.here > 0) - (a.here > 0) || a.p.name.localeCompare(b.p.name) || b.here - a.here)
    return [...out, ...hits.slice(0, 8)]
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
  useEffect(() => {
    const loc = params.get('loc')
    if (loc && layout) {
      locate(loc)
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, params])

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

  const currentElement = layout?.elements.find((e) => e.id === selEl) || null
  const showResults = searchOpen && query.trim().length > 0

  return (
    <section className="page full wh" aria-label="Bodega en 3D">
      <WarehouseCanvas
        layout={layout}
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
                r.type === 'prod' ? (
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
        </div>
      )}
      {showResults && <div className="menu-scrim" style={{ zIndex: 9 }} onClick={() => setSearchOpen(false)} />}

      {editMode && (
        <div className="wh-editbar">
          <span><i />Editando la distribución</span>
          <button className="btn btn-lime btn-sm" onClick={exitEdit}>Listo</button>
        </div>
      )}

      {!editMode && !selLoc && layout && <OrbitDial onNudge={(n) => sceneRef.current?.nudge(n)} />}

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
        />
      )}
    </section>
  )
}
