// Service worker minimo: permite instalar la app y abrirla sin senal.
// - Paginas: primero la red (siempre la version mas nueva); sin red, la copia guardada.
// - /assets/: los nombres llevan hash, asi que una vez guardados no cambian.
// - La API y otros dominios nunca pasan por aqui: los datos son siempre en vivo.
const CACHE = 'bodega-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })),
    )
  }
})

// ---------- avisos al celular (llegan aunque la app este cerrada) ----------
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(d.title || 'Bodega', {
    body: d.body || '',
    icon: '/icon-192.png',
    // el mismo tag reemplaza al aviso anterior en vez de apilarlos
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
  }))
})

// tocar el aviso abre la app (o la trae al frente) en la pantalla que corresponde
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = wins.find((w) => w.url.startsWith(self.location.origin))
    if (win) {
      await win.focus()
      if ('navigate' in win) await win.navigate(url).catch(() => {})
      return
    }
    await self.clients.openWindow(url)
  })())
})
