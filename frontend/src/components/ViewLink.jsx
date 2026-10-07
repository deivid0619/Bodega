import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useToast } from './ToastContext'
import { useConfirm } from './ConfirmContext'
import Icon from './Icon'

// El enlace para ver sin editar: para mostrar la app (a un jefe, a un socio)
// sin que pueda cambiar nada. Quien lo abre entra sin contrasena como "Solo
// ver". Se copia o se comparte; crear otro o desactivarlo cierra el anterior.
export default function ViewLink() {
  const showToast = useToast()
  const confirm = useConfirm()
  const [link, setLink] = useState(null) // { active, key, name }
  const [who, setWho] = useState('') // para quien es: su cuenta se llama asi
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get('/api/auth/view-link').then(setLink).catch(() => setLink({ active: false }))
  }, [])
  const url = link?.key ? `${window.location.origin}/?ver=${link.key}` : ''
  const canShare = typeof navigator.share === 'function'

  const create = async () => {
    if (link?.active && !(await confirm({
      title: '¿Crear otro enlace?',
      body: 'El enlace de ahora deja de funcionar y quien lo esté usando sale.',
      confirmLabel: 'Crear otro',
    }))) return
    setBusy(true)
    try {
      setLink(await api.post('/api/auth/view-link', { name: (who || link?.name || '').trim() }))
      setWho('')
      showToast('Enlace para ver creado: cópialo y compártelo')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo crear el enlace.', 'err')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!(await confirm({
      title: '¿Desactivar el enlace?',
      body: 'Deja de abrir y quien lo esté usando sale de la app.',
      confirmLabel: 'Desactivar',
    }))) return
    try {
      await api.delete('/api/auth/view-link')
      setLink({ active: false })
      showToast('Enlace desactivado')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'No se pudo desactivar.', 'err')
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      showToast('Enlace copiado: pégalo en WhatsApp o en un correo')
    } catch {
      showToast('Este dispositivo no dejó copiar: mantén presionado el enlace para copiarlo.', 'err')
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'Bodega · solo ver', text: `${link?.name ? `${link.name}: ` : ''}la bodega de Pigmalion. Puedes ver todo, sin cambiar nada.`, url })
    } catch { /* se cerro sin compartir */ }
  }

  return (
    <div className="card view-link">
      <div className="view-link-t">
        <b>Enlace para ver (sin editar)</b>
        <small>Para mostrar la app: quien lo abre entra sin contraseña, ve todo y no puede cambiar nada.</small>
      </div>
      {link?.active ? (
        <>
          {link.name && <p className="view-link-who">Para <b>{link.name}</b> · entra como “{link.name}”, solo para ver</p>}
          <input className="input mono view-link-url" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Enlace para ver" />
          <div className="btn-row">
            <button type="button" className="btn btn-lime" onClick={copy}><Icon name="copy" size={18} />Copiar</button>
            {canShare && <button type="button" className="btn btn-ghost" onClick={share}>Compartir</button>}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-quiet" onClick={create} disabled={busy}>Crear otro</button>
            <button type="button" className="btn btn-quiet" onClick={stop}>Desactivar</button>
          </div>
        </>
      ) : (
        <>
          <label className="field" style={{ marginTop: 0 }}>
            <span className="field-label">¿Para quién es? <small className="opt">su cuenta se llama así</small></span>
            <input className="input" value={who} onChange={(e) => setWho(e.target.value)} maxLength={60} placeholder="Ej. Gabriel" />
          </label>
          <button type="button" className="btn btn-ink btn-block" onClick={create} disabled={busy || !link}>
            {busy ? 'Creando…' : 'Crear enlace para ver'}
          </button>
        </>
      )}
    </div>
  )
}
