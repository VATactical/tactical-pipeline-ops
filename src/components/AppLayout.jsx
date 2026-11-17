import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { defaultCompany, loadCompanySettings, resolveCompanyLogo } from '../services/companyService'
import { LanguageToggle, useLanguage } from '../i18n/LanguageContext'
import { loadOwnEodState, loadUnreadEodCount } from '../services/eodService'
import TeamAvatar from './TeamAvatar'
import { NavIcon, PageTrailProvider, navGroups, sectionFor, usePageTrailState } from './navigation'

const roleLabels = {
  onboarding_media: 'Integrante del equipo',
  automation_funnels: 'GHL / Tecnología y Automatizaciones',
  superadmin: 'Superadmin',
  user_admin: 'Operaciones / CSM',
}

export default function AppLayout() {
  return <PageTrailProvider><AppShell /></PageTrailProvider>
}

function AppShell() {
  const { profile, user, signOut } = useAuth()
  const { t } = useLanguage()
  const location = useLocation()
  const [eodUnreadCount, setEodUnreadCount] = useState(0)
  const [company, setCompany] = useState(defaultCompany)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const pageTrail = usePageTrailState()
  const section = sectionFor(location.pathname)
  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
    window.localStorage.setItem('tp-theme', 'light')
  }, [])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const canReviewEod = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
    if (!canReviewEod) { setEodUnreadCount(0); return undefined }
    const refreshEodCount = () => loadUnreadEodCount(profile).then(setEodUnreadCount).catch(() => {})
    refreshEodCount()
    const timer = window.setInterval(refreshEodCount, 60000)
    window.addEventListener('focus', refreshEodCount)
    window.addEventListener('eod-review-updated', refreshEodCount)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshEodCount)
      window.removeEventListener('eod-review-updated', refreshEodCount)
    }
  }, [profile])

  useEffect(() => {
    loadCompanySettings().then(setCompany).catch(() => {})
    const updateCompany = (event) => setCompany(event.detail)
    window.addEventListener('company-settings-updated', updateCompany)
    return () => window.removeEventListener('company-settings-updated', updateCompany)
  }, [])


  // Browser tab names the place: "C4 Crystal Flowers · TP | Ops", "Clientes · TP | Ops".
  const pageName = pageTrail.length ? pageTrail[0].label : section ? t(section.label) : ''
  useEffect(() => {
    const system = company.system_name || 'TP | Ops'
    document.title = pageName ? `${pageName} · ${system}` : system
  }, [company.system_name, pageName])

  useEffect(() => {
    let favicon = document.querySelector('link[rel="icon"]')
    if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.appendChild(favicon) }
    favicon.href = resolveCompanyLogo(company.logo_url)
  }, [company])

  const logoUrl = resolveCompanyLogo(company.logo_url)

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      const state = await loadOwnEodState(profile)
      if (state.required && !state.submitted) {
        const confirmed = window.confirm(`${t(`Todavía no has enviado tu reporte EOD del ${state.workDate}.`)}\n\n${t('Debes enviarlo dentro de TP OPS al finalizar tu turno.')}\n\n${t('¿Cerrar sesión de todos modos?')}`)
        if (!confirmed) return
      }
      await signOut()
    } catch (error) {
      const confirmed = window.confirm(`${t(`No pudimos verificar el estado del EOD (${error.message}).`)} ${t('¿Cerrar sesión de todos modos?')}`)
      if (confirmed) await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="brand-logo" src={logoUrl} alt="Logo de TP | Ops" />
          <div><p className="eyebrow">{company.company_name}</p><h1>{company.system_name}</h1>{section && <p className="mobile-current-section">{t(section.label)}</p>}</div>
          <button
            className="mobile-menu-toggle"
            type="button"
            aria-controls="main-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span className="menu-lines" aria-hidden="true"><i /><i /><i /></span>
            <span>{mobileMenuOpen ? 'Cerrar' : 'Menú'}</span>
          </button>
        </div>

        <nav id="main-navigation" className={mobileMenuOpen ? 'mobile-open' : ''} aria-label="Navegación principal">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => !item.show || item.show(profile))
            if (!items.length) return null
            return <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{t(group.label)}</p>
              {items.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>
                <NavIcon name={item.icon} />
                <span className="nav-label">{t(item.label)}</span>
                {item.badge === 'eod' && eodUnreadCount > 0 && <span className="nav-badge" aria-label={`${eodUnreadCount} ${t('sin revisar')}`}>{eodUnreadCount}</span>}
              </NavLink>)}
            </div>
          })}
        </nav>

        <div className={`user-card${mobileMenuOpen ? ' mobile-open' : ''}`}>
          <div className="user-card-identity"><TeamAvatar avatarId={profile?.avatar_url} size="small" label={profile?.full_name || 'Avatar'} /><div><strong>{profile?.full_name || user?.email}</strong><span>{t(roleLabels[profile?.role] || 'Sin rol asignado')}</span></div></div>
          <LanguageToggle compact />
          <NavLink className="account-link" to="/mi-cuenta">Mi cuenta</NavLink>
          <button className="text-button" type="button" disabled={signingOut} onClick={handleSignOut}>{signingOut ? 'Verificando EOD…' : 'Cerrar sesión'}</button>
        </div>
      </aside>

      <main className="main-content"><div className="content-area">
        {section && <nav className="page-trail" aria-label={t('Ubicación')}>
          <NavIcon name={section.icon} />
          <span className="page-trail-group">{t(section.group)}</span>
          <span className="page-trail-sep" aria-hidden="true">›</span>
          {pageTrail.length ? <Link to={section.to}>{t(section.label)}</Link> : <span className="page-trail-current" aria-current="page">{t(section.label)}</span>}
          {pageTrail.map((crumb, index) => <span className="page-trail-step" key={`${crumb.label}-${index}`}>
            <span className="page-trail-sep" aria-hidden="true">›</span>
            {crumb.to && index < pageTrail.length - 1 ? <Link to={crumb.to} data-no-translate>{crumb.label}</Link> : <span className={index === pageTrail.length - 1 ? 'page-trail-current' : ''} aria-current={index === pageTrail.length - 1 ? 'page' : undefined} data-no-translate>{crumb.label}</span>}
          </span>)}
        </nav>}
        <Outlet />
      </div><footer className="app-footer"><img src={logoUrl} alt="" /><div><strong>{company.system_name}</strong><span>© {new Date().getFullYear()} {company.company_name}{company.company_email ? ` · ${company.company_email}` : ''}</span></div></footer></main>
    </div>
  )
}
