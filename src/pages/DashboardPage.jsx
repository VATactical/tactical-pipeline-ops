import { useAuth } from '../auth/AuthContext'

const lifecycle = [
  { label: 'Onboarding', count: 0, tone: 'blue' },
  { label: 'A2P submitted', count: 0, tone: 'amber' },
  { label: 'Ads live', count: 0, tone: 'green' },
]

export default function DashboardPage() {
  const { profile } = useAuth()

  return (
    <div className="page-stack">
      <header className="page-header">
        <div><p className="eyebrow">Panel de operaciones</p><h2>Hola, {profile?.full_name || 'equipo'}</h2></div>
        <span className="status-pill">Sesión protegida</span>
      </header>

      <section className="metric-grid" aria-label="Estados de clientes">
        {lifecycle.map((item) => (
          <article className={`metric-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span><strong>{item.count}</strong><small>clientes</small>
          </article>
        ))}
      </section>

      <section className="content-card">
        <p className="eyebrow">Siguiente etapa</p>
        <h3>El acceso ya está separado por usuario y rol</h3>
        <p className="muted">Ahora podemos conectar clientes, tareas y directrices diarias sin exponer información entre roles.</p>
      </section>
    </div>
  )
}
