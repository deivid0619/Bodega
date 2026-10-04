import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../api'
import { BrandMark } from '../components/Icon'

function Stripes() {
  return (
    <svg className="login-stripes" viewBox="0 0 420 420" aria-hidden="true">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C0FF00" stopOpacity=".5" />
          <stop offset="1" stopColor="#C0FF00" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${150 + i * 46} 0h26L${96 + i * 46} 420H${70 + i * 46}z`} fill="url(#fade)" opacity={1 - i * 0.13} />
      ))}
    </svg>
  )
}

export default function Login() {
  const { token, ready, login, register } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (ready && token) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, name, inviteCode)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No hay conexión con el servidor. Revisa tu internet e intenta otra vez.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <Stripes />
      <div className="login-box">
        <div className="login-brand">
          <BrandMark size={38} />
          <span className="brand-word">bodega</span>
        </div>
        <form onSubmit={submit}>
          {mode === 'register' && (
            <label className="field">
              <span className="field-label">Nombre</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span className="field-label">Correo</span>
            <input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="field">
            <span className="field-label">Contraseña</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span className="field-label">Código de invitación</span>
              <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
            </label>
          )}
          {error && <p className="form-err" role="alert">{error}</p>}
          <button className="btn btn-lime btn-lg btn-block" style={{ marginTop: 24 }} disabled={busy}>
            {busy ? 'Entrando…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
        <button type="button" className="login-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
          {mode === 'login' ? 'Crear cuenta' : 'Ya tengo cuenta'}
        </button>
      </div>
    </div>
  )
}
