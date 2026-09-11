import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const roleLabels = {
  onboarding_media: 'Onboarding & Media',
  automation_funnels: 'Automations & Funnels',
  superadmin: 'Superadmin',
}

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-mark">TP</div>
          <p className="eyebrow">VA Tactical</p>
          <h1>Tactical Pipeline</h1>
        </div>

        <nav aria-label="Navegación principal">
          <NavLink to="/" end>Panel</NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
          <NavLink to="/tareas">Tareas</NavLink>
          {profile?.role === 'superadmin' && <NavLink to="/equipo">Equipo</NavLink>}
        </nav>

        <div className="user-card">
          <strong>{profile?.full_name || user?.email}</strong>
          <span>{roleLabels[profile?.role] || 'Sin rol asignado'}</span>
          <button className="text-button" type="button" onClick={signOut}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="main-content"><Outlet /></main>
    </div>
  )
}
