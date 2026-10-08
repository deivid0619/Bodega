// Avisos al celular (Web Push). En iPhone solo funcionan con la app
// instalada en la pantalla de inicio; en Android, en Chrome o instalada.
import { api } from '../../core/api'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

// la version publicada ya registra el service worker al abrir; en desarrollo
// se registra aqui, solo si alguien activa los avisos
async function registration() {
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('/sw.js')
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function enablePush(prefs) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission)
  await registration()
  const reg = await navigator.serviceWorker.ready
  const { public_key: key } = await api.get('/api/push/key')
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) })
  }
  const { endpoint, keys } = sub.toJSON()
  await api.post('/api/push/subscribe', { endpoint, keys, prefs })
  return sub
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

export async function savePushPrefs(prefs) {
  const sub = await currentSubscription()
  if (sub) await api.post('/api/push/prefs', { endpoint: sub.endpoint, prefs })
}

export async function testPush() {
  const sub = await currentSubscription()
  if (!sub) throw new Error('sin-suscripcion')
  await api.post('/api/push/test', { endpoint: sub.endpoint })
}
