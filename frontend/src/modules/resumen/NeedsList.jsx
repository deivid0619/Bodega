import { useState } from 'react'
import Icon from '../../ui/Icon'
import { plural } from '../../ui/Bits'
import { groupNeeds } from './groups'

// Por reponer, compacto: una fila por referencia con sus tallas (cuanto hay,
// cuanto pedir y cuanto traer de la reserva). Se ven las mas urgentes; el
// resto con "Ver todas".
const SHOW = 4

export default function NeedsList({ needs, onReserve }) {
  const groups = groupNeeds(needs)
  const [all, setAll] = useState(false)
  const order = groups.reduce((t, g) => t + g.order, 0)
  const bring = groups.reduce((t, g) => t + g.bring, 0)
  const list = all ? groups : groups.slice(0, SHOW)
  return (
    <>
      <p className="need-sum">
        <b>{plural(groups.length, 'referencia', 'referencias')} · {plural(needs.length, 'talla', 'tallas')}</b>
        {order > 0 && <span className="ord">pedir {order}</span>}
        {bring > 0 && <span className="brg">traer {bring} de la reserva</span>}
      </p>
      <div className="card panel">
        {list.map((g) => (
          <div className="need need-ref" key={g.key}>
            <div className="need-t">
              <b>{g.name}</b>
              <div className="need-sizes">
                {g.sizes.map((s) => (
                  <span key={s.sku} className={`nsz${s.out ? ' out' : ''}`}
                        aria-label={`Talla ${s.size}: hay ${s.qty}, mínimo ${s.min}${s.order ? `, pedir ${s.order}` : ''}${s.bring ? `, traer ${s.bring} de la reserva` : ''}`}>
                    <b>{s.size}</b>
                    <small>{s.out ? 'agotada' : `hay ${s.qty}`}</small>
                    {s.order > 0 && <i className="ord">pedir {s.order}</i>}
                    {s.bring > 0 && <i className="brg">traer {s.bring}</i>}
                  </span>
                ))}
              </div>
            </div>
            {g.order > 0 ? (
              <div className="need-q"><b>{g.order}</b><span>pedir</span></div>
            ) : (
              <div className="need-q dark"><b>{g.bring}</b><span>traer</span></div>
            )}
          </div>
        ))}
      </div>
      <div className="need-more">
        {groups.length > SHOW && (
          <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
            {all ? 'Ver menos' : `Ver todas (${groups.length - SHOW} ${groups.length - SHOW === 1 ? 'referencia más' : 'referencias más'})`}
          </button>
        )}
        {bring > 0 && (
          <button type="button" className="link-btn" onClick={onReserve}>
            <Icon name="reserve" size={14} stroke={2.2} />Traer de la reserva
          </button>
        )}
      </div>
    </>
  )
}
