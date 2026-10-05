import { useState } from 'react'
import { api, ApiError } from '../api'
import { refreshInventory, revalidate } from '../hooks/useApi'
import { downloadCsv } from '../utils'
import { useToast } from './ToastContext'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'

const stamp = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Dejar la bodega vacia para empezar con datos reales. Primero el respaldo,
// despues la palabra BORRAR: nunca se dispara por un toque sin querer.
function Body() {
  const showToast = useToast()
  const { close } = useSheet()
  const [backedUp, setBackedUp] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = word.trim().toUpperCase() === 'BORRAR'

  const backup = async () => {
    try {
      downloadCsv(await api.get('/api/reports/inventory.csv'), `respaldo-inventario-${stamp()}.csv`)
      downloadCsv(await api.get('/api/reports/movements.csv'), `respaldo-historial-${stamp()}.csv`)
      setBackedUp(true)
    } catch {
      showToast('No se pudo descargar el respaldo.', 'err')
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await api.delete('/api/products?confirm=BORRAR')
      refreshInventory()
      revalidate('/api/documents')
      showToast('Listo: la bodega quedó vacía para empezar con datos reales')
      close()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo borrar.', 'err')
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader
        eyebrow={<div className="sheet-eyebrow"><span className="tag tag-warn">Solo administrador</span></div>}
        title="Empezar de cero"
        subtitle="Para empezar a meter los datos reales de la bodega."
      />
      <div className="reset-box">
        <p><b>Se borra:</b> todas las prendas y sus ubicaciones, la reserva, el historial y las facturas, remisiones y conteos.</p>
        <p><b>Se conserva:</b> las cuentas de usuario y la distribución de la bodega (percheros, canastas, estanterías).</p>
      </div>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={backup}>
        <Icon name={backedUp ? 'check' : 'download'} size={18} />{backedUp ? 'Respaldo descargado' : 'Descargar respaldo primero'}
      </button>
      <label className="field">
        <span className="field-label">Escribe BORRAR para confirmar</span>
        <input className="input mono" value={word} onChange={(e) => setWord(e.target.value)} placeholder="BORRAR" autoCapitalize="characters" autoComplete="off" spellCheck="false" />
      </label>
      <button className="btn btn-danger-solid btn-lg btn-block" style={{ marginTop: 16 }} disabled={!ready || busy} onClick={reset}>
        {busy ? 'Borrando…' : 'Borrar todo y empezar'}
      </button>
    </>
  )
}

export default function ResetSheet({ onClose }) {
  return (
    <Sheet modal onClose={onClose} label="Empezar de cero">
      <Body />
    </Sheet>
  )
}
