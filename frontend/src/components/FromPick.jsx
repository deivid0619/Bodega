// "¿De donde sale?": en una salida de una prenda que esta en varios lugares
// (o en el outlet), se elige de cual salio para que cada canasta quede bien.
// value: undefined (sin elegir), '' (donde sea) o el id de una ubicacion.
// Lo elegido sale primero; si ahi no alcanza, el resto sale de donde haya.
export default function FromPick({ places, value, qty, onChange, disabled }) {
  const chosen = places.find((x) => x.id === value)
  const rest = chosen ? qty - chosen.qty : 0
  return (
    <div className="from-pick" role="group" aria-label="De dónde sale">
      <span className={value === undefined ? 'ask' : ''}>{value === undefined ? '¿De dónde sale?' : 'Sale de'}</span>
      {places.map((x) => (
        <button key={x.id} type="button" className={x.outlet ? 'outlet' : ''} aria-pressed={value === x.id} disabled={disabled}
                aria-label={`${x.id}, hay ${x.qty}${x.outlet ? ', outlet' : ''}`} onClick={() => onChange(x.id)}>
          {x.id}<b>{x.qty}</b>{x.outlet && <em>outlet</em>}
        </button>
      ))}
      <button type="button" className="any" aria-pressed={value === ''} disabled={disabled} onClick={() => onChange('')}>Donde sea</button>
      {chosen && rest > 0 && (
        <small>De {chosen.id} salen {chosen.qty}; {rest === 1 ? 'la otra' : `las otras ${rest}`}, de donde haya.</small>
      )}
    </div>
  )
}
