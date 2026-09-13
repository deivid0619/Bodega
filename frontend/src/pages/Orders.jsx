import { useNeeds, useTop } from '../hooks/useApi'
import { api } from '../api'
import { useToast } from '../components/ToastContext'
import { downloadCsv } from '../utils'

export default function Orders() {
  const { data: needs } = useNeeds()
  const { data: top } = useTop()
  const showToast = useToast()

  const orderText = () => {
    const date = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    const lines = (needs || []).map(
      (n) => `${n.product.name}${n.product.size ? ' talla ' + n.product.size : ''} (${n.product.sku}): pedir ${n.order_qty}, hay ${n.product.qty}`,
    )
    return `Pedido bodega ${date}\n\n${lines.join('\n')}`
  }

  const copyOrder = async () => {
    try {
      await navigator.clipboard.writeText(orderText())
      showToast('Pedido copiado. Pégalo en WhatsApp o en un correo.')
    } catch {
      showToast('No se pudo copiar en este dispositivo.', 'err')
    }
  }

  const exportOrder = async () => {
    const csv = await api.get('/api/reports/inventory.csv')
    downloadCsv(csv, `pedido-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <section className="view" aria-label="Pedidos">
      <h2>Lo que hay que pedir</h2>
      <p className="muted">
        Aparece aquí todo lo que está en su stock mínimo o por debajo. La cantidad sugerida lleva cada talla al doble del mínimo.
      </p>
      {!needs ? (
        <p className="muted">Cargando…</p>
      ) : needs.length ? (
        <>
          {needs.map((n) => (
            <div className="need" key={n.product.sku}>
              <h3>{n.product.name}{n.product.size ? ` talla ${n.product.size}` : ''}</h3>
              <p>Hay <b>{n.product.qty}</b>, mínimo {n.product.min_qty}, en {n.product.location_name}</p>
              <div className="order"><b>{n.order_qty}</b><span>pedir</span></div>
            </div>
          ))}
          <div className="actions">
            <button className="btn primary" onClick={copyOrder}>Copiar pedido</button>
            <button className="btn ghost" onClick={exportOrder}>Descargar</button>
          </div>
        </>
      ) : (
        <div className="empty">Todo está por encima del stock mínimo.</div>
      )}

      <h2>Lo que más sale en 30 días</h2>
      {top && top.length ? (
        top.map((t) => (
          <div className="top5" key={t.sku}>
            <span>{t.name}{t.size ? ` talla ${t.size}` : ''}</span>
            <b>{t.qty_out}</b>
          </div>
        ))
      ) : (
        <p className="muted">Cuando registres salidas, aquí verás las referencias que más rotan.</p>
      )}
    </section>
  )
}
