import { useEffect, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { contactLink, loadTeamDirectory } from '../services/profileService'

const roleLabels = { superadmin: 'Superadmin', user_admin: 'User Admin', onboarding_media: 'Onboarding & Media', automation_funnels: 'Automations & Funnels' }

export default function TeamDirectoryPage() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { loadTeamDirectory().then(setMembers).catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [])
  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Directorio interno</p><h2>Mi equipo</h2><p className="muted">Contacta rápidamente a cada integrante por correo, Slack o WhatsApp.</p></div><span className="status-pill">{members.length} integrantes</span></header>
    {error && <p className="form-error">{error}</p>}
    <section className="directory-grid">{members.map((member) => {
      const slack = contactLink(member.slack_contact, 'slack')
      const whatsapp = contactLink(member.whatsapp_contact, 'whatsapp')
      return <article className="content-card directory-card" key={member.id}><div className="profile-identity"><div className="brand-mark">{(member.full_name || 'TP').slice(0, 2).toUpperCase()}</div><div><h3>{member.full_name || 'Usuario'}</h3><span>{roleLabels[member.role] || member.role}</span></div></div><dl><div><dt>Correo</dt><dd>{member.email}</dd></div><div><dt>Slack</dt><dd>{member.slack_contact || 'Pendiente'}</dd></div><div><dt>WhatsApp</dt><dd>{member.whatsapp_contact || 'Pendiente'}</dd></div><div><dt>Zona horaria</dt><dd>{member.timezone}</dd></div></dl><div className="contact-actions"><a className="secondary-button" href={`mailto:${member.email}`}>Correo</a>{slack && <a className="secondary-button" href={slack} target="_blank" rel="noreferrer">Slack</a>}{whatsapp && <a className="secondary-button" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>}</div></article>
    })}</section>
  </div>
}
