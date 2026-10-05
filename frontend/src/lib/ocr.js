// Lee el texto de una foto en el mismo dispositivo con Tesseract (libre y
// gratis): la foto no se envia a ningun servicio. La primera vez descarga el
// lector (unos MB); despues queda guardado en el navegador.

// las fotos del celular llegan grandes (3000+ px): con 2400 basta y es mas
// rapido; una foto pequena (enviada por chat, comprimida) se agranda mas
const longSide = (long) => (long < 2000 ? 3200 : 2400)

async function toCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const long = Math.max(bmp.width, bmp.height)
  const scale = Math.min(2.5, longSide(long) / long)
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  // gris + contraste estirado (papel claro, letra oscura): el OCR lee mejor
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8
    px[i] = y
    hist[y]++
  }
  const total = w * h
  let lo = 0, hi = 255, acc = 0
  for (; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  acc = 0
  for (; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const span = Math.max(1, hi - lo)
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span))
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export async function readPhoto(file, { onProgress, onStage } = {}) {
  onStage?.('preparing')
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), toCanvas(file)])
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
