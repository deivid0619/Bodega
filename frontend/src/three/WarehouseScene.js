// Motor 3D de la bodega, en una clase aislada de React: React solo le pasa
// datos (setLayout/setProducts) y escucha eventos (onTapLocation,
// onTapElement, onElementMoved); todo el dibujo y el control de cámara
// vive aquí. Los identificadores y nombres de cada ubicación (canasta,
// nivel de estantería, barra de perchero...) vienen siempre del backend
// (layout.elements[].locations), nunca se recalculan aquí, para que el
// visor 3D jamás pueda desincronizarse de la base de datos.
import * as THREE from 'three'

const BW = 0.42, BH = 0.3, BD = 0.42, PI = Math.PI
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const snap = (v) => Math.round(v * 20) / 20

const PRESETS = {
  all: (room) => ({ th: 0.6, ph: 0.95, tx: 0, ty: 0.5, tz: 0, fit: [Math.max(room.width, room.depth) * 0.85, 3.2] }),
  plan: (room) => ({ th: 0, ph: 0.035, tx: 0, ty: 0, tz: 0, fit: [room.width + 0.8, room.depth + 0.8] }),
}

function colorForProduct(name) {
  const n = (name || '').toUpperCase()
  if (n.includes('CAMO')) return 0x60656b
  if (n.includes('AZUL')) return 0x27344f
  if (n.includes('GRIS')) return 0x484b50
  return 0x222326
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
    this.pulseUntil = 0
    this.dirty = true
    this.locObjs = {}
    this.elGroups = {}
    this.elInfo = {}
    this.elHits = []
    this.locHits = []
    this.walls = []
    this.signCache = {}
    this._disposed = false

    this._initThree()
    this._bindPointer()
    this._resizeObserver = new ResizeObserver(() => this._resize())
    this._resizeObserver.observe(container)
    this._resize()
    this._loop = this._loop.bind(this)
    requestAnimationFrame(this._loop)
  }

  // ---------- API pública ----------
  setLayout(layout) {
    this.layout = layout
    this._buildWorld()
  }

  setProducts(products) {
    this.products = products
    this._updateFill()
  }

  setEditMode(on) {
    this.editMode = on
    if (this.grid) this.grid.visible = on
    if (!on) {
      this.selectedElement = null
      this._outlineElement()
    } else {
      this.selectedLocation = null
      this._outlineLocation()
    }
    this.applyPreset(on ? 'plan' : 'all')
  }

  selectLocation(id) {
    this.selectedLocation = id
    this._outlineLocation()
  }

  selectElement(id) {
    this.selectedElement = id
    this._outlineElement()
  }

  pulse() {
    this.pulseUntil = Date.now() + 3000
  }

  applyPreset(name, instant) {
    const p = PRESETS[name](this.layout.room)
    const r = this._fitR(...p.fit)
    this._setGoal({ th: p.th, ph: p.ph, tx: p.tx, ty: p.ty, tz: p.tz, r })
    if (instant) Object.assign(this.cur, this.goal)
  }

  focusElement(id) {
    const el = this.layout.elements.find((e) => e.id === id)
    const info = this.elInfo[id]
    if (!el || !info) return
    const r = this._fitR(info.w + 0.8, info.h + 0.5)
    this._setGoal({ th: (el.rot || 0) * (PI / 2), ph: 1.25, r, tx: el.x, ty: (info.y0 || 0) + info.h / 2 - r * 0.08, tz: el.z })
  }

  focusLocation(id) {
    const o = this.locObjs[id]
    if (!o) return
    const el = this.layout.elements.find((e) => e.id === o.elId)
    const w = o.kind === 'bin' ? 1.6 : Math.max(o.size.x, o.size.z) + 0.5
    const r = this._fitR(w, 1.4)
    this._setGoal({ th: ((el && el.rot) || 0) * (PI / 2), ph: 1.3, r, tx: o.center.x, ty: o.center.y - r * 0.2, tz: o.center.z })
  }

  dispose() {
    this._disposed = true
    this._resizeObserver.disconnect()
    this.container.innerHTML = ''
    this.renderer?.dispose()
  }

  // ---------- inicialización ----------
  _initThree() {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    this.container.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x2f3236)
    scene.fog = new THREE.Fog(0x2f3236, 9, 22)
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 150)
    scene.add(new THREE.HemisphereLight(0xd9dde2, 0x35322c, 0.7))
    const dl = new THREE.DirectionalLight(0xfff4e0, 0.9)
    dl.position.set(4, 9, 5)
    dl.castShadow = true
    dl.shadow.mapSize.set(1024, 1024)
    dl.shadow.bias = -0.0018
    dl.shadow.normalBias = 0.02
    dl.shadow.camera.near = 1
    dl.shadow.camera.far = 26
    scene.add(dl)
    this.dirLight = dl
    // luz de relleno tenue y fria, del lado contrario, para que las sombras
    // del sol de la ventana no queden negras del todo
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.22)
    fill.position.set(-5, 4, -4)
    scene.add(fill)

    const S = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05, ...o })
    this.mat = {
      floor: S(0xffffff, { roughness: 0.96, map: this._concreteTexture() }),
      wall: S(0xd3cec4, { roughness: 0.94 }),
      bin: S(0x1c1d1f, { roughness: 0.55 }), fill: S(0x2e3034, { roughness: 0.35, metalness: 0.1 }),
      rack: S(0xf2b705, { roughness: 0.42, metalness: 0.3 }), post: S(0x1c1d1f), kraft: S(0xffffff, { roughness: 0.93, map: this._cardboardTexture() }),
      table: S(0xeeeeea, { roughness: 0.45 }), crate: S(0x3a3c40),
      gray: S(0x5b6168, { roughness: 0.6 }), deck: S(0x2a2c2f), red: S(0xe0322b, { emissive: 0x8a120d }), neon: S(0xc9ef2b, { emissive: 0x2e3a00 }),
      tube: new THREE.MeshBasicMaterial({ color: 0xfff8ea }), white: S(0xffffff, { roughness: 0.6 }), string: new THREE.MeshBasicMaterial({ color: 0xdddddd }),
      balloonBlack: S(0x222326, { roughness: 0.4 }),
    }
    this.hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    this.selLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xf2b705, transparent: true }))
    this.selLine.visible = false
    scene.add(this.selLine)

    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.ray = new THREE.Raycaster()
    this.ndc = new THREE.Vector2()
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.cur = { th: 0.6, ph: 0.95, r: 16, tx: 0, ty: 0.5, tz: 0 }
    this.goal = { ...this.cur }
    this._m4 = new THREE.Matrix4()
    this._col = new THREE.Color()
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // ---------- construir el mundo a partir de layout ----------
  _mk(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    parent.add(m)
    return m
  }

  _inst(geo, mat, count, parent) {
    const m = new THREE.InstancedMesh(geo, mat, count)
    m.frustumCulled = false
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    parent.add(m)
    return m
  }

  _setI(im, i, x, y, z, sx, sy, sz) {
    this._m4.makeScale(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz)
    this._m4.setPosition(x, y, z)
    im.setMatrixAt(i, this._m4)
  }

  _tempMat(c) {
    const m = new THREE.MeshBasicMaterial({ color: c })
    m.userData.temp = true
    return m
  }

  _locHit(parent, id, geo, x, y, z) {
    const m = this._mk(geo, this.hitMat, x, y, z, parent)
    m.visible = false
    m.userData.loc = id
    this.locHits.push(m)
    return m
  }

  // ---------- texturas procedurales (sin imagenes externas) ----------
  _concreteTexture() {
    if (this._floorTex) return this._floorTex
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const x = c.getContext('2d')
    x.fillStyle = '#84888c'; x.fillRect(0, 0, 512, 512)
    // moteado sutil, como concreto pulido
    for (let i = 0; i < 3200; i++) {
      const v = 120 + Math.random() * 60
      x.fillStyle = `rgba(${v},${v},${v + 2},${0.05 + Math.random() * 0.07})`
      const s = 1 + Math.random() * 2.4
      x.fillRect(Math.random() * 512, Math.random() * 512, s, s)
    }
    // juntas de dilatacion
    x.strokeStyle = 'rgba(60,62,65,.5)'; x.lineWidth = 2
    for (const p of [128, 256, 384]) {
      x.beginPath(); x.moveTo(p, 0); x.lineTo(p, 512); x.stroke()
      x.beginPath(); x.moveTo(0, p); x.lineTo(512, p); x.stroke()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(4, 4)
    tex.anisotropy = 4
    return (this._floorTex = tex)
  }

  _cardboardTexture() {
    if (this._boxTex) return this._boxTex
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const x = c.getContext('2d')
    x.fillStyle = '#b98b57'; x.fillRect(0, 0, 256, 256)
    x.strokeStyle = 'rgba(120,84,42,.35)'; x.lineWidth = 1
    for (let y = 6; y < 256; y += 7) { x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke() }
    // cinta de embalaje
    x.fillStyle = 'rgba(214,193,150,.9)'
    x.fillRect(0, 112, 256, 30)
    x.fillStyle = 'rgba(120,84,42,.18)'
    x.fillRect(0, 112, 256, 3); x.fillRect(0, 139, 256, 3)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return (this._boxTex = tex)
  }

  _signTex(ch) {
    if (this.signCache[ch]) return this.signCache[ch]
    try {
      const c = document.createElement('canvas')
      c.width = 256; c.height = 128
      const x = c.getContext('2d')
      const w = ch.length > 2 ? 250 : 128, x0 = (256 - w) / 2
      x.fillStyle = '#fff'; x.fillRect(x0, 0, w, 128)
      x.strokeStyle = '#000'; x.lineWidth = 8; x.strokeRect(x0 + 8, 8, w - 16, 112)
      x.fillStyle = '#000'; x.font = `bold ${ch.length > 2 ? 56 : ch.length > 1 ? 64 : 80}px Arial`
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 128, 70)
      return (this.signCache[ch] = new THREE.CanvasTexture(c))
    } catch {
      return null
    }
  }

  _buildBins(el, g) {
    const { cols, rows } = el.params, n = cols * rows, mat = this.mat
    const baseY = el.y0 || 0
    const G = {
      bottom: new THREE.BoxGeometry(BW * 0.94, 0.02, BD), back: new THREE.BoxGeometry(BW * 0.94, BH * 0.94, 0.02),
      side: new THREE.BoxGeometry(0.02, BH * 0.94, BD), lip: new THREE.BoxGeometry(BW * 0.94, BH * 0.42, 0.02),
      label: new THREE.PlaneGeometry(0.13, 0.055), bar: new THREE.BoxGeometry(BW * 0.9, 0.022, 0.026),
      fill: new THREE.BoxGeometry(BW * 0.76, 1, BD * 0.7), hit: new THREE.BoxGeometry(BW, BH, BD),
    }
    const iB = this._inst(G.bottom, mat.bin, n, g), iK = this._inst(G.back, mat.bin, n, g)
    const iS = this._inst(G.side, mat.bin, n * 2, g), iL = this._inst(G.lip, mat.bin, n, g)
    const iLab = this._inst(G.label, this._tempMat(0xffffff), n, g)
    const iBar = this._inst(G.bar, mat.red, n, g), iFill = this._inst(G.fill, mat.fill, n, g)
    const locs = []
    let i = 0
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const x = -((cols - 1) / 2) * BW + (c - 1) * BW, y = baseY + 0.02 + (rows - r) * BH
        this._setI(iB, i, x, y + 0.01, 0); this._setI(iK, i, x, y + BH / 2, -BD / 2)
        this._setI(iS, 2 * i, x - BW * 0.46, y + BH / 2, 0); this._setI(iS, 2 * i + 1, x + BW * 0.46, y + BH / 2, 0)
        this._setI(iL, i, x, y + BH * 0.21, BD / 2); this._setI(iLab, i, x, y + BH * 0.22, BD / 2 + 0.012)
        iLab.setColorAt(i, this._col.setHex(0x55585c))
        this._setI(iBar, i, 0, 0, 0, 0, 0, 0); this._setI(iFill, i, 0, 0, 0, 0, 0, 0)
        const loc = el.locations[i]
        if (loc) {
          this._locHit(g, loc.id, G.hit, x, y + BH / 2, 0)
          locs.push({ id: loc.id, kind: 'bin', c: new THREE.Vector3(x, y + BH / 2, 0), s: new THREE.Vector3(BW, BH, BD), i, x, y, iBar, iFill, iLab })
        }
        i++
      }
    }
    return { w: cols * BW, h: rows * BH + 0.02, d: BD, locs }
  }

  _buildShelf(el, g) {
    const W = el.params.w, L = el.params.levels, D = 0.6, H = 2.45, sp = (H - 0.35) / L, mat = this.mat
    const post = new THREE.BoxGeometry(0.06, H, 0.06)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._mk(post, mat.post, sx * (W / 2 - 0.03), H / 2, sz * (D / 2 - 0.03), g)
    const beam = new THREE.BoxGeometry(W, 0.08, 0.05), deck = new THREE.BoxGeometry(W - 0.04, 0.02, D - 0.04)
    const n = Math.max(1, Math.floor((W - 0.06) / 0.58))
    const crates = this._inst(new THREE.BoxGeometry(0.54, 0.3, 0.5), mat.gray, n * L, g)
    const bags = this._inst(new THREE.BoxGeometry(0.44, 0.1, 0.4), mat.fill, n * L, g)
    const hit = new THREE.BoxGeometry(W, sp * 0.9, D), labG = new THREE.PlaneGeometry(0.2, 0.06), barG = new THREE.BoxGeometry(W * 0.25, 0.03, 0.03)
    const locs = []
    for (let i = 1; i <= L; i++) {
      const y = 0.1 + (i - 1) * sp
      this._mk(beam, mat.rack, 0, y, D / 2, g); this._mk(beam, mat.rack, 0, y, -D / 2, g); this._mk(deck, mat.deck, 0, y + 0.03, 0, g)
      for (let j = 0; j < n; j++) {
        const k = (i - 1) * n + j, x = -((n - 1) / 2) * 0.58 + j * 0.58
        this._setI(crates, k, x, y + 0.19, 0); this._setI(bags, k, 0, 0, 0, 0, 0, 0)
      }
      const label = this._mk(labG, this._tempMat(0x55585c), 0, y, D / 2 + 0.03, g)
      const bar = this._mk(barG, mat.red, W * 0.3, y + 0.055, D / 2 + 0.01, g); bar.visible = false
      const loc = el.locations[i - 1]
      if (loc) {
        this._locHit(g, loc.id, hit, 0, y + sp * 0.45, 0)
        locs.push({ id: loc.id, kind: 'shelf', c: new THREE.Vector3(0, y + sp * 0.45, 0), s: new THREE.Vector3(W, sp * 0.9, D), bags, start: (i - 1) * n, n, y, label, bar, pitch: 0.58 })
      }
    }
    this._mk(beam, mat.rack, 0, H - 0.05, D / 2, g); this._mk(beam, mat.rack, 0, H - 0.05, -D / 2, g)
    return { w: W, h: H, d: D, locs }
  }

  _buildRack(el, g) {
    const W = el.params.w, bars = el.params.bars, sp = bars > 1 ? Math.min(0.7, 1.95 / (bars - 1)) : 0
    const cap = Math.max(1, Math.floor((W - 0.1) / 0.066)), mat = this.mat
    const post = new THREE.BoxGeometry(0.08, 2.95, 0.08), br = new THREE.BoxGeometry(0.12, 0.14, 0.12)
    for (const sx of [-1, 1]) this._mk(post, mat.post, sx * (W / 2 + 0.05), 1.475, 0, g)
    this._mk(new THREE.BoxGeometry(W + 0.2, 0.08, 0.1), mat.rack, 0, 2.92, 0, g)
    const rodG = new THREE.CylinderGeometry(0.022, 0.022, W + 0.12, 10), jG = new THREE.BoxGeometry(0.05, 0.55, 0.42)
    const cG = new THREE.BoxGeometry(0.056, 0.07, 0.2), hit = new THREE.BoxGeometry(W, 0.64, 0.48), mG = new THREE.SphereGeometry(0.05, 12, 8)
    const locs = []
    for (let i = 1; i <= bars; i++) {
      const y = 2.7 - (i - 1) * sp
      const rod = this._mk(rodG, mat.rack, 0, y, 0, g); rod.rotation.z = PI / 2
      for (const sx of [-1, 1]) this._mk(br, mat.rack, sx * (W / 2 + 0.05), y, 0, g)
      const jk = this._inst(jG, mat.white, cap, g), cl = this._inst(cG, mat.neon, cap, g)
      for (let k = 0; k < cap; k++) { this._setI(jk, k, 0, 0, 0, 0, 0, 0); this._setI(cl, k, 0, 0, 0, 0, 0, 0); jk.setColorAt(k, this._col.setHex(0x222326)) }
      jk.count = 0; cl.count = 0; jk.visible = cl.visible = false
      const bar = this._mk(mG, mat.red, -W / 2 - 0.17, y, 0, g); bar.visible = false
      const loc = el.locations[i - 1]
      if (loc) {
        this._locHit(g, loc.id, hit, 0, y - 0.33, 0)
        locs.push({ id: loc.id, kind: 'rod', c: new THREE.Vector3(0, y - 0.33, 0), s: new THREE.Vector3(W, 0.64, 0.48), jk, cl, cap, x0: -W / 2, y, bar })
      }
    }
    return { w: W + 0.2, h: 2.96, d: 0.55, locs }
  }

  _buildBoxes(el, g) {
    const n = clamp(el.params.count, 1, 8), base = Math.ceil(n / 2), pitch = 0.64, W = base * pitch, mat = this.mat
    const bx = new THREE.BoxGeometry(0.6, 0.48, 0.45)
    for (let i = 0; i < n; i++) {
      const top = i >= base, j = top ? i - base : i, x = -((base - 1) / 2) * pitch + j * pitch
      this._mk(bx, mat.kraft, x + (top ? 0.02 : 0), top ? 0.73 : 0.24, top ? -0.01 : 0, g)
    }
    const H = n > base ? 0.97 : 0.48
    const bar = this._mk(new THREE.BoxGeometry(0.3, 0.04, 0.3), mat.red, 0, H + 0.03, 0, g); bar.visible = false
    const loc = el.locations[0]
    const locs = []
    if (loc) {
      this._locHit(g, loc.id, new THREE.BoxGeometry(W, H, 0.5), 0, H / 2, 0)
      locs.push({ id: loc.id, kind: 'boxes', c: new THREE.Vector3(0, H / 2, 0), s: new THREE.Vector3(W, H, 0.5), bar })
    }
    return { w: W, h: H, d: 0.5, locs }
  }

  _buildTable(el, g) {
    // mesa de despacho real: no tiene patas propias, se apoya directo
    // sobre una base de canastas apiladas (foto de referencia)
    const W = el.params.w, D = 1.2, mat = this.mat
    this._mk(new THREE.BoxGeometry(W, 0.05, D), mat.table, 0, 0.95, 0, g)
    const cw = 0.4, cd = 0.4, ch = 0.3, stackH = 3
    const cols = Math.max(1, Math.floor((W - 0.1) / cw))
    const rows = Math.max(1, Math.floor((D - 0.1) / cd))
    const crateGeo = new THREE.BoxGeometry(cw * 0.92, ch * 0.92, cd * 0.92)
    const inst = this._inst(crateGeo, mat.crate, cols * rows * stackH, g)
    let idx = 0
    for (let cx = 0; cx < cols; cx++) {
      for (let cz = 0; cz < rows; cz++) {
        const x = -((cols - 1) / 2) * cw + cx * cw, z = -((rows - 1) / 2) * cd + cz * cd
        for (let s = 0; s < stackH; s++) this._setI(inst, idx++, x, 0.02 + ch / 2 + s * ch, z)
      }
    }
    return { w: W, h: 0.98, d: D, locs: [] }
  }

  _buildLadder(el, g) {
    const mat = this.mat, rail = new THREE.BoxGeometry(0.035, 1.15, 0.035)
    for (const sx of [-1, 1]) {
      const a = this._mk(rail, mat.table, sx * 0.2, 0.56, 0.12, g); a.rotation.x = -0.22
      const b = this._mk(rail, mat.table, sx * 0.2, 0.56, -0.14, g); b.rotation.x = 0.25
    }
    const st = new THREE.BoxGeometry(0.42, 0.03, 0.13)
    ;[0.3, 0.6, 0.88].forEach((y, i) => this._mk(st, mat.table, 0, y, 0.2 - i * 0.065, g))
    this._mk(new THREE.BoxGeometry(0.44, 0.04, 0.24), mat.table, 0, 1.12, -0.01, g)
    return { w: 0.5, h: 1.15, d: 0.62, locs: [] }
  }

  _buildBalloons(el, g) {
    const mat = this.mat, sph = new THREE.SphereGeometry(0.17, 20, 14)
    this._mk(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 20), mat.post, 0, 0.015, 0, g)
    ;[[0, 1.95, 0, mat.red], [-0.24, 1.72, 0.08, mat.balloonBlack], [0.02, 1.55, 0.18, mat.red], [0.24, 1.62, 0.02, mat.red]].forEach(([x, y, z, m]) => {
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

  _buildWorld() {
    if (this.world) {
      this.scene.remove(this.world)
      this.world.traverse((o) => {
        if (o.geometry && !o.isSprite) o.geometry.dispose()
        if (o.material && o.material.userData && o.material.userData.temp) o.material.dispose()
      })
    }
    const world = new THREE.Group()
    this.world = world
    this.scene.add(world)
    this.locObjs = {}; this.locHits = []; this.elHits = []; this.elGroups = {}; this.elInfo = {}; this.walls = []

    const { width: W, depth: D } = this.layout.room, mat = this.mat
    const floor = this._mk(new THREE.PlaneGeometry(W, D), mat.floor, 0, 0, 0, world)
    floor.rotation.x = -PI / 2
    floor.receiveShadow = true
    mat.floor.map.repeat.set(W / 1.4, D / 1.4)
    const wallH = 3.2
    const wb = this._mk(new THREE.BoxGeometry(W + 0.2, wallH, 0.1), mat.wall, 0, wallH / 2, -D / 2 - 0.05, world)
    const wf = this._mk(new THREE.BoxGeometry(W + 0.2, wallH, 0.1), mat.wall, 0, wallH / 2, D / 2 + 0.05, world)
    const wl = this._mk(new THREE.BoxGeometry(0.1, wallH, D), mat.wall, -W / 2 - 0.05, wallH / 2, 0, world)
    const wr = this._mk(new THREE.BoxGeometry(0.1, wallH, D), mat.wall, W / 2 + 0.05, wallH / 2, 0, world)
    for (const w of [wb, wf, wl, wr]) w.receiveShadow = true
    this.walls = [
      { m: wb, t: (p) => p.z > -D / 2 }, { m: wf, t: (p) => p.z < D / 2 },
      { m: wl, t: (p) => p.x > -W / 2 }, { m: wr, t: (p) => p.x < W / 2 },
    ]
    const tube = new THREE.BoxGeometry(0.09, 0.04, Math.min(2.4, D * 0.4))
    for (const x of [-W * 0.3, 0, W * 0.3]) {
      this._mk(tube, mat.tube, x, 3.3, 0, world)
      const glow = new THREE.PointLight(0xfff2d9, 0.55, Math.max(W, D) * 0.9, 2)
      glow.position.set(x, 3.15, 0)
      world.add(glow)
    }
    // la camara de sombra del sol cubre exactamente este cuarto, ni mas ni menos
    const half = Math.max(W, D) / 2 + 1
    const sc = this.dirLight.shadow.camera
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half
    sc.updateProjectionMatrix()
    const span = Math.max(W, D)
    const grid = new THREE.GridHelper(span, Math.round(span / 0.5), 0x9fa3a8, 0x8f9398)
    grid.position.y = 0.004
    grid.material.userData.temp = true
    grid.visible = this.editMode
    world.add(grid)
    this.grid = grid

    for (const el of this.layout.elements) {
      const g = new THREE.Group()
      g.position.set(el.x, 0, el.z)
      g.rotation.y = (el.rot || 0) * (PI / 2)
      world.add(g)
      this.elGroups[el.id] = g
      const info = this._buildElement(el, g)
      const y0 = el.y0 || 0
      g.traverse((o) => { if (o.isMesh && o.material !== this.hitMat) { o.castShadow = true; o.receiveShadow = true } })
      const hit = this._mk(new THREE.BoxGeometry(Math.max(info.w, 0.3), info.h, Math.max(info.d, 0.3)), this.hitMat, 0, y0 + info.h / 2, 0, g)
      hit.visible = false
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
      if (el.type !== 'table' && el.type !== 'ladder' && el.type !== 'balloons' && el.type !== 'boxes' && el.code) {
        const tex = this._signTex(el.code)
        if (tex) {
          const sm = new THREE.SpriteMaterial({ map: tex })
          sm.userData.temp = true
          const sp = new THREE.Sprite(sm)
          const long = el.code.length > 2
          sp.scale.set(long ? 0.68 : 0.34, 0.34, 1)
          sp.position.set(0, y0 + info.h + 0.32, 0)
          g.add(sp)
        }
      }
    }
    this._updateFill()
    if (this.selectedLocation && !this.locObjs[this.selectedLocation]) this.selectedLocation = null
    this._outlineLocation()
    if (this.editMode) this._outlineElement()
    this.dirty = true
  }

  // ---------- llenar canastas / percheros según el inventario ----------
  _updateFill() {
    if (!this.world) return
    const byLoc = {}
    for (const p of this.products) (byLoc[p.location_id] = byLoc[p.location_id] || []).push(p)
    const touched = new Set()
    for (const id in this.locObjs) {
      const o = this.locObjs[id]
      const items = (byLoc[id] || []).slice().sort((a, b) => a.size.localeCompare(b.size))
      const units = items.reduce((s, p) => s + p.qty, 0)
      const low = items.some((p) => p.min_qty > 0 && p.qty <= p.min_qty)
      if (o.kind === 'bin') {
        const h = clamp(units / 12, 0.12, 1) * BH * 0.78
        if (units > 0) this._setI(o.iFill, o.i, o.x, o.y + 0.02 + h / 2, -0.02, 1, h, 1)
        else this._setI(o.iFill, o.i, 0, 0, 0, 0, 0, 0)
        if (low) this._setI(o.iBar, o.i, o.x, o.y + BH * 0.43, BD / 2)
        else this._setI(o.iBar, o.i, 0, 0, 0, 0, 0, 0)
        o.iLab.setColorAt(o.i, this._col.setHex(units > 0 ? 0xf4f4f1 : 0x55585c))
        touched.add(o.iFill); touched.add(o.iBar); touched.add(o.iLab)
      } else if (o.kind === 'shelf') {
        const k = units > 0 ? Math.min(o.n, Math.ceil(units / 6)) : 0
        for (let j = 0; j < o.n; j++) {
          const x = -((o.n - 1) / 2) * o.pitch + j * o.pitch
          if (j < k) this._setI(o.bags, o.start + j, x, o.y + 0.32, 0)
          else this._setI(o.bags, o.start + j, 0, 0, 0, 0, 0, 0)
        }
        o.label.material.color.setHex(units > 0 ? 0xf4f4f1 : 0x55585c)
        o.bar.visible = low
        touched.add(o.bags)
      } else if (o.kind === 'rod') {
        let k = 0
        for (const p of items) {
          for (let i = 0; i < p.qty && k < o.cap; i++, k++) {
            const x = o.x0 + 0.07 + k * 0.066
            this._setI(o.jk, k, x, o.y - 0.35, 0); this._setI(o.cl, k, x, o.y - 0.09, 0)
            o.jk.setColorAt(k, this._col.setHex(colorForProduct(p.name)))
          }
        }
        o.jk.count = o.cl.count = k
        o.jk.visible = o.cl.visible = k > 0
        o.bar.visible = low
        touched.add(o.jk); touched.add(o.cl)
      } else if (o.kind === 'boxes') {
        o.bar.visible = low
      }
    }
    touched.forEach((im) => {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    })
    this.dirty = true
  }

  // ---------- cámara ----------
  _fitR(w, h) {
    const t = Math.tan((this.camera.fov * PI) / 360)
    return clamp(Math.max(h / (2 * t), w / (2 * t * this.camera.aspect)) + 0.4, 2.2, 26)
  }

  _setGoal(o) {
    if (o.th != null) {
      const c = this.goal.th
      const d = (((o.th - c) % (2 * PI)) + 3 * PI) % (2 * PI) - PI
      o = { ...o, th: c + d }
    }
    Object.assign(this.goal, o)
    this.dirty = true
  }

  _outlineLocation() {
    const o = this.selectedLocation && this.locObjs[this.selectedLocation]
    if (!o) { this.selLine.visible = false; this.dirty = true; return }
    this.selLine.scale.set(o.size.x + 0.03, o.size.y + 0.03, o.size.z + 0.03)
    this.selLine.position.copy(o.center)
    this.selLine.visible = true
    this.dirty = true
  }

  _outlineElement() {
    const el = this.selectedElement && this.layout.elements.find((e) => e.id === this.selectedElement)
    const info = el && this.elInfo[el.id]
    if (!info) { this.selLine.visible = false; this.dirty = true; return }
    const odd = (el.rot || 0) % 2 === 1
    this.selLine.scale.set((odd ? info.d : info.w) + 0.06, info.h + 0.06, (odd ? info.w : info.d) + 0.06)
    this.selLine.position.set(el.x, (info.y0 || 0) + info.h / 2, el.z)
    this.selLine.visible = true
    this.dirty = true
  }

  // ---------- entrada: orbitar, pellizcar, arrastrar en modo edición ----------
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
    let down = null, pinch0 = 0, r0 = 0, lastMid = null, drag = null

    const onDown = (e) => {
      dom.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }
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
        r0 = this.goal.r
        lastMid = null
        if (down) down.moved = true
        drag = null
      }
    }

    const onMove = (e) => {
      const p = pts.get(e.pointerId); if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      if (pts.size === 1) {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true
        if (!down || !down.moved) return
        if (drag) {
          const f = this._floorAt(e.clientX, e.clientY)
          const el = this.layout.elements.find((x) => x.id === drag.id)
          if (f && el) {
            el.x = snap(f.x - drag.ox); el.z = snap(f.z - drag.oz)
            this._clampIn(el)
            this.elGroups[el.id]?.position.set(el.x, 0, el.z)
            drag.moved = true
            this._outlineElement()
            this.dirty = true
          }
        } else {
          this.goal.th -= dx * 0.007
          this.goal.ph = clamp(this.goal.ph - dy * 0.006, 0.03, 1.52)
          this.dirty = true
        }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.goal.r = clamp((r0 * pinch0) / d, 2.2, 26)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        if (lastMid) {
          const s = this.goal.r * 0.0018, th = this.goal.th, mx = mid.x - lastMid.x, my = mid.y - lastMid.y
          const { width: W, depth: D } = this.layout.room
          if (this.goal.ph < 0.5) {
            this.goal.tx = clamp(this.goal.tx - (Math.cos(th) * mx + Math.sin(th) * my) * s, -W / 2, W / 2)
            this.goal.tz = clamp(this.goal.tz - (-Math.sin(th) * mx + Math.cos(th) * my) * s, -D / 2, D / 2)
          } else {
            this.goal.tx = clamp(this.goal.tx - Math.cos(th) * mx * s, -W / 2, W / 2)
            this.goal.tz = clamp(this.goal.tz + Math.sin(th) * mx * s, -D / 2, D / 2)
            this.goal.ty = clamp(this.goal.ty + my * s, 0, 2.8)
          }
        }
        lastMid = mid
        this.dirty = true
      }
    }

    const onUp = (e) => {
      pts.delete(e.pointerId)
      if (pts.size === 0) {
        if (drag && drag.moved) {
          const el = this.layout.elements.find((x) => x.id === drag.id)
          this.cb.onElementMoved?.(drag.id, el.x, el.z)
        } else if (down && !down.moved && performance.now() - down.t < 400) {
          this._tap(e.clientX, e.clientY)
        }
        down = null; drag = null
      }
      if (pts.size < 2) lastMid = null
    }

    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerup', onUp)
    dom.addEventListener('pointercancel', onUp)
    dom.addEventListener('wheel', (e) => {
      e.preventDefault()
      // el touchpad manda muchos eventos con delta chiquito; con un factor
      // mas alto (y un tope por evento) tanto el touchpad como una rueda de
      // mouse de un solo click alejan/acercan a una velocidad pareja.
      const factor = clamp(1 + e.deltaY * 0.003, 0.85, 1.18)
      this.goal.r = clamp(this.goal.r * factor, 2.2, 26)
      this.dirty = true
    }, { passive: false })
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

  // ---------- bucle de render ----------
  _loop(t) {
    if (this._disposed) return
    requestAnimationFrame(this._loop)
    const c = this.cur, g = this.goal
    let moving = false
    for (const k in g) {
      const d = g[k] - c[k]
      if (Math.abs(d) > 1e-4) { c[k] += d * 0.16; moving = true } else c[k] = g[k]
    }
    const pulsing = Date.now() < this.pulseUntil
    if (!moving && !this.dirty && !pulsing && !this._pulseWas) return
    this._pulseWas = pulsing
    this.dirty = false
    const sp = Math.sin(c.ph)
    this.camera.position.set(c.tx + c.r * sp * Math.sin(c.th), c.ty + c.r * Math.cos(c.ph), c.tz + c.r * sp * Math.cos(c.th))
    this.camera.lookAt(c.tx, c.ty, c.tz)
    for (const w of this.walls) w.m.visible = w.t(this.camera.position)
    this.selLine.material.opacity = pulsing ? 0.35 + 0.65 * Math.abs(Math.sin(t / 160)) : 1
    this.renderer.render(this.scene, this.camera)
  }
}
