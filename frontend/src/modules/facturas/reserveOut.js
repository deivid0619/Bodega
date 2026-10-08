// Pedidos y facturas: lo que no esta en la bodega (o no alcanza) sale de la
// reserva. Aqui, cuanto hay de cada codigo en la reserva y como se dice.
import { useMemo } from 'react'
import { useReserve } from '../../core/useApi'
import { reserveFor, reserveIndex } from '../../core/utils'

// inRes(p): cuantas hay de ese codigo en la reserva (con su codigo o la misma
// referencia y talla guardada sin codigo, como lo cuenta el servidor)
export function useInReserve() {
  const { data: reserve } = useReserve()
  return useMemo(() => {
    const index = reserveIndex(reserve)
    return (p) => (p ? reserveFor(p, index).reduce((t, it) => t + it.qty, 0) : 0)
  }, [reserve])
}

// lo de la reserva con codigo que no esta registrado en la bodega: se puede
// escanear y empacar igual (al guardar, el servidor lo registra)
export function useReserveOnly(bySku) {
  const { data: reserve } = useReserve()
  return useMemo(() => {
    const m = new Map(bySku)
    for (const it of reserve || []) {
      if (!it.sku || !(it.qty > 0) || m.has(it.sku)) continue
      m.set(it.sku, { sku: it.sku, name: it.name, size: it.size, qty: 0, min_qty: 0, stock: [], image_url: it.image_url, reserveOnly: true })
    }
    return m
  }, [bySku, reserve])
}

// "Hay 0 en la bodega + 4 en la reserva · 2 salen de la reserva"
export function availText(bodega, res, qty) {
  if (!res) return bodega < qty ? `solo hay ${bodega}` : `hay ${bodega}`
  const fromRes = Math.max(0, Math.min(qty - bodega, res))
  const total = bodega + res
  return `${total < qty ? 'solo hay' : 'hay'} ${bodega} en la bodega + ${res} en la reserva${fromRes ? ` · ${fromRes === 1 ? '1 sale' : `${fromRes} salen`} de la reserva` : ''}`
}
