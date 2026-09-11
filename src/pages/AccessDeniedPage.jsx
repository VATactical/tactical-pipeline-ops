import { Link } from 'react-router-dom'

export default function AccessDeniedPage() {
  return (
    <main className="centered-page">
      <div className="brand-mark">TP</div>
      <h1>Acceso restringido</h1>
      <p>Tu sesión es válida, pero tu rol no tiene permiso para abrir esta sección.</p>
      <Link className="primary-button link-button" to="/">Volver al panel</Link>
    </main>
  )
}
