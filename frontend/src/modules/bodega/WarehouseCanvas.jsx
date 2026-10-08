import { useEffect, useRef, useState } from 'react'
import { WarehouseScene } from './WarehouseScene'

// Puente entre React y el motor 3D imperativo: crea la escena una sola vez
// y le empuja los datos nuevos cuando cambian, en vez de recrearla en cada
// render.
export default function WarehouseCanvas({ layout, products, supply, editMode, onTapLocation, onTapElement, onTapTag, onElementMoved, sceneRef }) {
  const containerRef = useRef(null)
  const engineRef = useRef(null)
  const cbRef = useRef({})
  const [failed, setFailed] = useState(false)
  cbRef.current = { onTapLocation, onTapElement, onTapTag, onElementMoved }

  useEffect(() => {
    let engine
    try {
      engine = new WarehouseScene(containerRef.current, {
        onTapLocation: (id) => cbRef.current.onTapLocation?.(id),
        onTapElement: (id) => cbRef.current.onTapElement?.(id),
        onTapTag: (id) => cbRef.current.onTapTag?.(id),
        onElementMoved: (id, x, z) => cbRef.current.onElementMoved?.(id, x, z),
      })
    } catch {
      setFailed(true)
      return undefined
    }
    engineRef.current = engine
    if (sceneRef) sceneRef.current = engine
    if (import.meta.env.DEV) window.__bodega3d = engine
    return () => {
      engine.dispose()
      if (sceneRef) sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (layout && engineRef.current) engineRef.current.setLayout(layout)
  }, [layout])

  useEffect(() => {
    if (products && engineRef.current) engineRef.current.setProducts(products)
  }, [products])

  // lo que se puede traer de la reserva, en lima
  useEffect(() => {
    engineRef.current?.setSupply(supply)
  }, [supply])

  useEffect(() => {
    engineRef.current?.setEditMode(editMode)
  }, [editMode])

  if (failed) {
    return (
      <div className="wh-empty" style={{ top: '40%' }}>
        <h3>Este dispositivo no muestra el 3D</h3>
        <p>El navegador no tiene WebGL activo. El inventario, el escaneo y la reserva funcionan igual desde el menú de abajo.</p>
      </div>
    )
  }
  return <div className="scene-wrap" ref={containerRef} />
}
