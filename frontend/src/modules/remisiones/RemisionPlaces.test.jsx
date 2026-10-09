// La remision en "Donde queda": cada talla dice a donde va y donde ya hay de
// ella, se puede mandar a una de esas ubicaciones, y al confirmar cada talla
// va a la suya (sin mezclar tallas). Se dibuja con datos de ejemplo, sin red.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn(async () => ({ document: { id: 1, number: 'OPR77', units: 6, pending: 0 } }))
const products = [
  { sku: 'F-S', name: 'CHAQUETA FENIX BLACK', size: 'S', qty: 7, location_id: 'C-4-1', location_name: 'Canasta C-4-1',
    stock: [{ location_id: 'C-4-1', location_name: 'Canasta C-4-1', qty: 2 }, { location_id: 'C-4-2', location_name: 'Canasta C-4-2', qty: 5 }] },
  { sku: 'F-M', name: 'CHAQUETA FENIX BLACK', size: 'M', qty: 20, location_id: 'C-9-9', location_name: 'Canasta C-9-9',
    stock: [{ location_id: 'C-9-9', location_name: 'Canasta C-9-9', qty: 20 }] },
]
const layout = { elements: [{ name: 'Canastas C', locations: ['C-4-1', 'C-4-2', 'C-9-9'].map((id) => ({ id, name: `Canasta ${id}` })) }] }
const draft = {
  number: 'OPR 77', supplier: '', date: '2026-10-09', picking: false, showPending: false, dest: 'bodega', delivery: 0, notes: '',
  hasPhoto: false, at: Date.now(),
  blocks: [{ name: 'CHAQUETA FENIX BLACK', isNew: false, shop: false, place: '', rows: [
    { size: 'S', sku: 'F-S', have: 7, inReserve: 0, qty: 3, pending: 0, code: '' },
    { size: 'M', sku: 'F-M', have: 20, inReserve: 0, qty: 2, pending: 0, code: '' },
    { size: 'L', sku: null, have: 0, inReserve: 0, qty: 1, pending: 0, code: 'F-L' }, // talla nueva
  ] }],
}

vi.mock('../../core/useApi', () => ({
  usePolling: () => ({ data: [] }),
  useProducts: () => ({ data: products }),
  useReserve: () => ({ data: [] }),
  useLayout: () => ({ data: layout }),
  revalidate: vi.fn(),
  refreshInventory: vi.fn(),
}))
vi.mock('../../core/api', () => ({ api: { get: async () => [], post: (...a) => post(...a) }, ApiError: class ApiError extends Error {} }))
vi.mock('./draft', () => ({
  readDraft: () => draft, readDraftPhoto: async () => null, writeDraft: () => {}, clearDraft: async () => {},
  saveDraftPhoto: () => {}, agoText: () => 'hace un rato',
}))
vi.mock('../documentos/docPhotos', () => ({ saveDocPhoto: async () => {} }))
vi.mock('../../core/feedback', () => ({ beep: () => {} }))
vi.mock('../avisos/Notices', () => ({ useNotifyPick: () => ({ ids: [], names: [], el: null }), sendNotice: async () => '', itemsText: () => '' }))
vi.mock('../escaneo/ScanBox', () => ({ default: () => null }))
vi.mock('../../ui/NearPick', () => ({ default: () => null }))
vi.mock('../../ui/PhotoZoom', () => ({ default: () => null }))
vi.mock('../../ui/ToastContext', () => ({ useToast: () => () => {} }))
vi.mock('../../ui/ConfirmContext', () => ({ useConfirm: () => async () => true }))
vi.mock('../../ui/Sheet', () => ({
  default: ({ children }) => <div className="sheet">{children}</div>,
  SheetHeader: ({ title }) => <header><h2>{title}</h2></header>,
  useSheet: () => ({ close: () => {} }),
}))

const { default: RemisionSheet } = await import('./RemisionSheet')

let host
let root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  post.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const rows = () => [...host.querySelectorAll('.rem-size-place')]
const rowOf = (size) => rows().find((r) => r.querySelector('.sz')?.textContent === size)
const button = (text, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.includes(text))

describe('remisión: dónde queda cada talla', () => {
  it('cada talla dice a dónde va y dónde ya hay de ella', () => {
    act(() => root.render(<RemisionSheet onClose={() => {}} />))
    expect(host.textContent).toContain('Automática: cada talla donde ya hay de ella')
    expect(rows()).toHaveLength(3)
    // la S va a donde hay mas de la S, no a donde estan las otras tallas
    expect(rowOf('S').textContent).toContain('Canasta C-4-2')
    expect(rowOf('S').textContent).toContain('ahí hay 5 de esta talla')
    expect([...rowOf('S').querySelectorAll('.tcw-chip')].map((c) => c.textContent)).toEqual(['C-4-25', 'C-4-12'])
    expect(rowOf('M').textContent).toContain('Canasta C-9-9')
    // la L es nueva: va con las otras tallas y se avisa que se mezclan
    expect(rowOf('L').className).toContain('mix')
    expect(rowOf('L').textContent).toContain('ahí se mezclan')
  })

  it('se manda una talla a otra ubicación donde hay de ella, y al confirmar cada talla va a la suya', async () => {
    act(() => root.render(<RemisionSheet onClose={() => {}} />))
    act(() => button('C-4-1', rowOf('S')).click())
    expect(rowOf('S').textContent).toContain('Canasta C-4-1')
    expect(rowOf('S').textContent).toContain('la elegiste')
    expect(button('Volver a la automática', rowOf('S'))).toBeTruthy()
    await act(async () => button('Confirmar entrada de 6 prendas').click())
    const sent = post.mock.calls[0][1].lines.map((l) => [l.size, l.location_id])
    expect(sent).toEqual([['S', 'C-4-1'], ['M', 'C-9-9'], ['L', 'C-9-9']])
  })

  it('al repartir, tocar donde hay de esa talla llena la parte', () => {
    act(() => root.render(<RemisionSheet onClose={() => {}} />))
    act(() => button('Repartir en varias ubicaciones').click())
    const size = [...host.querySelectorAll('.rem-split-size')].find((s) => s.textContent.includes('Talla S'))
    expect(size.textContent).toContain('Quedan 3 → Canasta C-4-2')
    act(() => button('C-4-1', size).click())
    const part = [...host.querySelectorAll('.rem-split-size')].find((s) => s.textContent.includes('Talla S')).querySelector('.rem-part .lp-btn')
    expect(part.getAttribute('aria-label')).toContain('Canasta C-4-1')
  })
})
