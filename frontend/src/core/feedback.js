// Pitido y vibracion al escanear: corto y agudo si salio bien, grave si no.
// Se usa un solo audio para toda la app: el iPhone solo deja sonar el audio
// que se "desperto" con un toque (unlockAudio, al abrir la camara), y crear
// uno nuevo en cada lectura lo dejaba mudo. El iPhone no vibra desde la web:
// por eso tambien se avisa encima de la camara.
let ctx = null

function audio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

export function unlockAudio() {
  try {
    const c = audio()
    if (!c) return
    const src = c.createBufferSource()
    src.buffer = c.createBuffer(1, 1, 22050)
    src.connect(c.destination)
    src.start(0)
  } catch { /* audio no disponible en este navegador */ }
}

export function beep(ok) {
  try {
    const c = audio()
    if (c) {
      const o = c.createOscillator()
      const g = c.createGain()
      o.frequency.value = ok ? 1400 : 220
      g.gain.value = 0.08
      o.connect(g)
      g.connect(c.destination)
      o.start()
      o.stop(c.currentTime + (ok ? 0.09 : 0.25))
    }
  } catch { /* audio no disponible en este navegador */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 35 : [60, 40, 60])
}
