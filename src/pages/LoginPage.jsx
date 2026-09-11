import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!loading && user) return <Navigate to="/" replace />

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      await signIn(email.trim(), password)
      navigate(location.state?.from?.pathname || '/', { replace: true })
    } catch (signInError) {
      setError(signInError.message === 'Invalid login credentials'
        ? 'El correo o la contraseña no son correctos.'
        : signInError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand-mark large">TP</div>
        <p className="eyebrow">VA Tactical</p>
        <h1>Una operación clara para cada cliente.</h1>
        <p>Onboarding, A2P y campañas en un solo panel de trabajo.</p>
      </section>

      <section className="login-card">
        <p className="eyebrow">Acceso del equipo</p>
        <h2>Iniciar sesión</h2>
        <p className="muted">Usa las credenciales asignadas por el administrador.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Correo</label>
          <input id="email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required />

          <label htmlFor="password">Contraseña</label>
          <div className="password-field">
            <input id="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" value={password}
              onChange={(event) => setPassword(event.target.value)} required />
            <button className="password-toggle" type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}>
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.8 10.8 0 0112 4c5 0 8.5 4.1 9.5 6.1a4.2 4.2 0 010 3.8 15 15 0 01-2.1 3M6.6 6.6a15 15 0 00-4.1 3.5 4.2 4.2 0 000 3.8C3.5 15.9 7 20 12 20a10.8 10.8 0 004.1-.8" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 10.1a4.2 4.2 0 000 3.8C3.5 15.9 7 20 12 20s8.5-4.1 9.5-6.1a4.2 4.2 0 000-3.8C20.5 8.1 17 4 12 4s-8.5 4.1-9.5 6.1z" /><circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  )
}
