// Motor 3D de la bodega, aislado de React: React le pasa datos (setLayout,
// setProducts) y escucha eventos (onTapLocation, onTapElement, onTapTag,
// onElementMoved). Los ids y nombres de cada ubicacion vienen siempre del
// backend (layout.elements[].locations), nunca se recalculan aqui, para que
// el 3D jamas se desincronice de la base de datos.
//
// Look "estudio": tono AgX (el mismo de Blender), luz de entorno, sombras
// suaves, oclusion ambiental (GTAO) y geometria con bordes redondeados. El
// cuarto es una maqueta en corte: las paredes que dan a la camara bajan solas.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

const BW = 0.42, BH = 0.3, BD = 0.42, PI = Math.PI
// hasta cuanto pueden estar corridos dos muebles y seguir siendo la misma pila
// (menos que una canasta: dos muebles uno al lado del otro no se juntan)
const STACK_GAP = 0.35
const SLAB = 0.16, WALL_H = 3.0, WALL_T = 0.12, WALL_STUB = 0.34
const LIME = 0xc0ff00, INK = 0x0b0b0b, AMBER = 0xe5690f
const PH_MIN = 0.02, PH_MAX = 1.42, R_MIN = 1.6, R_MAX = 40
const CAM_KEYS = ['th', 'ph', 'r', 'tx', 'ty', 'tz', 'ox', 'oy']
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const snap = (v) => Math.round(v * 20) / 20
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const hash = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) }
const ni = (g) => (g.index ? g.toNonIndexed() : g)
const RB = (w, h, d, r = 0.008, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))

// la entrada animada se ve una vez por sesion, no cada vez que se vuelve a la pestana
let introPlayed = false

const PRESETS = {
  all: { th: PI + 0.62, ph: 0.92 },
  plan: { th: 0, ph: PH_MIN },
}

const GARMENT = [
  [/CAMO/, 0x5f6352], [/AZUL|BLUE|NAVY/, 0x26355a], [/GRIS|GRAY|GREY|PLATA/, 0x50555a],
  [/ROJ|RED|VINO/, 0x8e2a24], [/BLANC|WHITE/, 0xd6d8d3], [/VERDE|GREEN|OLIV/, 0x4b5a37],
  [/NARANJA|ORANGE/, 0xc0581c], [/AMARILL|YELLOW|NEON|LIMA/, 0xb9d63a],
]
function garmentColor(name) {
  const n = (name || '').toUpperCase()
  for (const [re, c] of GARMENT) if (re.test(n)) return c
  return 0x1f2023
}

function roundRectPath(x, px, py, w, h, r) {
  x.beginPath()
  x.moveTo(px + r, py)
  x.arcTo(px + w, py, px + w, py + h, r)
  x.arcTo(px + w, py + h, px, py + h, r)
  x.arcTo(px, py + h, px, py, r)
  x.arcTo(px, py, px + w, py, r)
  x.closePath()
}

export class WarehouseScene {
  constructor(container, callbacks = {}) {
    this.container = container
    this.cb = callbacks
    this.layout = { room: { width: 8.4, depth: 7 }, elements: [] }
    this.products = []
    this.editMode = false
    this.selectedLocation = null
    this.selectedElement = null
    this.hoverLoc = null
    this.pulseUntil = 0
    this.dirty = true
    this.locObjs = {}
    this.elGroups = {}
    this.elInfo = {}
    this.elHits = []
    this.locHits = []
    this.walls = []
    this.tags = {}
    this.dragging = false
    this.introDone = false
    this.needsRefine = false
    this._disposed = false
    this._layoutSig = ''
    this._productsSig = ''
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 }
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.mobile = window.matchMedia('(pointer: coarse)').matches

    this._initThree()
    this._initPost()
    this._bindPointer()
    this._resizeObserver = new ResizeObserver(() => this._resize())
    this._resizeObserver.observe(container)
    this._resize()
    this._last = performance.now()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  // ---------- API publica ----------
  setLayout(layout) {
    const sig = JSON.stringify(layout)
    if (sig === this._layoutSig) return
    this._layoutSig = sig
    const prev = this.layout
    this.layout = layout
    // al editar cambian uno o dos muebles: se rehacen solo esos, no la bodega entera
    const changed = this.world ? this._changedElements(prev, layout) : null
    if (changed) this._patchWorld(changed)
    else this._buildWorld()
  }

  setProducts(products) {
    const sig = JSON.stringify(products)
    if (sig === this._productsSig) return
    this._productsSig = sig
    this.products = products
    this._updateFill()
  }

  setEditMode(on) {
    if (on === this.editMode) return
    this.editMode = on
    if (this.grid) this.grid.visible = on
    this.selectedElement = null
    this.selectedLocation = null
    this._hover(null)
    this._refreshSelection()
  }

  selectLocation(id) {
    this.selectedLocation = id
    this._refreshSelection(true)
  }

  selectElement(id) {
    this.selectedElement = id
    this._refreshSelection()
  }

  pulse() {
    this.pulseUntil = performance.now() + 2600
    this.dirty = true
  }

  getTheta() {
    return this.cam.th.x
  }

  applyPreset(name) {
    this.focusedEl = null
    this._refreshSelection()
    this._fly(this._presetGoal(name), 0.75)
  }

  focusElement(id) {
    const el = this.layout.elements.find((e) => e.id === id)
    const ids = (this.stackOf[id] || [el]).map((m) => m && m.id)
    const hits = this.elHits.filter((h) => ids.includes(h.userData.el))
    if (!el || !hits.length) return
    const box = new THREE.Box3()
    for (const h of hits) box.expandByObject(h)
    box.expandByVector(new THREE.Vector3(0.35, 0.25, 0.35))
    this.focusedEl = id
    this._refreshSelection()
    const t = box.getCenter(new THREE.Vector3())
    const th = (el.rot || 0) * (PI / 2), ph = 1.16
    this._fly({ th, ph, r: this._fitBox(box, th, ph, t), tx: t.x, ty: t.y, tz: t.z }, 0.7)
  }

  // Todas las ubicaciones de una prenda marcadas en lima a la vez (no solo
  // la elegida), cada una con cuantas hay ahi. list: [{ id, qty }]
  markLocations(list) {
    this.markList = list || []
    this._placeMarks()
    this._refreshSelection()
  }

  _placeMarks() {
    for (const m of this.marks) {
      this.overlay.remove(m.box, m.tag)
      m.tag.element.remove()
    }
    this.marks = []
    for (const { id, qty } of this.markList) {
      const o = this.locObjs[id]
      if (!o) continue
      const box = new THREE.Group()
      box.add(new THREE.Mesh(this._unitGeo, this.markFill), new LineSegments2(this._edgeGeo, this.lineMats[0]), new LineSegments2(this._edgeGeo, this.lineMats[1]))
      box.scale.set(o.size.x + 0.03, o.size.y + 0.03, o.size.z + 0.03)
      box.position.copy(o.center)
      const anchor = document.createElement('div')
      anchor.className = 'css2d-anchor'
      const chip = document.createElement('div')
      chip.className = 'loc-mark'
      const code = document.createElement('b')
      code.textContent = id
      const n = document.createElement('span')
      n.textContent = String(qty)
      chip.append(code, n)
      anchor.append(chip)
      const tag = new CSS2DObject(anchor)
      tag.position.set(o.center.x, o.center.y + o.size.y / 2 + 0.04, o.center.z)
      this.overlay.add(box, tag)
      this.marks.push({ box, tag })
    }
    this.dirty = true
  }

  // la camara encuadra todas las ubicaciones marcadas, desde donde se esta mirando
  focusLocations(ids) {
    const found = ids.filter((id) => this.locObjs[id])
    if (found.length < 2) {
      if (found.length) this.focusLocation(found[0])
      return
    }
    this.focusedEl = null
    const box = new THREE.Box3()
    for (const id of found) {
      const o = this.locObjs[id]
      const half = o.size.clone().multiplyScalar(0.5)
      box.expandByPoint(o.center.clone().sub(half))
      box.expandByPoint(o.center.clone().add(half))
    }
    box.expandByVector(new THREE.Vector3(0.45, 0.35, 0.45))
    const t = box.getCenter(new THREE.Vector3())
    const th = this.cam.th.g, ph = 0.95
    this._fly({ th, ph, r: this._fitBox(box, th, ph, t), tx: t.x, ty: t.y, tz: t.z }, 0.7)
  }

  focusLocation(id) {
    const o = this.locObjs[id]
    if (!o) return
    this.focusedEl = null
    const el = this.layout.elements.find((e) => e.id === o.elId)
    const half = o.size.clone().multiplyScalar(0.5).add(new THREE.Vector3(0.55, 0.4, 0.55))
    const box = new THREE.Box3(o.center.clone().sub(half), o.center.clone().add(half))
    const th = ((el && el.rot) || 0) * (PI / 2), ph = 1.16
    this._fly({ th, ph, r: this._fitBox(box, th, ph, o.center), tx: o.center.x, ty: o.center.y, tz: o.center.z }, 0.7)
  }

