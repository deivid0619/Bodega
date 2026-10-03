// Resortes (springs) para movimiento interrumpible: siempre arrancan desde
// el valor y la velocidad actuales, asi que un gesto puede agarrar una hoja
// a mitad de camino sin saltos. Parametros al estilo Apple: damping (1 = sin
// rebote) y response (segundos aproximados hasta llegar).
export function springTo(from, to, { velocity = 0, damping = 1, response = 0.35, onUpdate, onDone } = {}) {
  const k = (2 * Math.PI / response) ** 2
  const c = (4 * Math.PI * damping) / response
  let x = from, v = velocity, last = null, raf = 0, stopped = false
  const tick = (now) => {
    if (stopped) return
    if (last == null) last = now
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps
    for (let i = 0; i < steps; i++) {
      const a = -k * (x - to) - c * v
      v += a * h
      x += v * h
    }
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 4) {
      onUpdate(to)
      onDone?.()
      return
    }
    onUpdate(x)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => { stopped = true; cancelAnimationFrame(raf) }
}

// Hacia donde "va" un gesto al soltarlo (misma funcion que usa iOS).
export const project = (velocity, decay = 0.998) => ((velocity / 1000) * decay) / (1 - decay)

// Resistencia progresiva al pasar un limite, en vez de un tope duro.
export const rubberband = (overshoot, dim, c = 0.55) => (overshoot * dim * c) / (dim + c * Math.abs(overshoot))

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
