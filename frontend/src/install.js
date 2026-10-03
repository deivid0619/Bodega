import { useEffect, useState } from 'react'

// El navegador avisa una sola vez, al cargar, que la app se puede instalar;
// se guarda ese aviso para ofrecer el boton "Instalar" cuando la persona quiera.
let deferred = null
const subs = new Set()
const notify = () => subs.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e
  notify()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  notify()
})

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    return () => subs.delete(f)
  }, [])
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
  return {
    standalone,
    ios,
    canPrompt: !!deferred,
    prompt: async () => {
      if (!deferred) return false
      deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null
      notify()
      return outcome === 'accepted'
    },
  }
}
