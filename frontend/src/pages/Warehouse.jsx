import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useLayout, useProducts } from '../hooks/useApi'
import WarehouseCanvas from '../components/WarehouseCanvas'
import LocationSheet from '../components/LocationSheet'
import EditPanel from '../components/EditPanel'
import ProductModal from '../components/ProductModal'
import { locationGroups } from '../locationGroups'

export default function Warehouse() {
  const { isAdmin } = useAuth()
  const { data: layout, reload: reloadLayout } = useLayout()
  const { data: products, reload: reloadProducts } = useProducts()
  const [editMode, setEditMode] = useState(false)
  const [selLoc, setSelLoc] = useState(null)
  const [selEl, setSelEl] = useState(null)
  const [openSku, setOpenSku] = useState(null)
  const sceneRef = useRef(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const units = useMemo(() => (products || []).reduce((s, p) => s + p.qty, 0), [products])
  const withStock = useMemo(() => (products || []).filter((p) => p.qty > 0).length, [products])
  const needCount = useMemo(() => (products || []).filter((p) => p.min_qty > 0 && p.qty <= p.min_qty).length, [products])
  const groupsLoc = useMemo(() => locationGroups(layout?.elements), [layout])
  const storageEls = useMemo(() => (layout?.elements || []).filter((e) => ['bins', 'shelf', 'rack', 'boxes'].includes(e.type)), [layout])

  // deep link desde Inventario: /?loc=C-1-1
  useEffect(() => {
    const loc = params.get('loc')
    if (loc && layout) {
      setSelLoc(loc)
      sceneRef.current?.focusLocation(loc)
      sceneRef.current?.selectLocation(loc)
      sceneRef.current?.pulse()
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  const locationName = (id) => {
    for (const el of layout?.elements || []) {
      const l = el.locations.find((x) => x.id === id)
      if (l) return l.name
    }
    return `${id} (ya no existe)`
  }

  const tapLocation = (id) => {
    setSelLoc(id)
    sceneRef.current?.selectLocation(id)
  }

  const tapElement = (id) => {
    setSelEl(id)
  }

  const moveElement = async (id, x, z) => {
    try {
      await api.patch(`/api/layout/elements/${id}`, { x, z })
      reloadLayout()
    } catch {
      reloadLayout() // el backend rechazó el arrastre (por ejemplo, choque de ubicaciones); recarga la posición real
    }
  }

  const enterEdit = () => { setSelLoc(null); sceneRef.current?.selectLocation(null); setEditMode(true) }
  const exitEdit = () => { setSelEl(null); setEditMode(false) }

  const onEditChanged = (focusId) => {
    reloadLayout()
    reloadProducts()
    if (focusId !== undefined) setSelEl(focusId)
  }

  const currentElement = layout?.elements.find((e) => e.id === selEl) || null

  return (
    <section className="view canvas-view" aria-label="Modelo 3D de la bodega">
      <WarehouseCanvas
        layout={layout}
        products={products}
        editMode={editMode}
        onTapLocation={tapLocation}
        onTapElement={tapElement}
        onElementMoved={moveElement}
        sceneRef={sceneRef}
      />

      {!editMode && (
        <div className="hud">
          <div className="stat"><b>{units}</b><span>prendas</span></div>
          <div className="stat"><b>{withStock}</b><span>códigos con stock</span></div>
          <button className={`stat alert ${needCount ? 'has' : ''}`} onClick={() => navigate('/orders')}>
            <b>{needCount}</b><span>por pedir</span>
          </button>
        </div>
      )}
      {!editMode && (
        <div className="legend">
          <span><i className="lg-ok" />Con stock</span>
          <span><i className="lg-low" />Bajo mínimo</span>
          <span><i className="lg-empty" />Vacía</span>
        </div>
      )}
      {editMode && (
        <div className="editbar">
          <span>Editando la distribución</span>
          <button onClick={exitEdit}>Listo</button>
        </div>
      )}

      {!editMode && units === 0 && !selLoc && (
        <div className="emptycard">
          <h3>La bodega está vacía en el sistema</h3>
          <p>Escanea la etiqueta de cada prenda y la verás aparecer en su canasta, estantería o perchero.</p>
          <div className="actions">
            <button className="btn primary" onClick={() => navigate('/scan')}>Escanear</button>
          </div>
        </div>
      )}

      {!editMode && (
        <div className="presets">
          {isAdmin && <button className="edit" onClick={enterEdit}>Editar bodega</button>}
          <button onClick={() => sceneRef.current?.applyPreset('all')}>Vista general</button>
          <button onClick={() => sceneRef.current?.applyPreset('plan')}>Planta</button>
          {storageEls.map((e) => (
            <button key={e.id} onClick={() => { setSelLoc(null); sceneRef.current?.selectLocation(null); sceneRef.current?.focusElement(e.id) }}>
              {e.name}
            </button>
          ))}
        </div>
      )}

      {!editMode && selLoc && layout && (
        <LocationSheet
          locationId={selLoc}
          locationName={locationName(selLoc)}
          products={products || []}
          onClose={() => { setSelLoc(null); sceneRef.current?.selectLocation(null) }}
          onChanged={reloadProducts}
          onScanHere={() => navigate('/scan')}
          onOpenProduct={setOpenSku}
        />
      )}

      {editMode && layout && isAdmin && (
        <EditPanel
          room={layout.room}
          element={currentElement}
          getTheta={() => sceneRef.current?.cur?.th || 0}
          onDone={() => setSelEl(null)}
          onChanged={onEditChanged}
        />
      )}

      {openSku && (
        <ProductModal
          sku={openSku}
          locations={groupsLoc}
          onClose={() => setOpenSku(null)}
          onChanged={reloadProducts}
          onLocate={(loc) => { setOpenSku(null); tapLocation(loc); sceneRef.current?.focusLocation(loc) }}
        />
      )}
    </section>
  )
}
