import { NavLink } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'

// Sub-pages of "Mi empresa": company identity and the onboarding checklist template.
export default function CompanySubnav() {
  const { t } = useLanguage()
  return <nav className="team-subnav" aria-label={t('Mi empresa')}>
    <NavLink to="/mi-empresa" end>{t('Empresa')}</NavLink>
    <NavLink to="/mi-empresa/checklist">{t('Checklist')}</NavLink>
  </nav>
}
