import { Stepper } from './Bits'
import { asksFrom, isSplit, splitTotal } from '../core/utils'

// "¿De donde sale?": en una salida de una prenda que esta en varios lugares
// (o en el outlet), se elige de cual salio para que cada canasta quede bien.
// value: undefined (sin elegir), '' (donde sea), el id de una ubicacion (sale
// de ahi primero; si no alcanza, el resto de donde haya) o repartido:
// { 'C-1-1': 2, 'P-A2': 1 } (cuantas de cada una).
// Si esta en un solo lugar no hay nada que elegir, pero se dice de donde sale.
export default function FromPick({ places, value, qty, onChange, disabled }) {
  if (!asksFrom(places)) {
    const only = places[0]
    return (
      <div className="from-pick from-one" role="note" aria-label="De dónde sale">
        <span>Sale de</span>
        {only ? <b>{only.name}<i className="mono">{only.id}</i><small>hay {only.qty}</small></b> : <b>ninguna ubicación: no hay</b>}
      </div>
    )
  }
  const split = isSplit(value)
  const chosen = !split && places.find((x) => x.id === value)
  const rest = chosen ? qty - chosen.qty : 0
  const total = split ? splitTotal(value) : 0
  const canSplit = qty > 1 && places.length > 1
  const set = (id, n) => onChange({ ...value, [id]: n })
  return (
    <div className="from-pick" role="group" aria-label="De dónde sale">
      <span className={value === undefined || (split && total !== qty) ? 'ask' : ''}>
        {value === undefined ? '¿De dónde sale?' : split ? 'Cuántas de cada lugar' : 'Sale de'}
      </span>
      {!split && places.map((x) => (
        <button key={x.id} type="button" className={x.outlet ? 'outlet' : ''} aria-pressed={value === x.id} disabled={disabled}
                title={x.name} aria-label={`${x.name}, hay ${x.qty}${x.outlet ? ', outlet' : ''}`} onClick={() => onChange(x.id)}>
          {x.id}<b>{x.qty}</b>{x.outlet && <em>outlet</em>}
        </button>
      ))}
      {!split && <button type="button" className="any" aria-pressed={value === ''} disabled={disabled} onClick={() => onChange('')}>Donde sea</button>}
      {canSplit && (
        <button type="button" className="any" aria-pressed={split} disabled={disabled} onClick={() => onChange(split ? undefined : {})}>
          {split ? 'De un solo lugar' : 'Repartir'}
        </button>
      )}
      {chosen && rest <= 0 && <small>{chosen.name}</small>}
      {chosen && rest > 0 && (
        <small>De {chosen.name} salen {chosen.qty}; {rest === 1 ? 'la otra' : `las otras ${rest}`}, de donde haya.</small>
      )}
      {split && (
        <div className="from-split">
          {places.map((x) => {
            const n = value[x.id] || 0
            return (
              <div className="from-split-row" key={x.id}>
                <span className="mono">{x.id}<small>hay {x.qty}{x.outlet ? ' · outlet' : ''}</small></span>
                <Stepper small value={n} onMinus={() => set(x.id, Math.max(0, n - 1))} onPlus={() => set(x.id, n + 1)}
                         disabledMinus={disabled || n === 0} disabledPlus={disabled || n >= x.qty || total >= qty}
                         minusLabel={`Una menos de ${x.id}`} plusLabel={`Una más de ${x.id}`} />
              </div>
            )
          })}
          <small className={total === qty ? 'ok' : 'ask'}>
            {total === qty ? `Listo: las ${qty} repartidas` : total > qty ? `Sobran ${total - qty}: quita de algún lugar` : `Faltan ${qty - total} por repartir`}
          </small>
        </div>
      )}
    </div>
  )
}
