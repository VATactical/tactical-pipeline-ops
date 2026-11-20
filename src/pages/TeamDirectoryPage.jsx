import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import LoadingScreen from '../components/LoadingScreen'
import TeamAvatar from '../components/TeamAvatar'
import TeamSubnav from '../components/TeamSubnav'
import { contactLink, loadTeamMembers } from '../services/profileService'

const CHANNELS = [
  ['#announcements', 'Actualizaciones para toda la agencia, políticas, logros y directrices de dirección. Solo lectura.'],
  ['#daily-comms-hub', 'Colaboración en tiempo real, consultas rápidas y actualizaciones activas durante la jornada.'],
  ['#active-projects', 'Campañas en curso, optimización de anuncios, iteraciones creativas y estados de A2P.'],
  ['#client-ops', 'Escalado de cuentas, atención personalizada y cambios de estado de clientes.'],
  ['#eod-reports', 'Registros de cierre diario enviados antes de finalizar el turno.'],
]
const cleanName = (value) => String(value || '').replace(/\s+/g, ' ').trim()
const cityOf = (zone) => String(zone || '').split('/').pop().replace(/_/g, ' ')

// Minutes between a time zone and New York right now (EOD and the team schedule use EST).
function offsetFromEst(zone, now) {
  try {
    const at = (timeZone) => new Date(now.toLocaleString('en-US', { timeZone }))
    return Math.round((at(zone) - at('America/New_York')) / 60000)
  } catch {
    return 0
  }
}

function LocalTime({ zone, now, locale, t }) {
  let time = ''
  try { time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(now) } catch { return <span>{zone || '—'}</span> }
  const diff = offsetFromEst(zone, now)
  const hours = Math.abs(diff) / 60
  const label = diff === 0 ? t('misma hora que EST') : `${diff > 0 ? '+' : '−'}${Number.isInteger(hours) ? hours : hours.toFixed(1)} h ${t('vs EST')}`
  return <span className="team-time"><strong>{time}</strong> · {cityOf(zone)} <small>({label})</small></span>
}

function CopyButton({ value, t }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return <button type="button" className="team-copy" aria-label={t('Copiar')} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }}>{copied ? t('Copiado') : t('Copiar')}</button>
}

export default function TeamDirectoryPage() {
  const { profile } = useAuth()
  const { language, locale, t } = useLanguage()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { loadTeamMembers().then(setMembers).catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [])
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer) }, [])

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    const visible = members.filter((member) => !term || [member.full_name, member.email, member.job_title_es, member.job_title_en, member.department_es]
      .some((value) => String(value || '').toLowerCase().includes(term)))
    const byDepartment = new Map()
    for (const member of visible) {
      const key = (language === 'en' ? member.department_en : member.department_es) || t('Sin departamento')
      if (!byDepartment.has(key)) byDepartment.set(key, { name: key, sort: member.department_sort ?? 999, members: [] })
      byDepartment.get(key).members.push(member)
    }
    return [...byDepartment.values()].sort((a, b) => a.sort - b.sort)
  }, [members, search, language, t])

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <TeamSubnav />
    <header className="page-header">
      <div><p className="eyebrow">{t('Directorio interno')}</p><h2>{t('Mi equipo')}</h2><p className="muted">{t('Quién hace qué, su hora local y cómo contactarlo.')}</p></div>
      <span className="status-pill">{members.length} {t('integrantes')}</span>
    </header>
    {error && <p className="form-error">{error}</p>}
    <div className="team-toolbar"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar por nombre, puesto o correo')} /></div>

    <div className="directory-grid team-directory-grid">{groups.flatMap((group) => group.members.map((member) => ({ member, department: group.name }))).map(({ member, department }) => {
        const name = cleanName(member.full_name) || t('Usuario')
        const isMe = member.id === profile?.id
        const slack = contactLink(member.slack_contact, 'slack')
        const whatsapp = contactLink(member.whatsapp_contact, 'whatsapp')
        const title = (language === 'en' ? member.job_title_en : member.job_title_es) || t('Sin puesto asignado')
        return <article className={`content-card directory-card team-card ${isMe ? 'is-me' : ''}`} key={member.id}>
          <p className="eyebrow team-department">{department}</p>
          <div className="profile-identity">
            <TeamAvatar avatarId={member.avatar_url} label={name} />
            <div><h3 data-no-translate>{name} {isMe && <span className="team-me">{t('Tú')}</span>}</h3><span>{title}</span></div>
          </div>
          {member.job_description_es && language !== 'en' && <p className="team-job">{member.job_description_es}</p>}
          <div className="team-clock"><LocalTime zone={member.timezone} now={now} locale={locale} t={t} /></div>
          <ul className="team-contacts">
            <li><span>{t('Correo')}</span><a href={`mailto:${member.email}`} data-no-translate>{member.email}</a><CopyButton value={member.email} t={t} /></li>
            <li><span>Slack</span>{slack ? <a href={slack} target="_blank" rel="noreferrer" data-no-translate>@{name}</a> : <em>{t('Sin vincular')}</em>}</li>
            <li><span>WhatsApp</span>{whatsapp ? <><a href={whatsapp} target="_blank" rel="noreferrer" data-no-translate>{member.whatsapp_contact}</a><CopyButton value={member.whatsapp_contact} t={t} /></>
              : isMe ? <Link to="/mi-cuenta">{t('Agregar mi WhatsApp')}</Link> : <em>{t('No registrado')}</em>}</li>
          </ul>
          <div className="contact-actions">
            {slack && <a className="primary-button compact-button" href={slack} target="_blank" rel="noreferrer">{t('Escribir en Slack')}</a>}
            <a className="secondary-button compact-button" href={`mailto:${member.email}`}>{t('Correo')}</a>
            {whatsapp && <a className="secondary-button compact-button" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}
          </div>
        </article>
      })}</div>
    {!groups.length && <p className="muted">{t('Nadie coincide con la búsqueda.')}</p>}

    <section className="content-card communication-guidelines"><div className="section-heading"><div><p className="eyebrow">Slack</p><h3>{t('Canales y propósito')}</h3><p className="muted">{t('Slack es para comunicarnos; TP OPS es la fuente principal para tareas, estados y KPI.')}</p></div></div>
      <div className="channel-guideline-list">{CHANNELS.map(([channel, description]) => <article key={channel}><strong>{channel}</strong><span>{t(description)}</span></article>)}</div></section>
  </div>
}
