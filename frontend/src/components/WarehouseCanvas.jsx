import { useEffect, useRef } from 'react'
import { WarehouseScene } from '../three/WarehouseScene'

// Puente entre React y el motor 3D imperativo: crea la escena una sola vez
// y le empuja los datos nuevos cuando cambian, en vez de recrearla en cada
// render.
export default function WarehouseCanvas({ layout, products, editMode, onTapLocation, onTapElement, onElementMoved, sceneRef }) {
  const containerRef = useRef(null)
  const engineRef = useRef(null)
  const cbRef = useRef({})
  cbRef.current = { onTapLocation, onTapElement, onElementMoved }

  useEffect(() => {
    const engine = new WarehouseScene(containerRef.current, {
      onTapLocation: (id) => cbRef.current.onTapLocation?.(id),
      onTapElement: (id) => cbRef.current.onTapElement?.(id),
      onElementMoved: (id, x, z) => cbRef.current.onElementMoved?.(id, x, z),
    })
    engineRef.current = engine
    if (sceneRef) sceneRef.current = engine
    return () => engine.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (layout && engineRef.current) engineRef.current.setLayout(layout)
  }, [layout])

  useEffect(() => {
    if (products && engineRef.current) engineRef.current.setProducts(products)
  }, [products])

  useEffect(() => {
    engineRef.current?.setEditMode(editMode)
  }, [editMode])

  return <div className="scene-wrap" ref={containerRef} />
}
