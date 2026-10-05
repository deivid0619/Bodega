// Escaneo con la camara del dispositivo. Usa la BarcodeDetector nativa del
// navegador si existe (Chrome/Android); si no, cae a html5-qrcode (Safari/
// iPhone). Si ninguna camara responde, avisa para escribir el codigo a mano
// o usar un lector fisico.
//
// Los codigos de las etiquetas son pequenos: la camara se abre en alta
// resolucion, con enfoque continuo y un poco de zoom, asi no hay que acercar
// tanto el celular (de muy cerca la camara no alcanza a enfocar y no lee).
import { useCallback, useEffect, useRef, useState } from 'react'

const FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code']
const SCAN_EVERY_MS = 120 // leer en cada cuadro de video recalienta el celular y lo pone lento
const VIDEO = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
const ZOOM = 1.8
const AIM = 'Pon el código dentro del recuadro, a unos 20 cm'

// enfoque continuo y zoom, cada uno por aparte: si la camara no acepta uno,
// el otro igual se aplica. Devuelve si tiene linterna.
async function tune(caps, apply) {
  if (caps.focusMode?.includes?.('continuous')) {
    try { await apply({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* sin enfoque manual */ }
  }
  if (caps.zoom && caps.zoom.max >= 1.2) {
    const zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, ZOOM))
    try { await apply({ advanced: [{ zoom }] }) } catch { /* sin zoom */ }
  }
  return !!caps.torch
}

export function useBarcodeScanner(onCode) {
  const [status, setStatus] = useState('off') // off | native | lib | fail
  const [message, setMessage] = useState('')
  const [torch, setTorch] = useState('none') // none | off | on
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
    setTorch('none')
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false })
        if (stale()) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const video = videoRef.current
        video.muted = true
        video.setAttribute('playsinline', '')
        video.srcObject = stream
        await video.play()
        if (stale()) return
        const hasTorch = await tune(track.getCapabilities?.() || {}, (c) => track.applyConstraints(c))
        if (stale()) return
        setTorch(hasTorch ? 'off' : 'none')
        setMessage(AIM)
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
        const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode')
        if (stale()) return
        const h5 = new Html5Qrcode(containerRef.current.id, {
          verbose: false,
          formatsToSupport: [F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.QR_CODE],
          useBarCodeDetectorIfSupported: true,
        })
        h5Ref.current = h5
        await h5.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            aspectRatio: 4 / 3,
            disableFlip: true,
            videoConstraints: VIDEO,
            // lee solo la franja del centro (donde esta el recuadro): con mas
            // detalle y mas rapido que buscando en toda la imagen
            qrbox: (w, h) => ({ width: Math.max(150, Math.floor(w * 0.86)), height: Math.max(80, Math.floor(h * 0.42)) }),
          },
          (text) => emit(text),
          () => {},
        )
        if (stale()) return
        let caps = {}
        try { caps = h5.getRunningTrackCapabilities() || {} } catch { /* el navegador no lo dice */ }
        const hasTorch = await tune(caps, (c) => h5.applyVideoConstraints(c))
        if (stale()) return
        setTorch(hasTorch ? 'off' : 'none')
        setMessage(AIM)
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

  // linterna, para leer en los rincones oscuros de la bodega
  const toggleTorch = useCallback(async () => {
    const next = torch !== 'on'
    const c = { advanced: [{ torch: next }] }
    try {
      const track = streamRef.current?.getVideoTracks()[0]
      if (track) await track.applyConstraints(c)
      else if (h5Ref.current) await h5Ref.current.applyVideoConstraints(c)
      else return
      setTorch(next ? 'on' : 'off')
    } catch {
      setTorch('none')
    }
  }, [torch])

  return { status, message, videoRef, containerRef, start, stop, torch, toggleTorch }
}
