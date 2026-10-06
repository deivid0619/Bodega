// Escaneo con la camara del dispositivo. El lector sale de lib/barcode.js
// (el de Chrome en Android, ZXing en iPhone). Si ninguna camara responde,
// avisa para escribir el codigo a mano, leerlo de una foto o usar un lector
// fisico.
//
// Los codigos de las etiquetas son pequenos: la camara se abre en alta
// resolucion, con enfoque continuo y un poco de zoom cuando el celular lo
// permite, asi no hay que acercarlo tanto (de muy cerca no enfoca).
import { useCallback, useEffect, useRef, useState } from 'react'
import { centerBand, getDetector, readCodeFromFile } from '../lib/barcode'

const VIDEO = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
const ZOOM = 1.8
const AIM = 'Pon el código dentro del recuadro, a unos 20 cm'
// sin leer nada en este tiempo, la camara se apaga sola (bateria y linterna)
const IDLE_MS = 45_000
// la misma etiqueta solo cuenta otra vez despues de salir de la vista este
// tiempo. Antes se volvia a contar cada 1,8 s mientras siguiera frente a la
// camara: con "Prendas por escaneo" en 20, sumaba 20 mas sin querer
const SAME_GAP = 1200

// enfoque continuo y zoom, cada uno por aparte: si la camara no acepta uno,
// el otro igual se aplica. Devuelve si tiene linterna.
async function tune(track) {
  const caps = track.getCapabilities?.() || {}
  if (caps.focusMode?.includes?.('continuous')) {
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* sin enfoque manual */ }
  }
  if (caps.zoom && caps.zoom.max >= 1.2) {
    const zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, ZOOM))
    try { await track.applyConstraints({ advanced: [{ zoom }] }) } catch { /* sin zoom */ }
  }
  return !!caps.torch
}

export function useBarcodeScanner(onCode) {
  const [status, setStatus] = useState('off') // off | on | fail
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('') // por que se apago, si fue sola
  const [torch, setTorchState] = useState('none') // none | off | on
  const torchRef = useRef('none')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const lastRef = useRef({ code: '', t: 0 })
  const activeRef = useRef(0) // ultima lectura (o apertura)
  // cada apertura de camara tiene su numero: si se cerro y se volvio a abrir
  // mientras la anterior seguia cargando, la vieja no toca nada
  const sessionRef = useRef(0)
  // siempre la version mas reciente (modo, cantidad...), no la del momento en que se abrio la camara
  const onCodeRef = useRef(onCode)
  useEffect(() => { onCodeRef.current = onCode })

  const setTorch = (v) => {
    torchRef.current = v
    setTorchState(v)
  }

  const emit = useCallback((code) => {
    const now = Date.now()
    const still = code === lastRef.current.code && now - lastRef.current.t < SAME_GAP
    lastRef.current = { code, t: now } // mientras se siga viendo, no vuelve a contar
    if (still) return
    activeRef.current = now
    onCodeRef.current(code)
  }, [])

  const stop = useCallback(async () => {
    sessionRef.current++
    clearTimeout(timerRef.current)
    const stream = streamRef.current
    streamRef.current = null
    if (stream) {
      // la linterna se apaga antes de soltar la camara: en iPhone, si solo se
      // suelta la camara, a veces queda prendida
      const track = stream.getVideoTracks()[0]
      if (track && torchRef.current === 'on') {
        try { await track.applyConstraints({ advanced: [{ torch: false }] }) } catch { /* ya estaba apagada */ }
      }
      stream.getTracks().forEach((t) => t.stop())
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setTorch('none')
    setStatus('off')
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('fail')
      setMessage('Este navegador no deja usar la cámara aquí. Lee el código con una foto, escríbelo abajo o usa un lector USB o Bluetooth.')
      return
    }
    await stop()
    const session = sessionRef.current
    const stale = () => session !== sessionRef.current
    setNote('')
    activeRef.current = Date.now()
    lastRef.current = { code: '', t: 0 } // al abrir la camara, la primera lectura siempre cuenta
    setStatus('on')
    setMessage('Abriendo la cámara…')
    try {
      const [{ native, detector }, stream] = await Promise.all([
        getDetector(),
        navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false }),
      ])
      if (stale()) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      const video = videoRef.current
      video.muted = true
      video.setAttribute('playsinline', '')
      video.srcObject = stream
      await video.play()
      if (stale()) return
      const hasTorch = await tune(track)
      if (stale()) return
      setTorch(hasTorch ? 'off' : 'none')
      setMessage(AIM)
      const canvas = document.createElement('canvas')
      let zoomed = false
      const scan = async () => {
        if (stale() || !streamRef.current) return
        if (Date.now() - activeRef.current > IDLE_MS) {
          await stop()
          setNote('La cámara se apagó sola para ahorrar batería.')
          return
        }
        try {
          if (video.readyState >= 2) {
            // el de Chrome lee el cuadro completo sin esfuerzo; a ZXing se le
            // pasa solo la franja del recuadro, mas grande y mas rapida
            zoomed = !zoomed
            const source = native ? video : centerBand(video, canvas, zoomed)
            if (source) {
              const codes = await detector.detect(source)
              if (codes.length) emit(codes[0].rawValue)
            }
          }
        } catch { /* cuadro sin lectura */ }
        timerRef.current = setTimeout(scan, native ? 120 : 50)
      }
      scan()
    } catch (err) {
      if (stale()) return
      await stop()
      setStatus('fail')
      setMessage(
        err && err.name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y vuelve a intentar.'
          : 'No se pudo abrir la cámara. Lee el código con una foto, escríbelo abajo o conecta un lector USB o Bluetooth.',
      )
    }
  }, [emit, stop])

  // si la app pasa a segundo plano, la camara (y la linterna) se apagan
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && streamRef.current) stop() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [stop])

  // linterna, para leer en los rincones oscuros de la bodega
  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = torchRef.current !== 'on'
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] })
      setTorch(next ? 'on' : 'off')
    } catch {
      setTorch('none')
    }
  }, [])

  // leer de una foto: devuelve true si encontro un codigo
  const readFile = useCallback(async (file) => {
    const code = await readCodeFromFile(file)
    if (code) {
      lastRef.current = { code: '', t: 0 } // la misma etiqueta por foto si cuenta otra vez
      onCodeRef.current(code)
    }
    return !!code
  }, [])

  return { status, message, note, videoRef, start, stop, torch, toggleTorch, readFile }
}
