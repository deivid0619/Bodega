// Fotos de remisiones y facturas: la prueba de lo que llego y lo que salio.
// Se achican en el celular (unos 200 KB, se siguen leyendo bien) antes de
// subirlas; el servidor las guarda un mes y despues se borran solas.
import { apiBlob, apiUpload } from '../api'

export async function shrinkPhoto(file, { max = 1600, quality = 0.72 } = {}) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob || file
  } catch {
    return file // si no se pudo achicar, va como esta
  } finally {
    URL.revokeObjectURL(url)
  }
}

// devuelve el documento con su foto
export async function saveDocPhoto(docId, file) {
  return apiUpload(`/api/documents/${docId}/photos`, await shrinkPhoto(file))
}

export async function docPhotoBlob(docId, index) {
  return apiBlob(`/api/documents/${docId}/photos/${index}`)
}

// Descargar: en el celular abre "compartir" (Guardar imagen, WhatsApp...);
// en el computador la baja como archivo
export async function downloadPhoto(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
  const phone = window.matchMedia('(pointer: coarse)').matches
  if (phone && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return // se cancelo el compartir
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
