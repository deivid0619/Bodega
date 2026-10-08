import Icon from './Icon'

// El codigo de la etiqueta no esta igual en la tienda, pero hay uno casi
// igual (en algunas tallas la tienda lo tiene mas corto: P-PRM001800XL en la
// etiqueta, P-PRM00180XL en la tienda). Se ofrece usar su nombre, talla y
// foto; el codigo que queda es el de la etiqueta.
export default function NearPick({ options, onPick }) {
  if (!options.length) return null
  return (
    <div className="near-pick">
      <span className="tag tag-warn">Parecida en la tienda</span>
      <p>Este código no está igual en la tienda. ¿Es esta?</p>
      {options.map((o) => (
        <button type="button" key={o.sku} className="near-opt" onClick={() => onPick(o)}>
          {o.image ? <img src={o.image} alt="" /> : <span className="shop-noimg" />}
          <span className="near-opt-t">
            <b>{o.name}{o.size ? ` · ${o.size}` : ''}</b>
            <small>En la tienda: {o.sku}</small>
          </span>
          <Icon name="check" size={18} stroke={2.4} />
        </button>
      ))}
    </div>
  )
}
