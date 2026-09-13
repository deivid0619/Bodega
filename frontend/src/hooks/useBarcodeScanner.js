// Escaneo con la cámara del dispositivo. Usa la BarcodeDetector nativa del
// navegador si existe (Chrome/Android); si no, cae a html5-qrcode (funciona
// en más navegadores, incluido Safari/iOS). Si ninguna cámara responde,
// avisa para que se escriba el código a mano o se use un lector físico.
import { useCallback, useRef, useState } from 'react'

const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code']

export function useBarcodeScanner(onCode) {
  const [status, setStatus] = useState('off') // off | native | lib | fail
  const [message, setMessage] = useState('')
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const h5Ref = useRef(null)
  const lastRef = useRef({ code: '', t: 0 })

  const emit = useCallback((code) => {
    const now = Date.now()
    if (code === lastRef.current.code && now - lastRef.current.t < 1800) return
    lastRef.current = { code, t: now }
    onCode(code)
  }, [onCode])

  const stop = useCallback(async () => {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (h5Ref.current) {
      try { await h5Ref.current.stop(); h5Ref.current.clear() } catch { /* ya estaba detenida */ }
      h5Ref.current = null
    }
    setStatus('off')
  }, [])

  const start = useCallback(async () => {
    setStatus('native')
    setMessage('Abriendo la cámara…')
    try {
      let formats = []
      if ('BarcodeDetector' in window) {
        try { formats = await window.BarcodeDetector.getSupportedFormats() } catch { /* navegador sin permiso todavía */ }
      }
      const want = FORMATS.filter((f) => formats.includes(f))
      if (want.includes('code_128')) {
        const detector = new window.BarcodeDetector({ formats: want })
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } })
        streamRef.current = stream
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        setMessage('Apunta al código de barras de la etiqueta')
        const loop = async () => {
          if (!streamRef.current) return
          try {
            const codes = await detector.detect(video)
            if (codes.length) emit(codes[0].rawValue)
          } catch { /* cuadro sin lectura, se intenta con el siguiente */ }
          rafRef.current = requestAnimationFrame(loop)
        }
        loop()
      } else {
        setStatus('lib')
        const { Html5Qrcode } = await import('html5-qrcode')
        const h5 = new Html5Qrcode(containerRef.current.id, false)
        h5Ref.current = h5
        await h5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (w, h) => ({ width: Math.max(60, Math.floor(w * 0.85)), height: Math.max(60, Math.floor(Math.min(w, h) * 0.42)) }) },
          (text) => emit(text),
          () => {},
        )
        setMessage('Apunta al código de barras de la etiqueta')
      }
    } catch {
      await stop()
      setStatus('fail')
      setMessage('La cámara no está disponible aquí. Escribe el código abajo o conecta un lector de códigos USB o Bluetooth.')
    }
  }, [emit, stop])

  return { status, message, videoRef, containerRef, start, stop }
}
