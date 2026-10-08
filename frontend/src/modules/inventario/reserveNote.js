// El aviso de la reserva en una tarjeta del Inventario: si lo que se busca
// esta guardado en la reserva, se dice claro (quien busca en la bodega puede
// no saber que esta alla). Sin pantalla.
import { plural } from '../../ui/Bits'

// g: la tarjeta (bodega, reserve, onlyReserve). null si no hace falta aviso.
export function reserveNote(g) {
  if (!g || g.reserve <= 0) return null
  const n = plural(g.reserve, 'prenda guardada', 'prendas guardadas')
  if (g.onlyReserve) return { tone: 'only', text: `Solo está en la reserva: ${n}. En la bodega no hay.` }
  if (g.bodega <= 0) return { tone: 'only', text: `En la bodega no hay, pero en la reserva hay ${n}.` }
  return { tone: 'more', text: `También hay ${n} en la reserva.` }
}
