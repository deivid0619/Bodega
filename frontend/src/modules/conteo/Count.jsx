import { useEffect, useMemo, useState } from 'react'
import LocationPicker from '../../ui/LocationPicker'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../core/api'
import { refreshInventory, useLayout, useProducts } from '../../core/useApi'
import { useBarcodeScanner } from '../escaneo/useBarcodeScanner'
import { locationGroups } from '../../core/locationGroups'
import { itemsAt } from '../bodega/LocationSheet'
import { useToast } from '../../ui/ToastContext'
import Viewfinder, { PhotoRead } from '../escaneo/Viewfinder'
import Icon from '../../ui/Icon'
import { Empty, PageHead, Stepper, plural } from '../../ui/Bits'
import { beep } from '../../core/feedback'
import { fmtTime, sizeRank } from '../../core/utils'

const normCode = (raw) => String(raw || '').trim().toUpperCase().replace(/\s+/g, '')

// Una fila del conteo: lo que dice el sistema y lo que se conto aqui.
// Sin tocar queda "sin contar" y al guardar no se cambia.
function CountRow({ p, system, value, extra, onSet }) {
  const done = value != null
  const diff = done ? value - system : 0
  const state = !done ? '' : diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over'
  return (
    <div className={`count-row ${state}`}>
      <div className="sz">{p.size || 'U'}</div>
      <div className="count-t">
        <b>{p.name}</b>
        <small className="mono">{p.sku}</small>
        <span className="count-state">
          <span className="sys">{extra ? 'No estaba aquí' : `Sistema ${system}`}</span>
          {!done ? (
            system > 0
              ? <button type="button" className="link-btn" onClick={() => onSet(system)}><Icon name="check" size={14} stroke={2.6} />{system === 1 ? 'Está' : 'Están'}</button>
              : <button type="button" className="link-btn" onClick={() => onSet(0)}>No hay</button>
          ) : <b>{diff === 0 ? 'Cuadra' : diff < 0 ? `Faltan ${-diff}` : `Sobran ${diff}`}</b>}
        </span>
      </div>
      <Stepper
        onMinus={() => onSet((v) => Math.max(0, (v ?? 1) - 1))}
        onPlus={() => onSet((v) => (v ?? 0) + 1)}
        disabledMinus={value === 0}
        minusLabel="Una menos"
        plusLabel="Una más"
      >
        <input
          type="number"
          inputMode="numeric"
          value={value ?? ''}
          placeholder="—"
          aria-label={`Contadas de ${p.name} ${p.size}`}
          onChange={(e) => onSet(e.target.value === '' ? null : Math.max(0, Math.min(9999, Math.floor(+e.target.value) || 0)))}
        />
      </Stepper>
    </div>
  )
}

