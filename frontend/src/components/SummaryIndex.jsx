import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon'

// Los apartados del Resumen, en el orden en que aparecen (cada uno es el id
// de su titulo)
const SECTIONS = [
  ['reponer', 'Por reponer'],
  ['despacho', 'Por despachar'],
  ['documentos', 'Remisiones y facturas'],
  ['mas-sale', 'Lo que más sale'],
  ['movimientos', 'Movimientos'],
  ['datos', 'Datos y respaldo'],
]

// Indice del Resumen: un toque lleva a cada apartado y se marca en cual se
// va. En el celular va arriba y se queda a la vista al bajar; en pantallas
// anchas, a la izquierda.
export default function SummaryIndex({ onJump }) {
  const navigate = useNavigate()
  const [active, setActive] = useState(null)
  const [stuck, setStuck] = useState(false)
  const bar = useRef(null)
  const sentinel = useRef(null)
  const quietUntil = useRef(0) // mientras baja solo tras un toque, no se cambia la marca

  useEffect(() => {
    const root = bar.current?.closest('.page') || null
    const spy = new IntersectionObserver((entries) => {
      if (Date.now() < quietUntil.current) return
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setActive(hit.target.id)
    }, { root, rootMargin: '-80px 0px -50% 0px' })
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id)
      if (el) spy.observe(el)
    })
    // arriba del todo (los numeros) no se marca ningun apartado
    const top = new IntersectionObserver(([e]) => {
      setStuck(!e.isIntersecting)
      if (e.isIntersecting) setActive(null)
    }, { root })
    if (sentinel.current) top.observe(sentinel.current)
    return () => {
      spy.disconnect()
      top.disconnect()
    }
  }, [])

  // en el celular la barra se corre de lado para que se vea el apartado
  // marcado (y vuelve al principio arriba del todo)
  useEffect(() => {
    const b = bar.current
    if (!b || b.scrollWidth <= b.clientWidth) return
    const chip = b.querySelector('[aria-current]')
    if (!chip) {
      if (b.scrollLeft) b.scrollTo({ left: 0, behavior: 'smooth' })
      return
    }
    if (chip.offsetLeft < b.scrollLeft || chip.offsetLeft + chip.offsetWidth > b.scrollLeft + b.clientWidth) {
      b.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' })
    }
  }, [active])

  const jump = (id) => {
    quietUntil.current = Date.now() + 900
    setActive(id)
    onJump?.(id)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <>
      <div ref={sentinel} className="sum-sentinel" aria-hidden="true" />
      <nav ref={bar} className={`sum-nav${stuck ? ' stuck' : ''}`} aria-label="Apartados del Resumen">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" className="chip" aria-current={active === id ? 'location' : undefined} onClick={() => jump(id)}>
            {label}
          </button>
        ))}
        <button type="button" className="chip go" onClick={() => navigate('/reports')}>
          Reportes<Icon name="arrowRight" size={14} stroke={2.4} />
        </button>
      </nav>
    </>
  )
}
