// Pitido y vibracion al escanear: corto y agudo si salio bien, grave si no.
export function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = ok ? 1400 : 220
    g.gain.value = 0.07
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25))
  } catch { /* audio no disponible en este navegador */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 35 : [60, 40, 60])
}
