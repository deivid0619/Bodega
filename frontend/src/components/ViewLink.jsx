import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import { useConfirm } from './ConfirmContext'
import Icon from './Icon'

const urlOf = (l) => `${window.location.origin}/?ver=${l.key}`

// Los enlaces para ver sin editar, uno por persona (un jefe, un socio...):
// quien lo abre entra sin contrasena con su nombre, ve todo en vivo y no
// puede cambiar nada. El administrador los crea, les cambia el nombre, los
// copia o comparte, y los quita (quien lo estaba usando sale).
export default function ViewLink() {
  const showToast = useToast()
  const confirm = useConfirm()
  const [links, setLinks] = useState(null)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null) // id del que se esta renombrando
  const [draft, setDraft] = useState('')
  const canShare = typeof navigator.share === 'function'
  useEffect(() => {
    api.get('/api/auth/view-links').then(setLinks).catch(() => setLinks([]))
  }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!who.trim()) return
    setBusy(true)
    try {
      const l = await api.post('/api/auth/view-links', { name: who.trim() })
      setLinks((ls) => [...(ls || []), l])
      setWho('')
      showToast(`Enlace para ${l.name} creado: cópialo o compártelo`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo crear el enlace.', 'err')
    } finally {
      setBusy(false)
    }
  }
  const rename = async (e, l) => {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    try {
      const n = await api.patch(`/api/auth/view-links/${l.id}`, { name })
      setLinks((ls) => ls.map((x) => (x.id === l.id ? n : x)))
      setEditing(null)
      showToast(`Ahora se llama ${n.name}`)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar el nombre.', 'err')
    }
  }
  const remove = async (l) => {
    if (!(await confirm({
      title: `¿Quitar el enlace de ${l.name || 'esta persona'}?`,
      body: 'Deja de abrir y, si lo estaba usando, sale de la app.',
      confirmLabel: 'Quitar',
    }))) return
    try {
      await api.delete(`/api/auth/view-links/${l.id}`)
      setLinks((ls) => ls.filter((x) => x.id !== l.id))
      showToast('Enlace quitado')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'No se pudo quitar.', 'err')
    }
  }
  const copy = async (l) => {
    try {
      await navigator.clipboard.writeText(urlOf(l))
      showToast(`Enlace de ${l.name} copiado: pégalo en WhatsApp o en un correo`)
    } catch {
      showToast('Este dispositivo no dejó copiar: usa "Compartir".', 'err')
    }
  }
  // que avisos le van marcados de entrada (al registrar igual se puede cambiar)
  const setNotify = async (l, key) => {
    const next = { ...l.notify, [key]: !l.notify?.[key] }
    setLinks((ls) => ls.map((x) => (x.id === l.id ? { ...x, notify: next } : x)))
    try {
      const n = await api.put(`/api/auth/view-links/${l.id}/notify`, next)
      setLinks((ls) => ls.map((x) => (x.id === l.id ? n : x)))
    } catch (err) {
      setLinks((ls) => ls.map((x) => (x.id === l.id ? l : x)))
      showToast(err instanceof ApiError ? err.message : 'No se pudo cambiar.', 'err')
    }
  }
  const share = async (l) => {
    try {
      await navigator.share({ title: 'Bodega · solo ver', text: `${l.name}: la bodega de Pigmalion. Puedes ver todo, sin cambiar nada.`, url: urlOf(l) })
    } catch { /* se cerro sin compartir */ }
  }

  return (
    <div className="card view-link">
      <div className="view-link-t">
        <b>Enlaces para ver (sin editar)</b>
        <small>Uno por persona: entra sin contraseña con su nombre, ve todo en vivo y no puede cambiar nada. Se puede instalar como app. Le llegan los avisos que le mandes al registrar una remisión, unas entradas o unas salidas.</small>
      </div>
      {links?.map((l) => (
        <div className="vl-row" key={l.id}>
          {editing === l.id ? (
            <form className="vl-edit" onSubmit={(e) => rename(e, l)}>
              <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} autoFocus aria-label="Nombre" />
              <button className="btn btn-ink btn-sm" disabled={!draft.trim()}>Guardar</button>
              <button type="button" className="link-btn" onClick={() => setEditing(null)}>Cancelar</button>
            </form>
          ) : (
            <div className="vl-head">
              <span className="vl-ico" aria-hidden="true">{(l.name || '?').charAt(0).toUpperCase()}</span>
              <span className="vl-t"><b>{l.name || 'Sin nombre'}</b><small>{l.used ? 'Ya entró' : 'Todavía no lo ha abierto'}</small></span>
            </div>
          )}
          <div className="vl-notify">
            <span>Avisarle<small>Va marcado al registrar; ahí puedes cambiarlo</small></span>
            {[['remision', 'Remisiones'], ['entradas', 'Entradas'], ['salidas', 'Salidas']].map(([k, label]) => (
              <button key={k} type="button" className="chip" aria-pressed={!!l.notify?.[k]} onClick={() => setNotify(l, k)}
                      aria-label={`Avisarle a ${l.name || 'esta persona'}: ${label.toLowerCase()}`}>
                {l.notify?.[k] && <Icon name="check" size={14} stroke={2.6} />}{label}
              </button>
            ))}
          </div>
          <div className="vl-actions">
            <button type="button" className="btn btn-lime btn-sm" onClick={() => copy(l)}><Icon name="copy" size={16} />Copiar</button>
            {canShare && <button type="button" className="btn btn-ghost btn-sm" onClick={() => share(l)}>Compartir</button>}
            <button type="button" className="link-btn" onClick={() => { setEditing(l.id); setDraft(l.name) }}>Cambiar nombre</button>
            <button type="button" className="link-btn" onClick={() => remove(l)}>Quitar</button>
          </div>
        </div>
      ))}
      <form className="vl-new" onSubmit={create}>
        <label className="field" style={{ marginTop: 0 }}>
          <span className="field-label">Nuevo enlace: ¿para quién es?</span>
          <input className="input" value={who} onChange={(e) => setWho(e.target.value)} maxLength={60} placeholder="Ej. Gabriel" />
        </label>
        <button className="btn btn-ink btn-block" disabled={busy || !who.trim() || !links}>{busy ? 'Creando…' : 'Crear enlace para ver'}</button>
      </form>
    </div>
  )
}
