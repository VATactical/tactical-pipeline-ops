import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { user, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
          <input id="password" type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  )
}
