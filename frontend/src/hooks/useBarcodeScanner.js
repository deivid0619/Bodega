// Escaneo con la camara del dispositivo. Usa la BarcodeDetector nativa del
// navegador si existe (Chrome/Android); si no, cae a html5-qrcode (Safari/
// iPhone). Si ninguna camara responde, avisa para escribir el codigo a mano
// o usar un lector fisico.
import { useCallback, useEffect, useRef, useState } from 'react'

const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code']
const SCAN_EVERY_MS = 140 // leer en cada cuadro de video recalienta el celular y lo pone lento

export function useBarcodeScanner(onCode) {
  const [status, setStatus] = useState('off') // off | native | lib | fail
  const [message, setMessage] = useState('')
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const h5Ref = useRef(null)
  const lastRef = useRef({ code: '', t: 0 })
  // cada apertura de camara tiene su numero: si se cerro y se volvio a abrir
  // mientras la anterior seguia cargando, la vieja no toca nada
  const sessionRef = useRef(0)
  // siempre la version mas reciente (modo, cantidad...), no la del momento en que se abrio la camara
  const onCodeRef = useRef(onCode)
  useEffect(() => { onCodeRef.current = onCode })

  const emit = useCallback((code) => {
    const now = Date.now()
    if (code === lastRef.current.code && now - lastRef.current.t < 1800) return
    lastRef.current = { code, t: now }
    onCodeRef.current(code)
  }, [])

  const stop = useCallback(async () => {
    sessionRef.current++
    clearTimeout(timerRef.current)
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('fail')
      setMessage('Este navegador no deja usar la cámara aquí. Escribe el código abajo o usa un lector USB o Bluetooth.')
      return
    }
    await stop()
    const session = sessionRef.current
    const stale = () => session !== sessionRef.current
    setStatus('native')
    setMessage('Abriendo la cámara…')
    try {
      let formats = []
      if ('BarcodeDetector' in window) {
        try { formats = await window.BarcodeDetector.getSupportedFormats() } catch { /* sin soporte */ }
      }
      const want = FORMATS.filter((f) => formats.includes(f))
      if (want.includes('code_128')) {
        const detector = new window.BarcodeDetector({ formats: want })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stale()) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        video.muted = true
        video.setAttribute('playsinline', '')
        video.srcObject = stream
        await video.play()
        if (stale()) return
        setMessage('Apunta al código de barras de la etiqueta')
        const scan = async () => {
          if (stale() || !streamRef.current) return
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video)
              if (codes.length) emit(codes[0].rawValue)
            }
          } catch { /* cuadro sin lectura */ }
          timerRef.current = setTimeout(scan, SCAN_EVERY_MS)
        }
        scan()
      } else {
        setStatus('lib')
        const { Html5Qrcode } = await import('html5-qrcode')
        if (stale()) return
        const h5 = new Html5Qrcode(containerRef.current.id, false)
        h5Ref.current = h5
        await h5.start(
          { facingMode: 'environment' },
          { fps: 8, aspectRatio: 4 / 3, disableFlip: true },
          (text) => emit(text),
          () => {},
        )
        if (stale()) return
        setMessage('Apunta al código de barras de la etiqueta')
      }
    } catch (err) {
      if (stale()) return
      await stop()
      setStatus('fail')
      setMessage(
        err && err.name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y vuelve a intentar.'
          : 'No se pudo abrir la cámara. Escribe el código abajo o conecta un lector USB o Bluetooth.',
      )
    }
  }, [emit, stop])

  return { status, message, videoRef, containerRef, start, stop }
}