  // Zonas de la pantalla tapadas por la interfaz (buscador, dock, hojas): la
  // imagen se corre para que lo enfocado quede en el centro del area libre.
  setViewInsets({ top = 0, bottom = 0, left = 0, right = 0 } = {}) {
    this.insets = { top, bottom, left, right }
    this.cam.ox.g = (right - left) / 2
    this.cam.oy.g = (bottom - top) / 2
    this.camResp = Math.max(this.camResp, 0.45)
    this.dirty = true
  }

  dispose() {
    this._disposed = true
    cancelAnimationFrame(this._raf)
    this._resizeObserver.disconnect()
    this._clearWorld()
    this.composer?.dispose?.()
    this.gtao?.dispose?.()
    Object.values(this.tex).forEach((t) => t.dispose())
    this.renderer.dispose()
    this.container.innerHTML = ''
  }

  // ---------- inicializacion ----------
  _initThree() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 1.75))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.AgXToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    this.container.appendChild(renderer.domElement)

    const labels = new CSS2DRenderer()
    labels.domElement.className = 'scene-labels'
    this.container.appendChild(labels.domElement)
    this.labelRenderer = labels

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture
    pmrem.dispose()

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)

    scene.add(new THREE.HemisphereLight(0xf4f7ff, 0xcfc8b8, 0.55))
    const key = new THREE.DirectionalLight(0xfff0dc, 3.1)
    key.position.set(-4.5, 10, 6.5)
    key.castShadow = true
    key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.025
    key.shadow.camera.near = 1
    key.shadow.camera.far = 32
    scene.add(key, key.target)
    this.keyLight = key
    const fill = new THREE.DirectionalLight(0xe4edff, 0.5)
    fill.position.set(6, 5, -5)
    scene.add(fill)

    this._initTextures(renderer)
    this._initMaterials()
    this._initGeometries()

    // capa aparte, dibujada encima y sin tono de pelicula: la seleccion en
    // lima de la marca tiene que verse lima, no oliva
    const overlay = new THREE.Scene()
    this.overlay = overlay
    const unit = new THREE.BoxGeometry(1, 1, 1)
    const edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(unit))
    const lineMat = (color, linewidth, opacity = 1) => {
      const m = new LineMaterial({ color, linewidth, transparent: true, opacity, depthTest: false })
      m.toneMapped = false
      return m
    }
    this.lineMats = [lineMat(INK, 5.5, 0.9), lineMat(LIME, 2.6), lineMat(LIME, 2, 0.9)]
    const sel = new THREE.Group()
    const selFill = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, toneMapped: false }))
    sel.add(selFill, new LineSegments2(edges, this.lineMats[0]), new LineSegments2(edges, this.lineMats[1]))
    sel.visible = false
    overlay.add(sel)
    this.sel = sel
    this.selFill = selFill
    // marcas de "todas las ubicaciones de una prenda": las mismas cajas lima
    this._unitGeo = unit
    this._edgeGeo = edges
    this.markFill = new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false, toneMapped: false })
    this.marks = []
    this.markList = []
    const hover = new LineSegments2(edges, this.lineMats[2])
    hover.visible = false
    overlay.add(hover)
    this.hoverBox = hover

    const pinEl = document.createElement('div')
    pinEl.className = 'css2d-anchor'
    pinEl.innerHTML = '<div class="loc-pin"><span><i></i><b></b></span></div>'
    this.pinInner = pinEl.firstChild
    this.pin = new CSS2DObject(pinEl)
    this.pin.visible = false
    overlay.add(this.pin)

    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.ray = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const p0 = { th: 0.62, ph: 0.98, r: 18, tx: 0, ty: 0.45, tz: 0, ox: 0, oy: 0 }
    this.cam = Object.fromEntries(CAM_KEYS.map((k) => [k, { x: p0[k], v: 0, g: p0[k] }]))
    this.camResp = 0.7
    this._m4 = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._s = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._col = new THREE.Color()
  }

  _initPost() {
    // Oclusion ambiental solo en computador: en celular costaba demasiado y
    // hacia lento todo lo demas (las sombras de contacto bastan ahi).
    if (this.mobile) {
      this.composer = null
      this.gtao = null
      return
    }
    try {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
      const rt = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: 4 })
      const composer = new EffectComposer(this.renderer, rt)
      composer.addPass(new RenderPass(this.scene, this.camera))
      const gtao = new GTAOPass(this.scene, this.camera, size.x || 1, size.y || 1)
      gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.4, scale: 1.35, samples: this.mobile ? 12 : 16, distanceFallOff: 1 })
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 })
      gtao.blendIntensity = 1
      const hideFromAO = gtao.overrideVisibility.bind(gtao)
      gtao.overrideVisibility = () => {
        hideFromAO()
        this.scene.traverse((o) => { if (o.userData.noAO) o.visible = false })
      }
      composer.addPass(gtao)
      composer.addPass(new OutputPass())
      this.composer = composer
      this.gtao = gtao
    } catch {
      this.composer = null
      this.gtao = null
    }
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.labelRenderer.setSize(w, h)
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(w, h)
    }
    for (const m of this.lineMats) m.resolution.set(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // ---------- texturas generadas (sin imagenes externas) ----------
  _canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d'), w, h)
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = this.renderer ? this.renderer.capabilities.getMaxAnisotropy() : 8
    return t
  }

  _initTextures(renderer) {
    const aniso = renderer.capabilities.getMaxAnisotropy()
    const concrete = this._canvasTex(1024, 1024, (x, w, h) => {
      x.fillStyle = '#c3c6be'
      x.fillRect(0, 0, w, h)
      for (let i = 0; i < 60; i++) {
        const r = 70 + Math.random() * 200, cx = Math.random() * w, cy = Math.random() * h
        const tone = Math.random() < 0.5 ? '255,255,255' : '146,150,142'
        const a = 0.04 + Math.random() * 0.06
        for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
          const g = x.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r)
          g.addColorStop(0, `rgba(${tone},${a})`)
          g.addColorStop(1, `rgba(${tone},0)`)
          x.fillStyle = g
          x.fillRect(cx + dx - r, cy + dy - r, r * 2, r * 2)
        }
      }
      for (let i = 0; i < 12000; i++) {
        const v = (150 + Math.random() * 90) | 0
        x.fillStyle = `rgba(${v},${v},${v - 4},${0.05 + Math.random() * 0.1})`
        const s = 0.6 + Math.random() * 1.6
        x.fillRect(Math.random() * w, Math.random() * h, s, s)
      }
      x.strokeStyle = 'rgba(118,122,116,.32)'
      x.lineWidth = 2
      x.beginPath()
      x.moveTo(0, h / 2); x.lineTo(w, h / 2)
      x.moveTo(w / 2, 0); x.lineTo(w / 2, h)
      x.stroke()
    }, { repeat: true })
    concrete.anisotropy = aniso

    const slots = this._canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, w, h)
      x.globalCompositeOperation = 'destination-out'
      const cols = 6, rows = 3, top = h * 0.26, bot = h * 0.9, gap = w * 0.045
      const cw = (w - gap * (cols + 1)) / cols, rh = (bot - top - gap * (rows - 1)) / rows
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        roundRectPath(x, gap + c * (cw + gap), top + r * (rh + gap), cw, rh, 7)
        x.fill()
      }
      roundRectPath(x, w * 0.34, h * 0.07, w * 0.32, h * 0.1, 12)
      x.fill()
      x.globalCompositeOperation = 'source-over'
    })

    const S = 128
    const blur = this._canvasTex(S, S, (x) => {
      const img = x.createImageData(S, S)
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const u = Math.abs(((i + 0.5) / S) * 2 - 1), v = Math.abs(((j + 0.5) / S) * 2 - 1)
        const d = Math.pow(u ** 4 + v ** 4, 0.25)
        const t = clamp((d - 0.45) / 0.55, 0, 1)
        const a = 1 - t * t * (3 - 2 * t)
        const k = (j * S + i) * 4
        img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255)
        img.data[k + 3] = 255
      }
      x.putImageData(img, 0, 0)
    }, { srgb: false })

    const cardboard = this._canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#b98b57'
      x.fillRect(0, 0, w, h)
      x.strokeStyle = 'rgba(120,84,42,.3)'
      for (let y = 6; y < h; y += 7) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke() }
      x.fillStyle = 'rgba(214,193,150,.9)'
      x.fillRect(0, 112, w, 30)
    })

    this.tex = { concrete, slots, blur, cardboard }
  }

  _initMaterials() {
    const S = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, envMapIntensity: 0.7, ...o })
    this.mat = {
      floor: S(0xffffff, { map: this.tex.concrete, roughness: 0.72, envMapIntensity: 0.55 }),
      slab: S(0xc9ccc4, { roughness: 0.9 }),
      wall: S(0xecece6, { roughness: 0.95, envMapIntensity: 0.45 }),
      cap: S(0x1b1c1b, { roughness: 0.7 }),
      bin: S(0x1d1e20, { roughness: 0.48, envMapIntensity: 0.9 }),
      panel: S(0x2c2e31, { roughness: 0.7 }),
      rack: S(0xf2b705, { roughness: 0.36, metalness: 0.35, envMapIntensity: 1.1 }),
      steel: S(0x26272a, { roughness: 0.42, metalness: 0.55, envMapIntensity: 1 }),
      garment: S(0xffffff, { roughness: 0.88, envMapIntensity: 0.45 }),
      hanger: S(0xb8ec00, { roughness: 0.42, envMapIntensity: 0.8 }),
      crate: S(0x6b7177, { map: this.tex.slots, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62 }),
      crateRim: S(0x6b7177, { roughness: 0.6 }),
      table: S(0xf5f5f1, { roughness: 0.32, envMapIntensity: 0.8 }),
      kraft: S(0xffffff, { map: this.tex.cardboard, roughness: 0.92 }),
      amber: S(AMBER, { roughness: 0.4, emissive: 0x6a2a00, emissiveIntensity: 0.6 }),
      white: S(0xffffff, { roughness: 0.6 }),
      balloonRed: S(0xd23a2a, { roughness: 0.35 }),
      balloonBlack: S(0x222326, { roughness: 0.35 }),
      string: new THREE.MeshBasicMaterial({ color: 0xcccccc }),
      decal: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: this.tex.blur, transparent: true, opacity: 0.42, depthWrite: false }),
    }
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false })
  }

  _initGeometries() {
    // gaveta abierta al frente: fondo, espalda, dos costados en rampa y labio
    const t = 0.014
    const side = (() => {
      const s = new THREE.Shape()
      s.moveTo(-BD / 2, 0)
      s.lineTo(BD / 2, 0)
      s.lineTo(BD / 2, BH * 0.42)
      s.lineTo(-BD / 2, BH * 0.94)
      s.closePath()
      const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false })
      g.rotateY(-PI / 2)
      return g
    })()
    const parts = [
      RB(BW * 0.94, 0.02, BD, 0.006).translate(0, 0.01, 0),
      RB(BW * 0.94, BH * 0.94, 0.02, 0.006).translate(0, BH * 0.47, -BD / 2 + 0.01),
      RB(BW * 0.94, BH * 0.42, 0.02, 0.006).translate(0, BH * 0.21, BD / 2 - 0.01),
      side.clone().translate(-BW * 0.47 + t, 0, 0),
      side.clone().translate(BW * 0.47, 0, 0),
    ].map(ni)
    parts.forEach((g) => g.deleteAttribute('uv'))
    this.geo = { bin: mergeGeometries(parts) }

    // canasta plastica suelta: paredes caladas (alphaTest) + borde solido
    const cw = BW * 0.9, ch = BH * 0.84, cd = BD * 0.88
    const wall = (w, rotY, x, z) => {
      const g = new THREE.PlaneGeometry(w, ch)
      g.rotateY(rotY)
      g.translate(x, ch / 2, z)
      return g
    }
    const bottom = new THREE.PlaneGeometry(cw, cd).rotateX(-PI / 2).translate(0, 0.004, 0)
    this.geo.crate = mergeGeometries([
      wall(cw, 0, 0, cd / 2), wall(cw, PI, 0, -cd / 2), wall(cd, PI / 2, cw / 2, 0), wall(cd, -PI / 2, -cw / 2, 0), bottom,
    ])
    const rimT = 0.016
    this.geo.crateRim = mergeGeometries([
      RB(cw + rimT, rimT, rimT, 0.005).translate(0, ch, cd / 2),
      RB(cw + rimT, rimT, rimT, 0.005).translate(0, ch, -cd / 2),
      RB(rimT, rimT, cd, 0.005).translate(cw / 2, ch, 0),
      RB(rimT, rimT, cd, 0.005).translate(-cw / 2, ch, 0),
    ].map(ni))

    this.geo.fold = RB(0.3, 0.05, 0.27, 0.016)

    // chaqueta colgada: silueta de frente extruida, mirando a lo largo de z
    const s = new THREE.Shape()
    s.moveTo(-0.06, 0)
    s.lineTo(-0.17, -0.03)
    s.quadraticCurveTo(-0.215, -0.045, -0.222, -0.1)
    s.lineTo(-0.234, -0.5)
    s.lineTo(-0.186, -0.515)
    s.lineTo(-0.172, -0.47)
    s.lineTo(-0.165, -0.6)
    s.quadraticCurveTo(0, -0.628, 0.165, -0.6)
    s.lineTo(0.172, -0.47)
    s.lineTo(0.186, -0.515)
    s.lineTo(0.234, -0.5)
    s.lineTo(0.222, -0.1)
    s.quadraticCurveTo(0.215, -0.045, 0.17, -0.03)
    s.lineTo(0.06, 0)
    s.quadraticCurveTo(0, -0.07, -0.06, 0)
    const jacket = new THREE.ExtrudeGeometry(s, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.008, bevelSegments: 2, curveSegments: 5 })
    jacket.translate(0, 0, -0.018)
    jacket.rotateY(PI / 2)
    this.geo.jacket = jacket

    const hook = new THREE.TorusGeometry(0.024, 0.0045, 6, 14, PI * 1.35)
    hook.rotateZ(-PI * 0.18)
    hook.rotateY(PI / 2)
    hook.translate(0, 0.01, 0)
    const bar = RB(0.014, 0.016, 0.4, 0.006)
    bar.translate(0, -0.055, 0)
    const neck = new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6).translate(0, -0.03, 0)
    this.geo.hanger = mergeGeometries([ni(hook), ni(bar), ni(neck)].map((g) => { g.deleteAttribute('uv'); return g }))
  }

  // ---------- utilidades de construccion ----------
  _mk(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    parent.add(m)
    return m
  }

  _inst(geo, mat, count, parent) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count))
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    parent.add(m)
    return m
  }

  _setI(im, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
    this._e.set(0, ry, 0)
    this._q.setFromEuler(this._e)
    this._s.set(sx, sy, sz)
    this._p.set(x, y, z)
    this._m4.compose(this._p, this._q, this._s)
    im.setMatrixAt(i, this._m4)
  }

  _hide(im, i) {
    this._m4.makeScale(0, 0, 0)
    im.setMatrixAt(i, this._m4)
  }

  _locHit(parent, id, w, h, d, x, y, z) {
    const m = this._mk(new THREE.BoxGeometry(w, h, d), this.hitMat, x, y, z, parent)
    m.userData.loc = id
    this.locHits.push(m)
    return m
  }

  _decal(parent, w, d, opacity = 0.42) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.mat.decal)
    m.rotation.x = -PI / 2
    m.position.y = 0.003
    m.renderOrder = 1
    m.userData.noAO = true
    m.userData.noShadow = true
    if (opacity !== 0.42) {
      m.material = this.mat.decal.clone()
      m.material.opacity = opacity
      m.material.userData.temp = true
    }
    parent.add(m)
    return m
  }

  // etiquetas impresas de cada canasta (C-1-3...), en una sola textura
  _labelMesh(el, cells, w, h, grid = el.params) {
    const { cols, rows } = grid
    const cw = 128, chh = 44
    const tex = this._canvasTex(cols * cw, rows * chh, (x) => {
      x.font = '600 25px ui-monospace, "SF Mono", Menlo, Consolas, monospace'
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) {
        const px = (c - 1) * cw, py = (r - 1) * chh
        x.fillStyle = '#ffffff'
        roundRectPath(x, px + 3, py + 3, cw - 6, chh - 6, 6)
        x.fill()
        x.fillStyle = '#121212'
        x.fillText(`${el.code}-${r}-${c}`, px + cw / 2, py + chh / 2 + 1)
      }
    })
    tex.userData = { temp: true }
    const n = cells.length
    const pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 12), idx = []
    cells.forEach((cell, i) => {
      const { x, y, z, r, c, back } = cell
      const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      corners.forEach(([dx, dy], k) => {
        pos.set([x + (back ? -dx : dx), y + dy, z], i * 12 + k * 3)
        col.set([1, 1, 1], i * 12 + k * 3)
      })
      const u0 = (c - 1) / cols, u1 = c / cols, v1 = 1 - (r - 1) / rows, v0 = 1 - r / rows
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8)
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true })
    m.userData.temp = true
    const mesh = new THREE.Mesh(g, m)
    mesh.userData.noShadow = true
    return mesh
  }

  // ---------- muebles ----------
  _buildBins(el, g) {
    const { cols, rows } = el.params, n = cols * rows, mat = this.mat
    const y0 = el.y0 || 0
    // una sola fila (G/H/I) son canastas plasticas sueltas sobre una viga;
    // varias filas (C/F) son la pared de gavetas negras empotradas
    const crate = rows === 1
    const W = cols * BW, H = rows * BH
    const base = crate ? y0 + 0.05 : y0
    if (crate) {
      this._mk(RB(W + 0.08, 0.05, BD + 0.06, 0.01), mat.rack, 0, y0 + 0.025, 0, g)
      if (y0 > 0.05) {
        const post = RB(0.04, y0 + 0.05, 0.04, 0.006)
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._mk(post, mat.steel, sx * (W / 2 + 0.02), (y0 + 0.05) / 2, sz * (BD / 2 + 0.01), g)
      }
    } else {
      this._mk(RB(W + 0.05, H + 0.05, 0.025, 0.006), mat.panel, 0, y0 + H / 2, -BD / 2 - 0.016, g)
    }
    const shell = this._inst(crate ? this.geo.crate : this.geo.bin, crate ? mat.crate : mat.bin, n, g)
    const rim = crate ? this._inst(this.geo.crateRim, mat.crateRim, n, g) : null
    const folds = this._inst(this.geo.fold, mat.garment, n * 4, g)
    const cells = []
    const locs = []
    let i = 0
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const x = -W / 2 + BW / 2 + (c - 1) * BW
        const y = base + (rows - r) * BH
        this._setI(shell, i, x, y, 0)
        if (rim) this._setI(rim, i, x, y, 0)
        for (let l = 0; l < 4; l++) {
          this._hide(folds, i * 4 + l)
          folds.setColorAt(i * 4 + l, this._col.setHex(0x222326))
        }
        cells.push({ x, y: y + (crate ? BH * 0.5 : BH * 0.21), z: crate ? BD * 0.44 + 0.004 : BD / 2 + 0.003, r, c })
        const loc = el.locations[i]
        if (loc) {
          this._locHit(g, loc.id, BW, BH, BD, x, y + BH / 2, 0)
          locs.push({ id: loc.id, kind: 'bin', c: new THREE.Vector3(x, y + BH / 2, 0), s: new THREE.Vector3(BW, BH, BD), i, x, y, crate, folds })
        }
        i++
      }
    }
    const labels = this._labelMesh(el, cells, crate ? 0.15 : 0.13, crate ? 0.05 : 0.045)
    g.add(labels)
    for (const L of locs) L.labels = labels
    return { w: W, h: (base - y0) + H + 0.02, d: BD, locs }
  }

  _buildShelf(el, g) {
    const W = el.params.w, L = el.params.levels, D = 0.6, H = 2.45, sp = (H - 0.35) / L, mat = this.mat
    const post = RB(0.05, H, 0.05, 0.008)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._mk(post, mat.steel, sx * (W / 2 - 0.03), H / 2, sz * (D / 2 - 0.03), g)
    const beam = RB(W, 0.07, 0.045, 0.008), deck = RB(W - 0.04, 0.02, D - 0.04, 0.005)
    const n = Math.max(1, Math.floor((W - 0.06) / 0.5))
    const crates = this._inst(this.geo.crate, mat.crate, n * L, g)
    const rims = this._inst(this.geo.crateRim, mat.crateRim, n * L, g)
    const folds = this._inst(this.geo.fold, mat.garment, n * L, g)
    const locs = []
    for (let i = 1; i <= L; i++) {
      const y = 0.1 + (i - 1) * sp
      this._mk(beam, mat.rack, 0, y, D / 2, g)
      this._mk(beam, mat.rack, 0, y, -D / 2, g)
      this._mk(deck, mat.panel, 0, y + 0.045, 0, g)
      for (let j = 0; j < n; j++) {
        const k = (i - 1) * n + j, x = -((n - 1) / 2) * 0.5 + j * 0.5
        this._setI(crates, k, x, y + 0.055, 0, 1.1, 1, 1.25)
        this._setI(rims, k, x, y + 0.055, 0, 1.1, 1, 1.25)
        this._hide(folds, k)
      }
      const marker = this._mk(new THREE.SphereGeometry(0.035, 14, 10), mat.amber, -W / 2 - 0.06, y + 0.12, D / 2, g)
      marker.visible = false
      const loc = el.locations[i - 1]
      if (loc) {
        this._locHit(g, loc.id, W, sp * 0.9, D, 0, y + sp * 0.45, 0)
        locs.push({ id: loc.id, kind: 'shelf', c: new THREE.Vector3(0, y + sp * 0.45, 0), s: new THREE.Vector3(W, sp * 0.9, D), folds, start: (i - 1) * n, n, y, marker })
      }
    }
    this._mk(beam, mat.rack, 0, H - 0.04, D / 2, g)
    this._mk(beam, mat.rack, 0, H - 0.04, -D / 2, g)
    return { w: W, h: H, d: D, locs }
  }

  _buildRack(el, g) {
    const W = el.params.w, bars = el.params.bars, mat = this.mat
    const sp = bars > 1 ? Math.min(0.7, 1.95 / (bars - 1)) : 0
    const cap = Math.max(1, Math.floor((W - 0.1) / 0.066))
    const post = RB(0.05, 2.95, 0.05, 0.008), foot = RB(0.06, 0.04, 0.62, 0.012)
    for (const sx of [-1, 1]) {
      this._mk(post, mat.steel, sx * (W / 2 + 0.05), 1.475, 0, g)
      this._mk(foot, mat.steel, sx * (W / 2 + 0.05), 0.02, 0, g)
    }
    this._mk(RB(W + 0.16, 0.06, 0.07, 0.01), mat.rack, 0, 2.93, 0, g)
    const rodG = new THREE.CylinderGeometry(0.019, 0.019, W + 0.1, 18).rotateZ(PI / 2)
    const br = RB(0.1, 0.08, 0.06, 0.01)
    const locs = []
    for (let i = 1; i <= bars; i++) {
      const y = 2.7 - (i - 1) * sp
      this._mk(rodG, mat.rack, 0, y, 0, g)
      for (const sx of [-1, 1]) this._mk(br, mat.rack, sx * (W / 2 + 0.05), y, 0, g)
      const jk = this._inst(this.geo.jacket, mat.garment, cap, g)
      const hg = this._inst(this.geo.hanger, mat.hanger, cap, g)
      jk.count = hg.count = 0
      const marker = this._mk(new THREE.SphereGeometry(0.035, 14, 10), mat.amber, -W / 2 - 0.16, y, 0, g)
      marker.visible = false
      const loc = el.locations[i - 1]
      if (loc) {
        this._locHit(g, loc.id, W, 0.66, 0.5, 0, y - 0.34, 0)
        locs.push({ id: loc.id, kind: 'rod', c: new THREE.Vector3(0, y - 0.34, 0), s: new THREE.Vector3(W, 0.66, 0.5), jk, hg, cap, x0: -W / 2, y, marker })
      }
    }
    return { w: W + 0.2, h: 2.96, d: 0.62, locs }
  }

  _buildBoxes(el, g) {
    // "count" cajas en pilas de "levels" una encima de otra: el mueble crece a
    // lo ancho (mas pilas) y a lo alto (mas pisos), y va a su altura (y0)
    const n = clamp(Math.round(el.params.count || 1), 1, 40)
    const levels = clamp(Math.round(el.params.levels || 2), 1, 6)
    const piles = Math.ceil(n / levels), pitch = 0.64, BOX = 0.48, W = piles * pitch, y0 = el.y0 || 0, mat = this.mat
    const boxes = this._inst(RB(0.6, BOX, 0.45, 0.012), mat.kraft, n, g)
    for (let i = 0; i < n; i++) {
      const pile = Math.floor(i / levels), lvl = i % levels
      const x = -((piles - 1) / 2) * pitch + pile * pitch
      // las de arriba un poco corridas, como se apilan a mano
      const jx = lvl ? (hash(i) - 0.5) * 0.05 : 0, jz = lvl ? (hash(i + 7) - 0.5) * 0.03 : 0
      this._setI(boxes, i, x + jx, y0 + BOX / 2 + lvl * (BOX + 0.005), jz)
    }
    const H = Math.min(levels, n) * (BOX + 0.005)
    const marker = this._mk(new THREE.SphereGeometry(0.04, 14, 10), mat.amber, 0, y0 + H + 0.06, 0, g)
    marker.visible = false
    const loc = el.locations[0]
    const locs = []
    if (loc) {
      this._locHit(g, loc.id, W, H, 0.5, 0, y0 + H / 2, 0)
      locs.push({ id: loc.id, kind: 'boxes', c: new THREE.Vector3(0, y0 + H / 2, 0), s: new THREE.Vector3(W, H, 0.5), marker })
    }
    return { w: W, h: H, d: 0.5, locs }
  }

  _buildTable(el, g) {
    // mesa de despacho real: sin patas, apoyada sobre pilas de canastas. Si
    // esas canastas guardan prendas, cada una es una ubicacion (M-1-1...)
    const W = el.params.w, D = 1.2, mat = this.mat
    this._mk(RB(W, 0.045, D, 0.014), mat.table, 0, 0.955, 0, g)
    // el nivel y la pila de cada canasta vienen del backend (table_slots)
    const slots = (el.locations || []).filter((l) => l.level && l.pile)
    if (slots.length) return this._buildTableBins(el, g, slots, W, D)
    const cw = BW, cd = BD, ch = BH * 0.98, stack = 3
    const cols = Math.max(1, Math.floor((W - 0.06) / cw))
    const rows = Math.max(1, Math.floor((D - 0.06) / cd))
    const crates = this._inst(this.geo.crate, mat.crate, cols * rows * stack, g)
    const rims = this._inst(this.geo.crateRim, mat.crateRim, cols * rows * stack, g)
    let k = 0
    for (let cx = 0; cx < cols; cx++) {
      for (let cz = 0; cz < rows; cz++) {
        const x = -((cols - 1) / 2) * cw + cx * cw, z = -((rows - 1) / 2) * cd + cz * cd
        for (let s = 0; s < stack; s++) {
          this._setI(crates, k, x, 0.004 + s * ch, z)
          this._setI(rims, k, x, 0.004 + s * ch, z)
          k++
        }
      }
    }
    return { w: W, h: 0.98, d: D, locs: [] }
  }

  _buildTableBins(el, g, slots, W, D) {
    const mat = this.mat, ch = BH * 0.98
    const levels = Math.max(...slots.map((l) => l.level))
    const piles = Math.max(...slots.map((l) => l.pile))
    // la mitad de las pilas al frente y la otra mitad atras
    const front = piles > 1 ? Math.ceil(piles / 2) : 1
    const back = piles - front
    const spot = (pile) => {
      const isBack = pile > front
      const row = isBack ? back : front
      const j = isBack ? pile - front - 1 : pile - 1
      return { x: -((row - 1) / 2) * BW + j * BW, z: back ? (isBack ? -BD / 2 : BD / 2) : 0, isBack }
    }
    const crates = this._inst(this.geo.crate, mat.crate, slots.length, g)
    const rims = this._inst(this.geo.crateRim, mat.crateRim, slots.length, g)
    const folds = this._inst(this.geo.fold, mat.garment, slots.length * 4, g)
    const cells = []
    const locs = []
    slots.forEach((loc, i) => {
      const { level, pile } = loc
      const { x, z, isBack } = spot(pile)
      const y = 0.004 + (levels - level) * ch
      this._setI(crates, i, x, y, z)
      this._setI(rims, i, x, y, z)
      for (let l = 0; l < 4; l++) {
        this._hide(folds, i * 4 + l)
        folds.setColorAt(i * 4 + l, this._col.setHex(0x222326))
      }
      // la etiqueta va en la cara que se ve: adelante o atras
      cells.push({ x, y: y + BH * 0.5, z: isBack ? z - BD * 0.44 - 0.004 : z + BD * 0.44 + 0.004, r: level, c: pile, back: isBack })
      this._locHit(g, loc.id, BW, BH, BD, x, y + BH / 2, z)
      locs.push({ id: loc.id, kind: 'bin', c: new THREE.Vector3(x, y + BH / 2, z), s: new THREE.Vector3(BW, BH, BD), i, x, y, z, crate: true, folds })
    })
    const labels = this._labelMesh(el, cells, 0.15, 0.05, { cols: piles, rows: levels })
    g.add(labels)
    for (const L of locs) L.labels = labels
    return { w: Math.max(W, front * BW), h: 0.98, d: D, locs }
  }

  _buildLadder(el, g) {
    const mat = this.mat, rail = RB(0.035, 1.15, 0.035, 0.006)
    for (const sx of [-1, 1]) {
      const a = this._mk(rail, mat.steel, sx * 0.2, 0.56, 0.12, g); a.rotation.x = -0.22
      const b = this._mk(rail, mat.steel, sx * 0.2, 0.56, -0.14, g); b.rotation.x = 0.25
    }
    const st = RB(0.42, 0.03, 0.13, 0.006)
    ;[0.3, 0.6, 0.88].forEach((y, i) => this._mk(st, mat.table, 0, y, 0.2 - i * 0.065, g))
    this._mk(RB(0.44, 0.04, 0.24, 0.008), mat.table, 0, 1.12, -0.01, g)
    return { w: 0.5, h: 1.15, d: 0.62, locs: [] }
  }

  _buildBalloons(el, g) {
    const mat = this.mat, sph = new THREE.SphereGeometry(0.17, 24, 16)
    this._mk(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24), mat.steel, 0, 0.015, 0, g)
    ;[[0, 1.95, 0, mat.balloonRed], [-0.24, 1.72, 0.08, mat.balloonBlack], [0.02, 1.55, 0.18, mat.balloonRed], [0.24, 1.62, 0.02, mat.balloonRed]].forEach(([x, y, z, m]) => {
      this._mk(sph, m, x, y, z, g)
      this._mk(new THREE.CylinderGeometry(0.004, 0.004, y - 0.17), mat.string, x / 2, (y - 0.17) / 2, z / 2, g)
    })
    return { w: 0.7, h: 2.12, d: 0.6, locs: [] }
  }

  _buildElement(el, g) {
    switch (el.type) {
      case 'bins': return this._buildBins(el, g)
      case 'shelf': return this._buildShelf(el, g)
      case 'rack': return this._buildRack(el, g)
      case 'boxes': return this._buildBoxes(el, g)
      case 'table': return this._buildTable(el, g)
      case 'ladder': return this._buildLadder(el, g)
      case 'balloons': return this._buildBalloons(el, g)
      default: return { w: 0.5, h: 0.5, d: 0.5, locs: [] }
    }
  }

  // ---------- mundo ----------
  _clearWorld() {
    if (!this.world) return
    this.scene.remove(this.world)
    this._disposeTree(this.world)
    this.world = null
  }

  // libera lo que no se comparte (geometrias propias, texturas de etiquetas)
  // y quita del DOM las etiquetas flotantes
  _disposeTree(root) {
    root.traverse((o) => {
      if (o.isCSS2DObject) o.element.remove()
      if (o.geometry && !Object.values(this.geo).includes(o.geometry)) o.geometry.dispose()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of mats) {
        if (!m.userData.temp) continue
        if (m.map?.userData?.temp) m.map.dispose()
        m.dispose()
      }
    })
  }

  // muebles apilados en el mismo sitio (G/H/I, o cajas encima de canastas)
  // comparten una sola etiqueta: id -> la pila, el de mas arriba primero.
  // Siguen siendo la misma pila aunque al editar uno quede corrido unos
  // centimetros o girado media vuelta (antes eso partia la etiqueta en dos)
  _stacks(elements) {
    const list = elements.filter((el) => ['bins', 'shelf', 'boxes'].includes(el.type) && el.code)
    const root = new Map(list.map((el) => [el.id, el.id]))
    const find = (id) => { while (root.get(id) !== id) id = root.get(id); return id }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j]
        if ((a.rot || 0) % 2 !== (b.rot || 0) % 2) continue
        if (Math.abs(a.x - b.x) <= STACK_GAP && Math.abs(a.z - b.z) <= STACK_GAP) root.set(find(a.id), find(b.id))
      }
    }
    const piles = new Map()
    for (const el of list) {
      const k = find(el.id)
      if (!piles.has(k)) piles.set(k, [])
      piles.get(k).push(el)
    }
    const out = {}
    for (const pile of piles.values()) {
      if (pile.length < 2) continue
      pile.sort((a, b) => (b.y0 || 0) - (a.y0 || 0))
      for (const el of pile) out[el.id] = pile
    }
    return out
  }

  _stackSig(elements) {
    return [...new Set(Object.values(this._stacks(elements)).map((l) => l.map((e) => e.id).join(',')))].sort().join('|')
  }

  // los muebles que cambiaron, o null si hay que rehacer todo: cambio el
  // cuarto, se agrego o se quito un mueble, o cambio cuales van apilados
  _changedElements(prev, next) {
    if (prev.room.width !== next.room.width || prev.room.depth !== next.room.depth) return null
    if (prev.elements.length !== next.elements.length) return null
    const before = new Map(prev.elements.map((e) => [e.id, JSON.stringify(e)]))
    const ids = []
    for (const el of next.elements) {
      const old = before.get(el.id)
      if (old === undefined) return null
      if (old !== JSON.stringify(el)) ids.push(el.id)
    }
    if (ids.length && this._stackSig(prev.elements) !== this._stackSig(next.elements)) return null
    return ids
  }

  _patchWorld(ids) {
    this.stackOf = this._stacks(this.layout.elements)
    // los de una misma pila comparten etiqueta: se rehacen juntos
    const redo = new Set()
    for (const id of ids) for (const m of this.stackOf[id] || [{ id }]) redo.add(m.id)
    for (const id of redo) this._removeElement(id)
    this.layout.elements.forEach((el, idx) => { if (redo.has(el.id)) this._addElement(el, idx, false) })
    this._updateFill(true)
    if (this.selectedLocation && !this.locObjs[this.selectedLocation]) this.selectedLocation = null
    if (this.selectedElement && !this.elInfo[this.selectedElement]) this.selectedElement = null
    this._placeMarks()
    this._refreshSelection()
    this.renderer.shadowMap.needsUpdate = true
    this.dirty = true
  }

  _removeElement(id) {
    const g = this.elGroups[id]
    if (!g) return
    const mine = new Set()
    g.traverse((o) => mine.add(o))
    this.world.remove(g)
    this._disposeTree(g)
    this.elHits = this.elHits.filter((h) => !mine.has(h))
    this.locHits = this.locHits.filter((h) => !mine.has(h))
    for (const [loc, L] of Object.entries(this.locObjs)) if (L.elId === id) delete this.locObjs[loc]
    for (const [k, t] of Object.entries(this.tags)) if (t.members.includes(id)) delete this.tags[k]
    delete this.elGroups[id]
    delete this.elInfo[id]
  }

  _addElement(el, idx, runIntro) {
    const world = this.world
    const g = new THREE.Group()
    g.position.set(el.x, 0, el.z)
    g.rotation.y = (el.rot || 0) * (PI / 2)
    world.add(g)
    this.elGroups[el.id] = g
    const info = this._buildElement(el, g)
    const y0 = el.y0 || 0
    g.traverse((o) => {
      if (o.isMesh && o.material !== this.hitMat && !o.userData.noShadow) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    if (y0 < 0.05 && el.type !== 'balloons') this._decal(g, info.w + 0.3, info.d + 0.3)
    const hit = this._mk(new THREE.BoxGeometry(Math.max(info.w, 0.3), info.h, Math.max(info.d, 0.3)), this.hitMat, 0, y0 + info.h / 2, 0, g)
    hit.userData.el = el.id
    this.elHits.push(hit)
    this.elInfo[el.id] = { w: info.w, h: info.h, d: info.d, y0 }
    world.updateMatrixWorld(true)
    const odd = (el.rot || 0) % 2 === 1
    for (const L of info.locs) {
      L.center = g.localToWorld(L.c.clone())
      L.size = odd ? new THREE.Vector3(L.s.z, L.s.y, L.s.x) : L.s.clone()
      L.elId = el.id
      this.locObjs[L.id] = L
    }
    if (el.code && (['bins', 'shelf', 'rack', 'boxes'].includes(el.type) || info.locs.length)) this._addTag(el, g, info)
    if (runIntro) {
      g.scale.y = 0.001
      g.userData.introDelay = idx * 70
    }
  }

  _buildWorld() {
    this._clearWorld()
    const world = new THREE.Group()
    this.world = world
    this.scene.add(world)
    this.locObjs = {}; this.locHits = []; this.elHits = []; this.elGroups = {}; this.elInfo = {}; this.walls = []; this.tags = {}

    const { width: W, depth: D } = this.layout.room, mat = this.mat
    const floor = this._mk(new THREE.PlaneGeometry(W, D), mat.floor, 0, 0, 0, world)
    floor.rotation.x = -PI / 2
    floor.receiveShadow = true
    floor.userData.noShadow = true
    mat.floor.map.repeat.set(W / 2.2, D / 2.2)
    const slab = this._mk(RB(W + WALL_T * 2, SLAB, D + WALL_T * 2, 0.02), mat.slab, 0, -SLAB / 2 - 0.002, 0, world)
    slab.userData.noShadow = true
    const drop = this._decal(world, W + 2.6, D + 2.6, 0.5)
    drop.position.y = -SLAB - 0.01

    const walls = [
      { len: W + WALL_T * 2, x: 0, z: -D / 2 - WALL_T / 2, ry: 0, test: (p) => p.z > -D / 2 },
      { len: W + WALL_T * 2, x: 0, z: D / 2 + WALL_T / 2, ry: 0, test: (p) => p.z < D / 2 },
      { len: D, x: -W / 2 - WALL_T / 2, z: 0, ry: PI / 2, test: (p) => p.x > -W / 2 },
      { len: D, x: W / 2 + WALL_T / 2, z: 0, ry: PI / 2, test: (p) => p.x < W / 2 },
    ]
    for (const w of walls) {
      const grp = new THREE.Group()
      grp.position.set(w.x, 0, w.z)
      grp.rotation.y = w.ry
      const body = new THREE.Mesh(new THREE.BoxGeometry(w.len, 1, WALL_T).translate(0, 0.5, 0), mat.wall)
      body.receiveShadow = true
      body.userData.noShadow = true
      const capM = new THREE.Mesh(new THREE.BoxGeometry(w.len + 0.002, 0.03, WALL_T + 0.004), mat.cap)
      capM.userData.noShadow = true
      grp.add(body, capM)
      world.add(grp)
      const h = this.introDone || this.reduceMotion ? WALL_H : 0.001
      body.scale.y = h
      capM.position.y = h
      this.walls.push({ body, cap: capM, test: w.test, h, target: WALL_H })
    }

    const half = Math.max(W, D) / 2 + 1.2
    const sc = this.keyLight.shadow.camera
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half
    sc.updateProjectionMatrix()

    const span = Math.max(W, D)
    const grid = new THREE.GridHelper(span, Math.round(span / 0.5), 0x9da198, 0xb9bdb5)
    grid.position.y = 0.004
    grid.material.transparent = true
    grid.material.opacity = 0.7
    grid.material.userData.temp = true
    grid.visible = this.editMode
    world.add(grid)
    this.grid = grid

    // muebles apilados en el mismo sitio (G/H/I) comparten una sola etiqueta
    this.stackOf = this._stacks(this.layout.elements)

    const runIntro = !introPlayed && !this.introDone && !this.reduceMotion && this.layout.elements.length > 0
    this.layout.elements.forEach((el, idx) => this._addElement(el, idx, runIntro))
    if (runIntro) this._startIntro()
    else if (!this._framed && this.layout.elements.length) {
      const g = this._presetGoal('all')
      for (const k in g) { this.cam[k].x = g[k]; this.cam[k].g = g[k]; this.cam[k].v = 0 }
      this.introDone = true
      for (const w of this.walls) { w.h = WALL_H; w.body.scale.y = WALL_H; w.cap.position.y = WALL_H }
    }
    if (this.layout.elements.length) this._framed = true

    this._updateFill(true)
    if (this.selectedLocation && !this.locObjs[this.selectedLocation]) this.selectedLocation = null
    if (this.selectedElement && !this.elInfo[this.selectedElement]) this.selectedElement = null
    this._placeMarks()
    this._refreshSelection()
    this.renderer.shadowMap.needsUpdate = true
    this.dirty = true
  }

  _addTag(el, g, info) {
    const stack = this.stackOf[el.id]
    if (stack && stack[0].id !== el.id) return
    const members = stack || [el]
    const anchor = document.createElement('div')
    anchor.className = 'css2d-anchor'
    const div = document.createElement('button')
    anchor.appendChild(div)
    div.type = 'button'
    div.className = 'el-tag solo'
    div.setAttribute('aria-label', members.map((m) => m.name).join(', '))
    div.innerHTML = `${members.map((m) => `<b>${m.code}</b>`).join('')}<span></span>`
    div.addEventListener('click', (e) => {
      e.stopPropagation()
      this.cb.onTapTag?.(el.id)
    })
    const tag = new CSS2DObject(anchor)
    tag.position.set(0, (el.y0 || 0) + info.h + 0.3, 0)
    g.add(tag)
    const entry = { tag, div, count: div.querySelector('span'), members: members.map((m) => m.id) }
    for (const m of members) this.tags[m.id] = entry
  }

  // ---------- llenar canastas y percheros segun el inventario ----------
  _updateFill(skipShadow) {
    if (!this.world) return
    // un codigo puede estar en varias ubicaciones: cada una se llena con lo
    // suyo; "bajo minimo" se juzga con el total del codigo
    const byLoc = {}
    const put = (loc, entry) => (byLoc[loc] = byLoc[loc] || []).push(entry)
    for (const p of this.products) {
      const rows = p.stock || []
      for (const s of rows) put(s.location_id, { ...p, qty: s.qty, total: p.qty })
      if (!rows.some((s) => s.location_id === p.location_id)) put(p.location_id, { ...p, qty: 0, total: p.qty })
    }
    const touched = new Set()
    const perEl = {}
    const labelColors = new Map()
    for (const id in this.locObjs) {
      const o = this.locObjs[id]
      const items = (byLoc[id] || []).filter((p) => p.qty > 0).sort((a, b) => b.qty - a.qty || a.size.localeCompare(b.size))
      const units = items.reduce((s, p) => s + p.qty, 0)
      const low = (byLoc[id] || []).some((p) => p.min_qty > 0 && p.total <= p.min_qty)
      const agg = (perEl[o.elId] = perEl[o.elId] || { units: 0, low: false })
      agg.units += units
      agg.low = agg.low || low
      if (o.kind === 'bin') {
        const layers = units > 0 ? clamp(Math.ceil(units / 4), 1, 4) : 0
        for (let l = 0; l < 4; l++) {
          const k = o.i * 4 + l
          if (l < layers) {
            const p = items[l % items.length]
            const jx = (hash(k) - 0.5) * 0.03, jz = (hash(k + 7) - 0.5) * 0.03, ry = (hash(k + 3) - 0.5) * 0.16
            this._setI(o.folds, k, o.x + jx, o.y + (o.crate ? 0.032 : 0.046) + l * 0.051, (o.z || 0) + (o.crate ? 0 : -0.035) + jz, 1, 1, 1, ry)
            o.folds.setColorAt(k, this._col.setHex(garmentColor(p.name)).multiplyScalar(0.9 + hash(k + 11) * 0.2))
          } else this._hide(o.folds, k)
        }
        touched.add(o.folds)
        if (!labelColors.has(o.labels)) labelColors.set(o.labels, [])
        labelColors.get(o.labels).push([o.i, low ? AMBER : units > 0 ? 0xffffff : 0x8a8d88])
      } else if (o.kind === 'shelf') {
        const k = units > 0 ? Math.min(o.n, Math.ceil(units / 6)) : 0
        for (let j = 0; j < o.n; j++) {
          const x = -((o.n - 1) / 2) * 0.5 + j * 0.5
          if (j < k) {
            this._setI(o.folds, o.start + j, x, o.y + 0.11, 0)
            o.folds.setColorAt(o.start + j, this._col.setHex(garmentColor(items[j % items.length].name)))
          } else this._hide(o.folds, o.start + j)
        }
        o.marker.visible = low
        touched.add(o.folds)
      } else if (o.kind === 'rod') {
        let k = 0
        for (const p of items) {
          const color = garmentColor(p.name)
          for (let i = 0; i < p.qty && k < o.cap; i++, k++) {
            const x = o.x0 + 0.07 + k * 0.066 + (hash(k + 5) - 0.5) * 0.008
            const ry = (hash(k + 1) - 0.5) * 0.12
            this._setI(o.jk, k, x, o.y - 0.062, 0, 1, 1, 1, ry)
            this._setI(o.hg, k, x, o.y, 0, 1, 1, 1, ry)
            o.jk.setColorAt(k, this._col.setHex(color).multiplyScalar(0.88 + hash(k + 9) * 0.24))
          }
        }
        o.jk.count = o.hg.count = k
        o.marker.visible = low
        touched.add(o.jk); touched.add(o.hg)
      } else if (o.kind === 'boxes') {
        o.marker.visible = low
      }
    }
    for (const [mesh, list] of labelColors) {
      const attr = mesh.geometry.getAttribute('color')
      for (const [i, hex] of list) {
        this._col.setHex(hex)
        for (let v = 0; v < 4; v++) attr.setXYZ(i * 4 + v, this._col.r, this._col.g, this._col.b)
      }
      attr.needsUpdate = true
    }
    touched.forEach((im) => {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.computeBoundingSphere()
    })
    for (const t of new Set(Object.values(this.tags))) {
      let units = 0, low = false
      for (const id of t.members) { units += perEl[id]?.units || 0; low = low || !!perEl[id]?.low }
      t.count.textContent = units > 0 ? `${units}` : ''
      t.div.classList.toggle('solo', units === 0)
      t.div.classList.toggle('low', low)
    }
    if (!skipShadow) this.renderer.shadowMap.needsUpdate = true
    this.dirty = true
  }

  // ---------- seleccion ----------
  _refreshSelection(animatePin) {
    const o = this.selectedLocation && this.locObjs[this.selectedLocation]
    const el = !o && this.editMode && this.selectedElement && this.layout.elements.find((e) => e.id === this.selectedElement)
    const info = el && this.elInfo[el.id]
    if (o) {
      this.sel.scale.set(o.size.x + 0.03, o.size.y + 0.03, o.size.z + 0.03)
      this.sel.position.copy(o.center)
      this.sel.visible = true
      this.pin.position.set(o.center.x, o.center.y + o.size.y / 2 + 0.08, o.center.z)
      this.pinInner.querySelector('b').textContent = o.id
      this.pin.visible = true
      if (animatePin && !this.reduceMotion) {
        this.pinInner.classList.remove('hit')
        void this.pinInner.offsetWidth
        this.pinInner.classList.add('hit')
      }
    } else if (info) {
      const odd = (el.rot || 0) % 2 === 1
      this.sel.scale.set((odd ? info.d : info.w) + 0.08, info.h + 0.08, (odd ? info.w : info.d) + 0.08)
      this.sel.position.set(el.x, (info.y0 || 0) + info.h / 2, el.z)
      this.sel.visible = true
      this.pin.visible = false
    } else {
      this.sel.visible = false
      this.pin.visible = false
    }
    this.selFill.material.opacity = info ? 0.12 : 0.22
    const focusEl = o ? o.elId : this.focusedEl
    const marked = new Set(this.markList.map(({ id }) => this.locObjs[id]?.elId).filter(Boolean))
    for (const t of new Set(Object.values(this.tags))) {
      const dim = marked.size ? !t.members.some((m) => marked.has(m)) : !!focusEl && !t.members.includes(focusEl)
      t.div.classList.toggle('dim', dim)
      // la letra del mueble marcado se esconde: la marca ya dice su codigo (F-3-1) y no se tapan
      t.div.classList.toggle('under-mark', marked.size > 0 && !dim)
    }
    this.dirty = true
  }

  // ---------- camara ----------
  // Distancia minima para que las 8 esquinas de la caja quepan en el area
  // libre de la pantalla (busqueda binaria proyectando cada esquina).
  _fitBox(box, th, ph, t) {
    const cam = this._fitCam || (this._fitCam = new THREE.PerspectiveCamera())
    cam.fov = this.camera.fov
    cam.aspect = this.camera.aspect
    cam.near = this.camera.near
    cam.far = this.camera.far
    cam.updateProjectionMatrix()
    const ins = this.insets, W = this.width || 1, H = this.height || 1
    const fx = clamp((W - ins.left - ins.right) / W, 0.25, 1) * 0.97
    const fy = clamp((H - ins.top - ins.bottom) / H, 0.25, 1) * 0.97
    const corners = []
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
    const v = new THREE.Vector3(), sp = Math.sin(ph)
    let lo = R_MIN, hi = R_MAX
    for (let i = 0; i < 26; i++) {
      const r = (lo + hi) / 2
      cam.position.set(t.x + r * sp * Math.sin(th), t.y + r * Math.cos(ph), t.z + r * sp * Math.cos(th))
      cam.lookAt(t.x, t.y, t.z)
      cam.updateMatrixWorld()
      let ok = true
      for (const c of corners) {
        v.copy(c).applyMatrix4(cam.matrixWorldInverse)
        if (v.z > -cam.near * 2) { ok = false; break }
        v.applyMatrix4(cam.projectionMatrix)
        if (Math.abs(v.x) > fx || Math.abs(v.y) > fy) { ok = false; break }
      }
      if (ok) hi = r
      else lo = r
    }
    return hi
  }

  _presetGoal(name) {
    const p = { ...PRESETS[name] }
    // en vertical (celular) una vista mas cenital llena mejor la pantalla
    if (name === 'all' && this.camera.aspect < 0.8) p.ph = 0.7
    const { width: W, depth: D } = this.layout.room
    const box = new THREE.Box3(
      new THREE.Vector3(-W / 2 - WALL_T, 0, -D / 2 - WALL_T),
      new THREE.Vector3(W / 2 + WALL_T, name === 'plan' ? WALL_H : 2.2, D / 2 + WALL_T),
    )
    const t = box.getCenter(new THREE.Vector3())
    if (name === 'plan') t.y = 0
    else t.y = 0.9
    return { th: p.th, ph: p.ph, r: this._fitBox(box, p.th, p.ph, t), tx: t.x, ty: t.y, tz: t.z }
  }

  _fly(goal, response = 0.7) {
    const c = this.cam
    if (goal.th != null) {
      const d = ((((goal.th - c.th.g) % (2 * PI)) + 3 * PI) % (2 * PI)) - PI
      goal = { ...goal, th: c.th.g + d }
    }
    for (const k in goal) if (c[k]) c[k].g = goal[k]
    this.camResp = response
    this.dirty = true
  }

  _stepCamera(dt) {
    const c = this.cam
    let moving = false
    if (this.dragging) {
      for (const k of CAM_KEYS) {
        if (k === 'ox' || k === 'oy') continue
        if (c[k].x !== c[k].g) moving = true
        c[k].x = c[k].g
        c[k].v = 0
      }
    }
    const kk = (2 * PI / this.camResp) ** 2, cc = (4 * PI) / this.camResp
    const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps
    for (const k of CAM_KEYS) {
      if (this.dragging && k !== 'ox' && k !== 'oy') continue
      const p = c[k]
      const eps = k === 'ox' || k === 'oy' ? 0.05 : 1e-4
      if (Math.abs(p.x - p.g) < eps && Math.abs(p.v) < eps * 10) {
        p.x = p.g
        p.v = 0
        continue
      }
      for (let i = 0; i < steps; i++) {
        const a = -kk * (p.x - p.g) - cc * p.v
        p.v += a * h
        p.x += p.v * h
      }
      moving = true
    }
    if (!moving && this.camResp !== 0.7 && !this.dragging) this.camResp = 0.7
    return moving
  }

  _applyCamera() {
    const c = this.cam
    const th = c.th.x, ph = c.ph.x, r = c.r.x
    const sp = Math.sin(ph)
    this.camera.position.set(c.tx.x + r * sp * Math.sin(th), c.ty.x + r * Math.cos(ph), c.tz.x + r * sp * Math.cos(th))
    this.camera.lookAt(c.tx.x, c.ty.x, c.tz.x)
    if (Math.abs(c.ox.x) > 0.5 || Math.abs(c.oy.x) > 0.5) this.camera.setViewOffset(this.width, this.height, c.ox.x, c.oy.x, this.width, this.height)
    else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset()
    this.camera.updateMatrixWorld()
  }

  _stepWalls(dt) {
    let moving = false
    const p = this.camera.position
    const k = 1 - Math.exp(-dt * 9)
    for (const w of this.walls) {
      if (!this.introActive) w.target = w.test(p) ? WALL_H : WALL_STUB
      if (Math.abs(w.h - w.target) < 0.002) continue
      w.h += (w.target - w.h) * k
      if (Math.abs(w.h - w.target) < 0.002) w.h = w.target
      w.body.scale.y = w.h
      w.cap.position.y = w.h
      moving = true
    }
    return moving
  }

  _startIntro() {
    introPlayed = true
    const goal = this._presetGoal('all')
    const c = this.cam
    const start = { th: goal.th + 0.9, ph: 0.5, r: goal.r * 1.6, tx: goal.tx, ty: goal.ty, tz: goal.tz }
    for (const k in start) { c[k].x = start[k]; c[k].g = start[k]; c[k].v = 0 }
    this._fly(goal, 1.15)
    this.introActive = true
    this.introT0 = performance.now() + 120
    for (const w of this.walls) w.target = WALL_H
  }

  _stepIntro(now) {
    if (!this.introActive) return false
    let running = false
    for (const id in this.elGroups) {
      const g = this.elGroups[id]
      const t = clamp((now - this.introT0 - (g.userData.introDelay || 0)) / 650, 0, 1)
      g.scale.y = Math.max(0.001, easeOut(t))
      if (t < 1) running = true
    }
    if (!running && now - this.introT0 > 900) {
      this.introActive = false
      this.introDone = true
    }
    this.renderer.shadowMap.needsUpdate = true
    return true
  }

  // ---------- entrada: orbitar, pellizcar, arrastrar en modo edicion ----------
  _rayAt(clientX, clientY, list) {
    const rc = this.renderer.domElement.getBoundingClientRect()
    this.ndc.set(((clientX - rc.left) / rc.width) * 2 - 1, -((clientY - rc.top) / rc.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    return list ? this.ray.intersectObjects(list, false) : []
  }

  _floorAt(clientX, clientY) {
    this._rayAt(clientX, clientY)
    const p = new THREE.Vector3()
    return this.ray.ray.intersectPlane(this.floorPlane, p) ? p : null
  }

  _bindPointer() {
    const dom = this.renderer.domElement
    const pts = new Map()
    let down = null, pinch0 = 0, r0 = 0, lastMid = null, drag = null, hist = []

    const onDown = (e) => {
      dom.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }
        hist = [[e.timeStamp, e.clientX, e.clientY]]
        for (const k of ['th', 'ph', 'r', 'tx', 'ty', 'tz']) { this.cam[k].g = this.cam[k].x; this.cam[k].v = 0 }
        if (this.focusedEl) {
          this.focusedEl = null
          this._refreshSelection()
        }
        this.dragging = true
        if (this.editMode && this.selectedElement) {
          const hit = this._rayAt(e.clientX, e.clientY, this.elHits)[0]
          if (hit && hit.object.userData.el === this.selectedElement) {
            const p = this._floorAt(e.clientX, e.clientY)
            const el = this.layout.elements.find((x) => x.id === this.selectedElement)
            if (p && el) drag = { id: el.id, ox: p.x - el.x, oz: p.z - el.z, moved: false }
          }
        }
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1
        r0 = this.cam.r.g
        lastMid = null
        if (down) down.moved = true
        drag = null
      }
    }

    const onMove = (e) => {
      const p = pts.get(e.pointerId)
      if (!p) {
        if (e.pointerType === 'mouse' && !pts.size) this._hover(e.clientX, e.clientY)
        return
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (pts.size === 1) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true
        if (!down || !down.moved) return
        if (drag) {
          const f = this._floorAt(e.clientX, e.clientY)
          const el = this.layout.elements.find((x) => x.id === drag.id)
          if (f && el) {
            el.x = snap(f.x - drag.ox)
            el.z = snap(f.z - drag.oz)
            this._clampIn(el)
            this.elGroups[el.id]?.position.set(el.x, 0, el.z)
            drag.moved = true
            this._refreshSelection()
            this.renderer.shadowMap.needsUpdate = true
          }
        } else {
          this.cam.th.g -= dx * 0.0075
          this.cam.ph.g = clamp(this.cam.ph.g - dy * 0.0065, PH_MIN, PH_MAX)
          hist.push([e.timeStamp, e.clientX, e.clientY])
          if (hist.length > 6) hist.shift()
        }
        this.dirty = true
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.cam.r.g = clamp((r0 * pinch0) / d, R_MIN, R_MAX)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (lastMid) {
          const s = this.cam.r.g * 0.0018, th = this.cam.th.g, mx = mid.x - lastMid.x, my = mid.y - lastMid.y
          const { width: W, depth: D } = this.layout.room
          const c = this.cam
          if (c.ph.g < 0.5) {
            c.tx.g = clamp(c.tx.g - (Math.cos(th) * mx + Math.sin(th) * my) * s, -W / 2, W / 2)
            c.tz.g = clamp(c.tz.g - (-Math.sin(th) * mx + Math.cos(th) * my) * s, -D / 2, D / 2)
          } else {
            c.tx.g = clamp(c.tx.g - Math.cos(th) * mx * s, -W / 2, W / 2)
            c.tz.g = clamp(c.tz.g + Math.sin(th) * mx * s, -D / 2, D / 2)
            c.ty.g = clamp(c.ty.g + my * s, 0, 2.8)
          }
        }
        lastMid = mid
        this.dirty = true
      }
    }

    const onUp = (e) => {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      if (pts.size === 0) {
        this.dragging = false
        if (drag && drag.moved) {
          const el = this.layout.elements.find((x) => x.id === drag.id)
          this.cb.onElementMoved?.(drag.id, el.x, el.z)
        } else if (down && !down.moved && performance.now() - down.t < 450) {
          this._tap(e.clientX, e.clientY)
        } else if (down && down.moved && !drag && hist.length > 1) {
          // inercia: la vista sigue girando con la velocidad del dedo y frena sola
          const [t0, x0, y0] = hist[0], [t1, x1, y1] = hist[hist.length - 1]
          const dt = Math.max(16, t1 - t0)
          if (e.timeStamp - t1 < 80) {
            const vth = (-(x1 - x0) / dt) * 0.0075 * 1000, vph = (-(y1 - y0) / dt) * 0.0065 * 1000
            const c = this.cam
            c.th.v = vth
            c.ph.v = vph
            c.th.g = c.th.x + vth * 0.24
            c.ph.g = clamp(c.ph.x + vph * 0.24, PH_MIN, PH_MAX)
            this.camResp = 0.55
          }
        }
        down = null
        drag = null
        hist = []
        this.dirty = true
      }
      if (pts.size < 2) lastMid = null
    }

    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerup', onUp)
    dom.addEventListener('pointercancel', onUp)
    dom.addEventListener('pointerleave', () => { if (!pts.size) this._hover(null) })
    dom.addEventListener('wheel', (e) => {
      e.preventDefault()
      const factor = clamp(1 + e.deltaY * 0.0028, 0.86, 1.16)
      this.cam.r.g = clamp(this.cam.r.g * factor, R_MIN, R_MAX)
      this.camResp = 0.3
      this.dirty = true
    }, { passive: false })
  }

  _hover(x, y) {
    let id = null
    if (x != null && !this.editMode) {
      const hit = this._rayAt(x, y, this.locHits)[0]
      id = hit ? hit.object.userData.loc : null
    }
    if (id === this.hoverLoc) return
    this.hoverLoc = id
    const o = id && id !== this.selectedLocation && this.locObjs[id]
    if (o) {
      this.hoverBox.scale.set(o.size.x + 0.02, o.size.y + 0.02, o.size.z + 0.02)
      this.hoverBox.position.copy(o.center)
    }
    this.hoverBox.visible = !!o
    this.renderer.domElement.style.cursor = id ? 'pointer' : ''
    this.dirty = true
  }

  _clampIn(el) {
    const { width: W, depth: D } = this.layout.room
    el.x = clamp(el.x, -W / 2, W / 2)
    el.z = clamp(el.z, -D / 2, D / 2)
  }

  _tap(x, y) {
    if (this.editMode) {
      const hit = this._rayAt(x, y, this.elHits)[0]
      this.cb.onTapElement?.(hit ? hit.object.userData.el : null)
      return
    }
    const hit = this._rayAt(x, y, this.locHits)[0]
    this.cb.onTapLocation?.(hit ? hit.object.userData.loc : null)
  }

  // ---------- bucle de render (solo dibuja cuando algo cambia) ----------
  _render(withAO) {
    const r = this.renderer
    if (withAO && this.composer) this.composer.render()
    else r.render(this.scene, this.camera)
    r.autoClear = false
    r.clearDepth()
    r.render(this.overlay, this.camera)
    r.autoClear = true
    this.labelRenderer.render(this.overlay, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  _loop(now) {
    if (this._disposed) return
    this._raf = requestAnimationFrame(this._loop)
    const dt = clamp((now - this._last) / 1000, 0, 0.05)
    this._last = now
    const camMoving = this._stepCamera(dt)
    this._applyCamera()
    const wallsMoving = this._stepWalls(dt)
    const intro = this._stepIntro(now)
    const pulsing = now < this.pulseUntil
    if (pulsing || this._wasPulsing) {
      this.selFill.material.opacity = pulsing ? 0.12 + 0.2 * Math.abs(Math.sin(now / 170)) : 0.22
      this.dirty = true
    }
    this._wasPulsing = pulsing
    const active = camMoving || wallsMoving || intro || this.dragging

    if (this.mobile) {
      // celular: rapido mientras se mueve; al quedar quieto, un "revelado" con AO
      if (active || this.dirty) {
        this.dirty = false
        this._render(false)
        this.needsRefine = !!this.composer
        this._refineStart = 0
        return
      }
      if (this.needsRefine) {
        if (!this._refineStart) this._refineStart = now
        const t = clamp((now - this._refineStart) / 260, 0, 1)
        this.gtao.blendIntensity = easeOut(t)
        this._render(true)
        if (t >= 1) this.needsRefine = false
      }
      return
    }
    if (!active && !this.dirty) return
    this.dirty = false
    this._render(true)
  }
}
