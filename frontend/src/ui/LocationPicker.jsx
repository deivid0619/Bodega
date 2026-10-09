import { useMemo, useState } from 'react'
import Sheet, { SheetHeader, useSheet } from './Sheet'
import Icon from './Icon'
import { SearchField } from './Bits'

// Elegir una ubicacion sin bajar por una lista larga: se busca ("A2",
// "canasta 5", "perchero B") o se toca el mueble, y se elige de una lista
// agrupada. Reemplaza al <select> con optgroups de locationGroups().

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const compact = (s) => fold(s).replace(/[^a-z0-9]/g, '')

// Cada palabra tiene que estar. Las cortas (una letra o un numero: "b", "4",
// "A2") van completas o al principio o al final del codigo, para que "perchero
// b" no encuentre la b de "barra".
export function matchLocation(l, group, q) {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold(`${l.name} ${l.id} ${group}`)
  const tight = compact(`${l.name} ${l.id} ${group}`)
  const parts = hay.split(/[^a-z0-9]+/)
  const id = compact(l.id)
  return words.every((w) => {
    const c = compact(w)
    if (c.length <= 2) return parts.includes(c) || id.startsWith(c) || id.endsWith(c)
    return hay.includes(w) || tight.includes(c)
  })
}

function PickerBody({ value, onPick, groups, emptyLabel }) {
  const { close } = useSheet()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(null) // un mueble
  const shown = useMemo(() => groups
    .filter((g) => !only || g.label === only)
    .map((g) => ({ ...g, options: g.options.filter((l) => matchLocation(l, g.label, q)) }))
    .filter((g) => g.options.length), [groups, only, q])
  const count = shown.reduce((t, g) => t + g.options.length, 0)
  const pick = (id) => { onPick(id); close() }
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  return (
    <>
      <SheetHeader title="¿Dónde?" subtitle="Busca la ubicación o toca el mueble." />
      <SearchField value={q} onChange={setQ} placeholder="Ej. A2, canasta 5, perchero B" autoFocus={!touch} aria-label="Buscar ubicación" />
      <div className="lp-chips" role="toolbar" aria-label="Muebles">
        <button type="button" className="chip" aria-pressed={!only} onClick={() => setOnly(null)}>Todos</button>
        {groups.map((g) => (
          <button key={g.label} type="button" className="chip" aria-pressed={only === g.label} onClick={() => setOnly(only === g.label ? null : g.label)}>
            {g.label}
          </button>
        ))}
      </div>
      <div className="lp-list">
        {emptyLabel != null && !q && !only && (
          <button type="button" className={`lp-row auto${!value ? ' on' : ''}`} onClick={() => pick('')}>
            <span className="lp-t">{emptyLabel}</span>
            {!value && <Icon name="check" size={18} stroke={2.6} />}
          </button>
        )}
        {shown.map((g) => (
          <section key={g.label} className="lp-group" aria-label={g.label}>
            <h4>{g.label}<small>{g.options.length}</small></h4>
            {g.options.map((l) => (
              <button key={l.id} type="button" className={`lp-row${value === l.id ? ' on' : ''}`} onClick={() => pick(l.id)}>
                <span className="code dark"><Icon name="pin" size={12} stroke={2.2} />{l.id}</span>
                <span className="lp-t">{l.name}</span>
                {value === l.id && <Icon name="check" size={18} stroke={2.6} />}
              </button>
            ))}
          </section>
        ))}
        {!count && <p className="mode-hint">No hay ubicaciones con “{q}”{only ? ` en ${only}` : ''}.</p>}
      </div>
    </>
  )
}

// Solo la hoja de elegir (sin el boton): para abrirla desde otro lado, como
// la ubicacion de una prenda en la lista de Escanear. onClose al cerrarla.
export function LocationPickerSheet({ value, onChange, groups, emptyLabel, onClose }) {
  return (
    <Sheet modal onClose={onClose} label="Elegir ubicación">
      <PickerBody value={value} onPick={onChange} groups={groups || []} emptyLabel={emptyLabel} />
    </Sheet>
  )
}

// value: id de la ubicacion ('' = automatica, si hay emptyLabel)
export default function LocationPicker({ value, onChange, groups, emptyLabel, fallbackLabel, placeholder = 'Elige la ubicación', ariaLabel = 'Ubicación', className = '' }) {
  const [open, setOpen] = useState(false)
  const current = useMemo(() => {
    for (const g of groups || []) {
      const l = g.options.find((o) => o.id === value)
      if (l) return l
    }
    return null
  }, [groups, value])
  const label = current ? current.name : value ? (fallbackLabel || value) : emptyLabel ?? placeholder
  return (
    <>
      <button type="button" className={`input lp-btn ${className}`} onClick={() => setOpen(true)} aria-label={`${ariaLabel}: ${label}`} aria-haspopup="dialog">
        {current && <span className="code dark">{current.id}</span>}
        <span className={`lp-btn-t${!current && !value && emptyLabel == null ? ' ph' : ''}`}>{label}</span>
        <Icon name="search" size={17} stroke={2.2} />
      </button>
      {open && (
        <Sheet modal onClose={() => setOpen(false)} label="Elegir ubicación">
          <PickerBody value={value} onPick={onChange} groups={groups || []} emptyLabel={emptyLabel} />
        </Sheet>
      )}
    </>
  )
}
