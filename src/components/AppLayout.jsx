import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { loadDueNotificationCount } from '../services/calendarService'

const roleLabels = {
  onboarding_media: 'Onboarding & Media',
  automation_funnels: 'Automations & Funnels',
  superadmin: 'Superadmin',
  user_admin: 'User Admin',
}

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()
  const [notificationCount, setNotificationCount] = useState(0)

  useEffect(() => {
    const refreshCount = () => loadDueNotificationCount().then(setNotificationCount).catch(() => {})
    refreshCount()
    const timer = window.setInterval(refreshCount, 60000)
    window.addEventListener('focus', refreshCount)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshCount) }
  }, [])

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
          <NavLink to="/calendario">Calendario{notificationCount > 0 && <span className="nav-badge">{notificationCount}</span>}</NavLink>
          <NavLink to="/training">Training</NavLink>
          <NavLink to="/eod-reports">EOD Reports</NavLink>
          {profile?.role === 'superadmin' && <NavLink to="/equipo">Usuarios</NavLink>}
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
