import { useEffect, useState } from 'react'
import { useInstall } from '../../core/install'
import { currentSubscription, disablePush, enablePush, pushSupported, testPush } from './push'
import { useToast } from '../../ui/ToastContext'
import Icon from '../../ui/Icon'

// Recibir los avisos en este celular (aunque la app este cerrada)
export default function PushBox({ prefs = {}, onState, intro = 'Te llegan aunque la app esté cerrada.' }) {
  const install = useInstall()
  const showToast = useToast()
  const [push, setPush] = useState('checking') // checking | off | on | blocked | unsupported
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pushSupported()) { setPush('unsupported'); return }
    if (Notification.permission === 'denied') { setPush('blocked'); return }
    currentSubscription().then((s) => setPush(s ? 'on' : 'off')).catch(() => setPush('off'))
  }, [])
  useEffect(() => { onState?.(push) }, [push, onState])

  const turnOn = async () => {
    setBusy(true)
    try {
      await enablePush(prefs)
      setPush('on')
      showToast('Listo: los avisos llegan a este celular')
    } catch (e) {
      if (e?.message === 'denied') setPush('blocked')
      else showToast(e?.message === 'default' ? 'No se activaron los avisos.' : 'No se pudieron activar los avisos en este navegador.', 'err')
    } finally {
      setBusy(false)
    }
  }
  const turnOff = async () => {
    setBusy(true)
    await disablePush()
    setPush('off')
    setBusy(false)
  }
  const tryIt = async () => {
    try {
      await testPush()
      showToast('Aviso de prueba enviado')
    } catch {
      showToast('No se pudo enviar el aviso de prueba.', 'err')
    }
  }

  return (
    <div className="push-box">
      <b>En este celular</b>
      {push === 'checking' && <span>Revisando…</span>}
      {push === 'unsupported' && (
        <span>{install.ios && !install.standalone
          ? 'En iPhone, primero instala la app: Compartir → Agregar a pantalla de inicio. Después actívalos aquí.'
          : 'Este navegador no recibe avisos con la app cerrada.'}</span>
      )}
      {push === 'blocked' && <span>Bloqueados para Bodega. Actívalos en los ajustes del navegador para este sitio.</span>}
      {push === 'off' && (
        <>
          <span>{intro}</span>
          <button className="btn btn-lime btn-sm btn-block" disabled={busy} onClick={turnOn}>
            <Icon name="bell" size={17} />Recibir avisos aquí
          </button>
        </>
      )}
      {push === 'on' && (
        <>
          <span className="on"><Icon name="check" size={15} stroke={2.6} />Activos en este celular</span>
          <div className="push-actions">
            <button className="btn btn-quiet btn-sm" onClick={tryIt}>Probar</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={turnOff}>Apagar</button>
          </div>
        </>
      )}
    </div>
  )
}