function PickLocation({ groups, onPick }) {
  const [recent, setRecent] = useState(null)
  useEffect(() => {
    api.get('/api/documents?kind=conteo&limit=6').then(setRecent).catch(() => setRecent([]))
  }, [])
  return (
    <>
      <div className="field" style={{ marginTop: 0 }}>
        <span className="field-label">¿Qué ubicación vas a contar?</span>
        <LocationPicker value="" onChange={(v) => v && onPick(v)} groups={groups} ariaLabel="Ubicación para contar" />
        <span className="field-hint">También puedes tocar una ubicación en la bodega 3D y elegir «Contar esta ubicación».</span>
      </div>
      {recent?.length > 0 && (
        <>
          <h2 className="h-sec">Contadas hace poco</h2>
          <div className="card panel">
            {recent.map((d) => {
              const where = d.number.split('@')[0]
              const fixed = d.lines.filter((l) => l.counted !== l.before).length
              return (
                <button type="button" className="need recent-count" key={d.id} onClick={() => onPick(where)}>
                  <span className="need-t">
                    <b className="mono">{where}</b>
                    <small>{plural(d.lines.length, 'código', 'códigos')} · {fixed ? plural(fixed, 'ajuste', 'ajustes') : 'todo cuadró'} · {d.user_name} · {fmtTime(d.created_at)}</small>
                  </span>
                  <Icon name="arrowRight" size={18} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

export default function Count() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [params, setParams] = useSearchParams()
  const loc = params.get('loc') || ''
  const { data: layout } = useLayout()
  const { data: products } = useProducts()
  const groups = useMemo(() => locationGroups(layout?.elements), [layout])
  const place = useMemo(() => groups.flatMap((g) => g.options).find((o) => o.id === loc), [groups, loc])
  const bySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products])

  const [counted, setCounted] = useState({})
  const [extra, setExtra] = useState([])
  const [manual, setManual] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [last, setLast] = useState(null)

  // otra ubicacion: conteo nuevo
  useEffect(() => {
    setCounted({})
    setExtra([])
    setResult(null)
    setLast(null)
    if (!loc) return
    api.get(`/api/documents?kind=conteo&prefix=${encodeURIComponent(`${loc}@`)}&limit=1`).then((l) => setLast(l[0] || null)).catch(() => {})
  }, [loc])

  const expected = useMemo(() => (products && loc ? itemsAt(products, loc) : [])
    .sort((a, b) => a.p.name.localeCompare(b.p.name) || sizeRank(a.p.size) - sizeRank(b.p.size)), [products, loc])
  const rows = [
    ...expected.map(({ p, here }) => ({ p, system: here, extra: false })),
    ...extra.filter((sku) => !expected.some((e) => e.p.sku === sku) && bySku.has(sku)).map((sku) => ({ p: bySku.get(sku), system: 0, extra: true })),
  ]

  const setOne = (sku, v) => setCounted((c) => ({ ...c, [sku]: typeof v === 'function' ? v(c[sku]) : v }))

  const handleCode = (raw) => {
    const sku = normCode(raw)
    if (!sku) return
    if (!bySku.has(sku)) {
      beep(false)
      showToast(`${sku} no está registrado. Regístralo desde Escanear.`, 'err')
      return
    }
    beep(true)
    setOne(sku, (v) => (v ?? 0) + 1)
    if (!expected.some((e) => e.p.sku === sku)) setExtra((x) => (x.includes(sku) ? x : [...x, sku]))
  }
  const scanner = useBarcodeScanner(handleCode)
  const camOn = scanner.status === 'on'
  useEffect(() => () => { scanner.stop() }, [scanner.stop])

  const done = rows.filter((r) => counted[r.p.sku] != null)
  const short = done.reduce((t, r) => t + Math.max(0, r.system - counted[r.p.sku]), 0)
  const over = done.reduce((t, r) => t + Math.max(0, counted[r.p.sku] - r.system), 0)

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.post('/api/documents/conteo', { location_id: loc, lines: done.map((r) => ({ sku: r.p.sku, qty: counted[r.p.sku] })) })
      await scanner.stop()
      refreshInventory()
      setResult(res.document)
      setLast(res.document)
      setCounted({})
      setExtra([])
      const fixed = res.document.lines.filter((l) => l.counted !== l.before).length
      showToast(fixed ? `Conteo de ${loc} guardado: ${plural(fixed, 'ajuste', 'ajustes')}` : `Conteo de ${loc}: todo cuadró`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No hay conexión. El conteo no se guardó; intenta de nuevo.', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page" aria-label="Conteo por ubicación">
      <div className="page-inner">
        <PageHead title="Conteo" lede={loc ? `${place?.name || loc}` : 'Cuenta lo que hay en una ubicación y corrige las diferencias.'}>
          {loc && <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}>Cambiar</button>}
        </PageHead>

        {!loc ? (
          layout ? <PickLocation groups={groups} onPick={(id) => setParams({ loc: id })} /> : <div className="skeleton" />
        ) : result ? (
          <div className="card panel-pad count-done rise">
            <span className="tag tag-in">Conteo guardado</span>
            <h2>{result.units ? plural(result.lines.filter((l) => l.counted !== l.before).length, 'ajuste', 'ajustes') : 'Todo cuadró'}</h2>
            <ul>
              {result.lines.map((l) => {
                const p = bySku.get(l.sku)
                return (
                  <li key={l.sku}>
                    <span>{p ? `${p.name}${p.size ? ` · ${p.size}` : ''}` : l.sku}</span>
                    <b className={l.counted === l.before ? 'ok' : ''}>{l.counted === l.before ? `${l.counted} ✓` : `${l.before} → ${l.counted}`}</b>
                  </li>
                )
              })}
            </ul>
            <div className="btn-row">
              <button className="btn btn-ghost" onClick={() => navigate(`/?loc=${encodeURIComponent(loc)}`)}><Icon name="warehouse" size={18} />Ver en 3D</button>
              <button className="btn btn-lime" onClick={() => setParams({})}>Contar otra</button>
            </div>
          </div>
        ) : (
          <>
            {last && (
              <p className="mode-hint" style={{ margin: '-6px 0 12px' }}>
                Último conteo aquí: {fmtTime(last.created_at)} · {last.user_name}
              </p>
            )}
            {camOn || scanner.status === 'fail' ? (
              <>
                <Viewfinder scanner={scanner} className="compact" />
                <button className="btn btn-ink btn-block" style={{ marginTop: 10 }} onClick={() => scanner.stop()}>
                  <Icon name="x" size={18} />Cerrar cámara
                </button>
              </>
            ) : (
              <button className="btn btn-lime btn-lg btn-block" onClick={scanner.start}>
                <Icon name="scan" size={20} />Contar escaneando
              </button>
            )}
            <PhotoRead scanner={scanner} onMiss={() => showToast('No encontré un código en la foto. Tómala más de cerca, derecha y con luz.', 'err')} />
            <div className="manual">
              <input
                className="input mono"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCode(manual); setManual('') } }}
                placeholder="Código a mano"
                autoCapitalize="characters"
                spellCheck="false"
                enterKeyHint="done"
                aria-label="Código"
              />
              <button className="btn btn-ink" onClick={() => { handleCode(manual); setManual('') }} disabled={!manual.trim()}>Sumar 1</button>
            </div>
            <p className="mode-hint">Cada escaneo suma 1 a esa prenda. También puedes escribir el número.</p>

            <h2 className="h-sec">Prendas <small>{done.length} de {rows.length} contadas</small></h2>
            {!products ? (
              <div className="skeleton" />
            ) : rows.length ? (
              <div className="card panel">
                {rows.map((r) => (
                  <CountRow key={r.p.sku} p={r.p} system={r.system} extra={r.extra} value={counted[r.p.sku]} onSet={(v) => setOne(r.p.sku, v)} />
                ))}
              </div>
            ) : (
              <Empty icon="scan" title="Vacía en el sistema">Escanea lo que encuentres aquí y queda contado.</Empty>
            )}

            <div className="count-footer">
              <p>
                {done.length
                  ? [short && `Faltan ${short}`, over && `Sobran ${over}`].filter(Boolean).join(' · ') || 'Todo lo contado cuadra'
                  : 'Lo que no cuentes se queda como está.'}
              </p>
              <button className="btn btn-lime btn-lg btn-block" disabled={!done.length || saving} onClick={save}>
                {saving ? 'Guardando…' : done.length ? `Guardar conteo (${plural(done.length, 'código', 'códigos')})` : 'Guardar conteo'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
