import { NavLink } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'

// Sub-pages of "Mi equipo": the team directory and the Training hub.
export default function TeamSubnav() {
  const { t } = useLanguage()
  return <nav className="team-subnav" aria-label={t('Mi equipo')}>
    <NavLink to="/mi-equipo" end>{t('Directorio')}</NavLink>
    <NavLink to="/mi-equipo/training">Training</NavLink>
  </nav>
}
