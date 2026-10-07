// Lee el texto de una foto en el mismo dispositivo con Tesseract (libre y
// gratis): la foto no se envia a ningun servicio. La primera vez descarga el
// lector (unos MB); despues queda guardado en el navegador.

// La foto se lee del tamano en que llega: achicarla borra la letra pequena de
// una factura fotografiada de lejos. Solo se achica si pasa de 12 MP (el
// limite comodo de un celular); una foto pequena (recortada, o enviada por
// chat) se agranda hasta 2.5x.
const MAX_PX = 12e6
function scaleFor(w, h) {
  const long = Math.max(w, h)
  const s = long < 2000 ? Math.min(2.5, 3200 / long) : 1
  return Math.min(s, Math.sqrt(MAX_PX / (w * h)))
}

// mascara de enfoque: cada punto se aleja del promedio de su vecindad (una
// caja de lado 2r+1). Devuelve la letra borrosa a algo que el lector entiende.
function sharpen(g, w, h, r, amount) {
  const n = 2 * r + 1
  const tmp = new Uint8ClampedArray(g.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -r; x <= r; x++) sum += g[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n
      sum += g[row + Math.min(w - 1, x + r + 1)] - g[row + Math.max(0, x - r)]
    }
  }
  const out = new Uint8ClampedArray(g.length)
  const col = new Float64Array(w)
  for (let y = -r; y <= r; y++) {
    const row = Math.min(h - 1, Math.max(0, y)) * w
    for (let x = 0; x < w; x++) col[x] += tmp[row + x]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    const add = Math.min(h - 1, y + r + 1) * w
    const sub = Math.max(0, y - r) * w
    for (let x = 0; x < w; x++) {
      const v = g[row + x]
      out[row + x] = v + amount * (v - col[x] / n)
      col[x] += tmp[add + x] - tmp[sub + x]
    }
  }
  return out
}

async function toCanvas(file, { sharp = false } = {}) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = scaleFor(bmp.width, bmp.height)
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  let g = new Uint8ClampedArray(w * h)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) g[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8
  if (sharp) g = sharpen(g, w, h, Math.round(3 * Math.max(1, scale)), 1.5)
  // gris + contraste estirado (papel claro, letra oscura): el OCR lee mejor
  const hist = new Uint32Array(256)
  for (const v of g) hist[v]++
  const total = w * h
  let lo = 0, hi = 255, acc = 0
  for (; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  acc = 0
  for (; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const span = Math.max(1, hi - lo)
  for (let j = 0, i = 0; j < g.length; j++, i += 4) {
    const v = Math.max(0, Math.min(255, ((g[j] - lo) * 255) / span))
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// sharp: la misma foto con mas nitidez (para un segundo intento si la primera
// lectura quedo corta: a una foto nitida le sobra y la empeora)
export async function readPhoto(file, { onProgress, onStage, sharp = false } = {}) {
  onStage?.('preparing')
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), toCanvas(file, { sharp })])
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onStage?.('reading')
        onProgress?.(m.progress)
      }
    },
  })
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' })
    const { data } = await worker.recognize(canvas)
    return data.text
  } finally {
    await worker.terminate()
  }
}
