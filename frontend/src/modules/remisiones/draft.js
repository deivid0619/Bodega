// La remision que se va llenando queda guardada en el celular: si se cierra
// la hoja (o la app, o se va la señal), se sigue despues donde iba. Se borra
// al confirmarla o con "Descartar cambios". La foto va aparte (IndexedDB),
// porque pesa mas de lo que cabe junto al resto. Sin pantalla.

const KEY = 'bodega_remision_borrador'
const DB = 'bodega-borradores'
const STORE = 'fotos'
const PHOTO = 'remision'

export function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null')
    return d && d.v === 1 ? d : null
  } catch {
    return null
  }
}

export function writeDraft(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, v: 1, at: Date.now() }))
  } catch { /* sin espacio o bloqueado: se sigue sin borrador */ }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch { /* nada que borrar */ }
  return photoDb('delete')
}

const openDb = () => new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1)
  r.onupgradeneeded = () => r.result.createObjectStore(STORE)
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})

async function photoDb(op, blob) {
  try {
    const db = await openDb()
    try {
      return await new Promise((resolve, reject) => {
        const st = db.transaction(STORE, op === 'get' ? 'readonly' : 'readwrite').objectStore(STORE)
        const req = op === 'get' ? st.get(PHOTO) : op === 'put' ? st.put(blob, PHOTO) : st.delete(PHOTO)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      })
    } finally {
      db.close()
    }
  } catch {
    return null // sin IndexedDB (navegacion privada): la foto no queda en el borrador
  }
}

export const saveDraftPhoto = (file) => photoDb(file ? 'put' : 'delete', file)
export const readDraftPhoto = () => photoDb('get')

// "hace 5 minutos", "hace 2 horas", "ayer a las 4:10 p. m."
export function agoText(at) {
  const min = Math.round((Date.now() - at) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`
  const h = Math.round(min / 60)
  if (h < 12) return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  return `el ${new Date(at).toLocaleString('es-CO', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`
}
