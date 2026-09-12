import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { loadDueNotificationCount } from '../services/calendarService'
import { defaultCompany, loadCompanySettings } from '../services/companyService'

const roleLabels = {
  onboarding_media: 'Onboarding & Media',
  automation_funnels: 'Automations & Funnels',
  superadmin: 'Superadmin',
  user_admin: 'User Admin',
}

export default function AppLayout() {
  const { profile, user, signOut } = useAuth()
  const [notificationCount, setNotificationCount] = useState(0)
  const [company, setCompany] = useState(defaultCompany)

  useEffect(() => {
    const refreshCount = () => loadDueNotificationCount().then(setNotificationCount).catch(() => {})
    refreshCount()
    const timer = window.setInterval(refreshCount, 60000)
    window.addEventListener('focus', refreshCount)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshCount) }
  }, [])

  useEffect(() => {
    loadCompanySettings().then(setCompany).catch(() => {})
    const updateCompany = (event) => setCompany(event.detail)
    window.addEventListener('company-settings-updated', updateCompany)
    return () => window.removeEventListener('company-settings-updated', updateCompany)
  }, [])

  useEffect(() => {
    document.title = company.system_name || 'TP | Ops'
    let favicon = document.querySelector('link[rel="icon"]')
    if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.appendChild(favicon) }
    favicon.href = company.logo_url || '/favicon.png'
  }, [company])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <img className="brand-logo" src={company.logo_url || '/tp-logo.png'} alt="" />
          <div><p className="eyebrow">{company.company_name}</p><h1>{company.system_name}</h1></div>
        </div>

        <nav aria-label="Navegación principal">
          <NavLink to="/" end>Panel</NavLink>
          <NavLink to="/clientes">Clientes</NavLink>
          <NavLink to="/tareas">Tareas</NavLink>
          <NavLink to="/calendario">Calendario{notificationCount > 0 && <span className="nav-badge">{notificationCount}</span>}</NavLink>
          <NavLink to="/training">Training</NavLink>
          <NavLink to="/mi-equipo">Mi equipo</NavLink>
          <NavLink to="/eod-reports">EOD Reports</NavLink>
          {profile?.role === 'superadmin' && <NavLink to="/equipo">Usuarios</NavLink>}
          {profile?.role === 'superadmin' && <NavLink to="/mi-empresa">Mi empresa</NavLink>}
        </nav>

        <div className="user-card">
          <strong>{profile?.full_name || user?.email}</strong>
          <span>{roleLabels[profile?.role] || 'Sin rol asignado'}</span>
          <NavLink className="account-link" to="/mi-cuenta">Mi cuenta</NavLink>
          <button className="text-button" type="button" onClick={signOut}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="main-content"><div className="content-area"><Outlet /></div><footer className="app-footer"><img src={company.logo_url || '/tp-logo.png'} alt="" /><div><strong>{company.system_name}</strong><span>© {new Date().getFullYear()} {company.company_name}{company.company_email ? ` · ${company.company_email}` : ''}</span><small>Hecho por Diego Romario · Nicaragua</small></div></footer></main>
    </div>
  )
}
