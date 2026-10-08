// El lector de codigos de barras. En Android usa el del propio Chrome
// (BarcodeDetector); en iPhone, que no lo trae, usa ZXing compilado a
// WebAssembly: mas preciso y rapido con codigos de barras que la libreria
// anterior. El archivo .wasm se sirve desde la misma app (no de afuera).
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export const FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code']

let pending = null

export function getDetector() {
  if (!pending) {
    pending = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats()
          const want = FORMATS.filter((f) => supported.includes(f))
          if (want.includes('code_128')) return { native: true, detector: new window.BarcodeDetector({ formats: want }) }
        } catch { /* sin lector propio */ }
      }
      const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
      await prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
        fireImmediately: true,
      })
      return { native: false, detector: new BarcodeDetector({ formats: FORMATS }) }
    })().catch((err) => {
      pending = null
      throw err
    })
  }
  return pending
}

// La franja del centro del video (donde esta el recuadro) sin perder
// resolucion. Con zoom: un recorte mas chico del centro, al doble de tamano,
// para los codigos pequenos (en pruebas, uno de 1,6 px por barra solo se
// leia asi). El escaneo alterna las dos en cada cuadro.
export function centerBand(video, canvas, zoom = false) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const sw = Math.round(vw * (zoom ? 0.6 : 0.9))
  const sh = Math.round(vh * (zoom ? 0.34 : 0.5))
  const scale = Math.min(zoom ? 2 : 1, 2600 / sw)
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, Math.round((vw - sw) / 2), Math.round((vh - sh) / 2), sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

// Leer el codigo de una foto: la camara normal del celular enfoca bien de
// cerca, asi que sirve cuando en vivo no lo coge.
export async function readCodeFromFile(file) {
  const { detector } = await getDetector()
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    for (const side of [2000, 3200]) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * scale)
      c.height = Math.round(bmp.height * scale)
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
      const codes = await detector.detect(c)
      if (codes.length) return codes[0].rawValue
      if (scale === 1) break
    }
    return null
  } finally {
    bmp.close?.()
  }
}
