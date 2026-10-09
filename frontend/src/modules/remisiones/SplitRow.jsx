import Icon from '../../ui/Icon'
import { Stepper } from '../../ui/Bits'
import LocationPicker from '../../ui/LocationPicker'
import { RESERVA, blockId, partsTotal } from './refs'
import './remisiones.css' // tambien se usa al escanear

// Repartir una talla que llego en varias ubicaciones (o una parte a la
// reserva): cuantas van a cada una. Lo que no se reparte entra a la ubicacion
// de la referencia (la de arriba). Ej.: 45 rinoneras, 15 a cada canasta.
// allowReserve: ofrecer "Una parte a la reserva" (en la remision si; al escanear una entrada, no)
// hint: lo que va debajo del titulo (en la remision, donde ya hay de esa talla)
export default function SplitRow({ row, size, mainLabel, groups, onChange, allowReserve = true, hint }) {
  const parts = row.parts || []
  const given = partsTotal(parts)
  const rest = row.qty - given
  const set = (key, patch) => onChange(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const add = (loc) => onChange([...parts, { key: blockId(), loc, qty: 0 }])
  const drop = (key) => onChange(parts.filter((p) => p.key !== key))
  const label = `talla ${size || 'única'}`
  const hasReserve = parts.some((p) => p.loc === RESERVA)

  return (
    <div className="rem-split-size">
      <div className="rem-split-head">
        <b>Talla {size || 'única'} · llegaron {row.qty}</b>
        <small className={rest < 0 ? 'over' : ''}>
          {rest < 0 ? `Repartiste ${-rest} de más` : rest === 0 ? 'Todas repartidas' : `Quedan ${rest} → ${mainLabel}`}
        </small>
      </div>
      {hint}
      {parts.map((p, i) => {
        const max = p.qty + Math.max(0, rest) // lo suyo y lo que queda sin repartir
        const put = (n) => set(p.key, { qty: Math.max(0, Math.min(max, Math.floor(n) || 0)) })
        return (
          <div className="rem-part" key={p.key}>
            {p.loc === RESERVA ? (
              <span className="input rem-part-res"><Icon name="reserve" size={16} stroke={2.1} />Reserva</span>
            ) : (
              <LocationPicker value={p.loc} onChange={(v) => set(p.key, { loc: v })} groups={groups}
                              placeholder="Elige la ubicación" ariaLabel={`Ubicación ${i + 1}, ${label}`} />
            )}
            <Stepper small onMinus={() => put(p.qty - 1)} onPlus={() => put(p.qty + 1)}
                     disabledMinus={p.qty <= 0} disabledPlus={rest <= 0}
                     minusLabel={`Una menos aquí, ${label}`} plusLabel={`Una más aquí, ${label}`}>
              <input type="number" inputMode="numeric" value={p.qty || ''} placeholder="0"
                     aria-label={`Cuántas van aquí, ${label}`} onChange={(e) => put(e.target.value)} />
            </Stepper>
            <button type="button" className="rem-part-x" onClick={() => drop(p.key)} aria-label={`Quitar esta parte, ${label}`}>
              <Icon name="x" size={16} stroke={2.4} />
            </button>
          </div>
        )
      })}
      <div className="rem-part-add">
        <button type="button" className="link-btn" onClick={() => add('')} disabled={rest <= 0 && parts.length > 0}>
          <Icon name="plus" size={14} stroke={2.4} />Otra ubicación
        </button>
        {allowReserve && !hasReserve && (
          <button type="button" className="link-btn" onClick={() => add(RESERVA)} disabled={rest <= 0 && parts.length > 0}>
            <Icon name="plus" size={14} stroke={2.4} />Una parte a la reserva
          </button>
        )}
      </div>
    </div>
  )
}
