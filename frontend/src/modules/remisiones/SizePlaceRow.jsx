import { plural } from '../../ui/Bits'

// A donde va una talla que llego y donde hay de ella. Se toca una de las
// ubicaciones donde ya hay de esa talla para guardarla ahi, o "Otra" para
// elegir cualquiera. Si va con las otras tallas (se mezclan), se avisa.
// here: [{ id, name, qty }] donde hay de esa talla; to/toName: a donde va;
// how: por que va ahi; mix: va con otras tallas; chosen: se eligio a mano.
export default function SizePlaceRow({ size, qty, here, to, toName, how, mix, chosen, onPick, onOther, onAuto }) {
  const label = `talla ${size || 'única'}`
  return (
    <div className={`rem-size-place${!to ? ' need' : mix ? ' mix' : ''}`}>
      <span className="sz">{size || 'U'}</span>
      <div className="rsp-t">
        <b>{to ? toName : 'Elige dónde guardarla'}</b>
        <small>{plural(qty, 'prenda', 'prendas')}{how ? ` · ${how}` : ''}</small>
      </div>
      <button type="button" className="link-btn rsp-other" onClick={onOther} aria-label={`Elegir otra ubicación para la ${label}`}>Otra</button>
      {here.length > 0 && (
        <span className="tcw-here rsp-here">
          Hay de esta talla:
          {here.slice(0, 4).map((h) => (
            <button key={h.id} type="button" className={`tcw-chip${h.id === to ? ' on' : ''}`} onClick={() => onPick(h.id)}
                    aria-label={`Guardar la ${label} en ${h.name}: ahí hay ${h.qty}`} aria-pressed={h.id === to}>
              {h.id}<b>{h.qty}</b>
            </button>
          ))}
          {here.length > 4 && <small>y {here.length - 4} más</small>}
        </span>
      )}
      {chosen && <button type="button" className="link-btn rsp-auto" onClick={onAuto}>Volver a la automática</button>}
    </div>
  )
}
