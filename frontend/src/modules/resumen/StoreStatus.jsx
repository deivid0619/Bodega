import { useState } from 'react'
import { api } from '../../core/api'
import { usePolling } from '../../core/useApi'

const ago = (sec) => {
  const min = Math.round((Date.now() / 1000 - sec) / 60)
  return min < 1 ? 'hace un momento' : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`
}

// La conexion con la tienda virtual: de ahi salen los nombres, las tallas,
// las fotos y los codigos para comparar las etiquetas. Se ve si esta bien y
// se puede volver a leer con un toque.
export default function StoreStatus() {
  const { data, reload } = usePolling('/api/catalog/status', { interval: 120000 })
  const [busy, setBusy] = useState(false)
  if (!data?.enabled) return null
  const ok = data.codes > 0
  const refresh = async () => {
    setBusy(true)
    try {
      await api.post('/api/catalog/refresh')
    } catch {
      // se ve en el estado que sigue
    }
    await reload()
    setBusy(false)
  }
  return (
    <div className={`store-status ${ok ? (data.error ? 'warn' : 'ok') : 'bad'}`} role="status">
      <span className="store-dot" aria-hidden="true" />
      <span className="store-t">
        <b>{ok ? 'Tienda virtual conectada' : 'Sin conexión con la tienda virtual'}</b>
        <small>
          {ok
            ? `${data.codes} códigos${data.ok_at ? ` · leída ${ago(data.ok_at)}` : ''}${data.error ? ' · el último intento falló: se usa lo que se leyó antes' : ''}`
            : 'Los nombres, las tallas y las fotos no se llenan solos hasta que vuelva.'}
        </small>
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>{busy ? 'Leyendo…' : 'Actualizar'}</button>
    </div>
  )
}

// Donde se guardan las fotos de remisiones y facturas (dos meses) y si funciona:
// para revisar que quedo bien conectado Supabase despues de poner la llave
export function PhotoStoreStatus() {
  const { data } = usePolling('/api/documents/photo-store', { interval: 600000 })
  if (!data) return null
  const title = data.where === 'supabase'
    ? (data.ok ? `Fotos de remisiones y facturas: se guardan ${data.days} días` : 'Fotos de remisiones y facturas: no se están guardando')
    : data.where === 'local' ? 'Fotos de remisiones y facturas: en este computador' : 'Fotos de remisiones y facturas: no se están guardando'
  return (
    <div className={`store-status ${data.ok ? (data.where === 'local' ? 'warn' : 'ok') : 'bad'}`} role="status">
      <span className="store-dot" aria-hidden="true" />
      <span className="store-t">
        <b>{title}</b>
        <small>{data.detail}</small>
      </span>
    </div>
  )
}
