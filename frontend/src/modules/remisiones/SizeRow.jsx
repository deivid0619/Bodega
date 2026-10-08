import { cleanCode } from '../facturas/facturaParser'
import { Stepper } from '../../ui/Bits'

export default function SizeRow({ row, dest, showPending, prevPending, known, onChange }) {
  const code = cleanCode(row.code)
  const other = code && known.get(code)
  const noCode = !row.sku && !code
  return (
    <div className="rem-row">
      <div className="sz">{row.size || 'U'}</div>
      <div className="rem-row-t">
        {row.sku ? (
          <small>
            <span className="mono">{row.sku}</span>
            {/* de la tienda y todavia no registrada: no es que haya 0, es nueva */}
            {known.has(row.sku) || row.inReserve ? ` · hay ${row.have}` : ' · nueva en la bodega'}
            {row.inReserve ? ` · ${row.inReserve} en reserva` : ''}
          </small>
        ) : (
          <small className={row.qty > 0 && dest === 'bodega' ? 'warn' : ''}>
            {row.qty > 0 && dest === 'bodega' && noCode ? 'Sin código: queda en la reserva' : 'Talla sin código todavía'}
          </small>
        )}
        {prevPending > 0 && <small className="due">Debían {prevPending} de la entrega anterior</small>}
      </div>
      <Stepper
        onMinus={() => onChange((r) => ({ qty: Math.max(0, r.qty - 1) }))}
        onPlus={() => onChange((r) => ({ qty: r.qty + 1 }))}
        disabledMinus={row.qty === 0}
        minusLabel={`Una menos de talla ${row.size || 'única'}`}
        plusLabel={`Una más de talla ${row.size || 'única'}`}
      >
        <input
          type="number"
          inputMode="numeric"
          aria-label={`Llegaron de talla ${row.size || 'única'}`}
          value={row.qty || ''}
          placeholder="0"
          onChange={(e) => onChange({ qty: Math.max(0, Math.min(9999, Math.floor(+e.target.value) || 0)) })}
        />
      </Stepper>
      {!row.sku && row.qty > 0 && dest === 'bodega' && (
        <div className="rem-row-code">
          <input
            className="rem-code"
            value={row.code}
            onChange={(e) => onChange({ code: e.target.value })}
            placeholder="Código de la etiqueta (opcional)"
            aria-label={`Código de la talla ${row.size || 'única'}`}
            autoCapitalize="characters"
            spellCheck="false"
          />
          {other && <small className="warn">Ese código ya es de {other.name}{other.size ? ` · ${other.size}` : ''}.</small>}
        </div>
      )}
      {showPending && (
        <div className="rem-pend">
          <span>Faltan por llegar<small>{row.pending > 0 ? 'Solo se anotan: no se suman' : 'Lo que quedaron debiendo'}</small></span>
          <Stepper
            value={row.pending}
            onMinus={() => onChange((r) => ({ pending: Math.max(0, r.pending - 1) }))}
            onPlus={() => onChange((r) => ({ pending: r.pending + 1 }))}
            disabledMinus={row.pending === 0}
            minusLabel="Una pendiente menos"
            plusLabel="Una pendiente más"
            small
          />
        </div>
      )}
    </div>
  )
}
