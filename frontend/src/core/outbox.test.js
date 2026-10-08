import { beforeEach, describe, expect, it, vi } from 'vitest'

// la fila de lo registrado sin señal: se guarda en el celular, se sube en
// orden con su llave y lo que el servidor rechaza queda aparte
async function fresh() {
  vi.resetModules()
  return import('./outbox')
}

const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
const bad = (detail) => Promise.resolve(new Response(JSON.stringify({ detail }), { status: 400, headers: { 'Content-Type': 'application/json' } }))

// un localStorage de verdad (el de Node, si existe, no tiene getItem/setItem)
function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

describe('sin señal: la fila por subir', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('sin señal se queda guardado; al volver se sube en orden, cada uno con su llave', async () => {
    const outbox = await fresh()
    const sent = []
    let online = false
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => {
      if (!online) return Promise.reject(new TypeError('Failed to fetch'))
      sent.push({ url, id: opts.headers['X-Request-Id'], body: JSON.parse(opts.body) })
      return ok({ ok: true })
    })
    outbox.enqueue({ id: 'a', path: '/api/movements', body: { sku: 'X', type: 'in', qty: 2 }, op: { sku: 'X', type: 'in', qty: 2 } })
    outbox.enqueue({ id: 'b', path: '/api/movements', body: { sku: 'X', type: 'out', qty: 1 }, op: { sku: 'X', type: 'out', qty: 1 } })
    await outbox.flush()
    expect(outbox.snapshot().items).toHaveLength(2)
    expect(outbox.pendingOps()).toEqual([{ sku: 'X', type: 'in', qty: 2 }, { sku: 'X', type: 'out', qty: 1 }])
    expect(JSON.parse(localStorage.getItem('bodega_por_subir')).items).toHaveLength(2) // sobrevive a cerrar la app

    online = true
    const synced = vi.fn()
    outbox.onSynced(synced)
    await outbox.flush()
    expect(sent.map((s) => s.id)).toEqual(['a', 'b'])
    expect(sent[0].body).toEqual({ sku: 'X', type: 'in', qty: 2 })
    expect(outbox.snapshot().items).toHaveLength(0)
    expect(synced).toHaveBeenCalledWith(2)
  })

  it('lo que el servidor rechaza queda aparte y sigue con lo demas', async () => {
    const outbox = await fresh()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, opts) => (JSON.parse(opts.body).qty > 5 ? bad('Solo hay 3') : ok({})))
    outbox.enqueue({ id: 'big', path: '/api/movements', body: { sku: 'X', type: 'out', qty: 9 } })
    outbox.enqueue({ id: 'small', path: '/api/movements', body: { sku: 'X', type: 'out', qty: 1 } })
    await outbox.flush()
    const snap = outbox.snapshot()
    expect(snap.items).toHaveLength(0)
    expect(snap.failed.map((f) => [f.id, f.err])).toEqual([['big', 'Solo hay 3']])
    outbox.discard('big')
    expect(outbox.snapshot().failed).toHaveLength(0)
  })
})
