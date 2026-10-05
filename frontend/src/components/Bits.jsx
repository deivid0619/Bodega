import { useLayoutEffect, useRef } from 'react'
import Icon from './Icon'

// Numero que gira como contador al cambiar: sube si aumenta, baja si
// disminuye. Confirma el toque en + / − sin distraer (160 ms).
export function Count({ value, className }) {
  const ref = useRef(null)
  const prev = useRef(value)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || prev.current === value || typeof value !== 'number' || typeof prev.current !== 'number') {
      prev.current = value
      return
    }
    const up = value > prev.current
    prev.current = value
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [{ transform: `translateY(${up ? 38 : -38}%)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }],
      { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    )
  }, [value])
  return <span ref={ref} className={className} style={{ display: 'inline-block' }}>{value}</span>
}

export function ProductThumb({ src, alt = '', size }) {
  return (
    <div className={`thumb ${size || ''}`}>
      {src ? <img src={src} alt={alt} loading="lazy" /> : <Icon name="jacket" size={size === 'sm' ? 22 : 28} stroke={1.6} />}
    </div>
  )
}

export function Stepper({ value, onMinus, onPlus, minusLabel = 'Restar 1', plusLabel = 'Sumar 1', disabledMinus, large, children }) {
  return (
    <div className={`stepper ${large ? 'lg' : ''}`}>
      <button type="button" onClick={onMinus} aria-label={minusLabel} disabled={disabledMinus}>
        <Icon name="minus" size={large ? 20 : 17} stroke={2.4} />
      </button>
      {children || <output><Count value={value} /></output>}
      <button type="button" onClick={onPlus} aria-label={plusLabel}>
        <Icon name="plus" size={large ? 20 : 17} stroke={2.4} />
      </button>
    </div>
  )
}

export function SearchField({ value, onChange, placeholder, className = '', inputRef, ...rest }) {
  return (
    <div className={`search ${className}`}>
      <Icon name="search" size={19} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="search"
        {...rest}
      />
      {value && (
        <button type="button" className="clear" onClick={() => onChange('')} aria-label="Borrar búsqueda">
          <Icon name="x" size={17} stroke={2.2} />
        </button>
      )}
    </div>
  )
}

// Medidor tipo "barra de cambios": cuantas veces cabe el minimo en el stock.
export function StockMeter({ qty, min, segments = 8 }) {
  const target = Math.max(min * 2, 1)
  const on = qty <= 0 ? 0 : Math.max(1, Math.min(segments, Math.round((qty / target) * segments)))
  const state = qty <= 0 ? 'zero' : min > 0 && qty <= min ? 'low' : 'ok'
  return (
    <span className={`meter ${state}`} aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
    </span>
  )
}

export function PageHead({ title, lede, children }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="display">{title}</h1>
        {children}
      </div>
      {lede && <p className="lede">{lede}</p>}
    </header>
  )
}

export function Empty({ icon = 'warehouse', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} stroke={1.6} />
      {title && <b>{title}</b>}
      {children && <span>{children}</span>}
      {action}
    </div>
  )
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
