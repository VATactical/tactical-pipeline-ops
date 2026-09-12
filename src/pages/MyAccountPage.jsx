import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { updateMyProfile } from '../services/profileService'

const fallbackZones = ['America/Managua', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Sao_Paulo', 'Europe/Madrid', 'Europe/London', 'Asia/Dubai']
const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : fallbackZones
const formatLocalTime = (timezone) => {
  try { return new Intl.DateTimeFormat('es', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()) }
  catch { return 'Selecciona una zona válida de la lista' }
}

export default function MyAccountPage() {
  const { profile, user, refreshProfile } = useAuth()
  const [form, setForm] = useState({ timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, slackContact: profile.slack_contact || '', whatsappContact: profile.whatsapp_contact || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await updateMyProfile(profile.id, form); await refreshProfile(); setMessage('Tu perfil y hora local se actualizaron.') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  const localTime = formatLocalTime(form.timezone)
  return <div className="page-stack compact-page">
    <header className="page-header"><div><p className="eyebrow">Mi cuenta</p><h2>Perfil y hora local</h2><p className="muted">Esta zona controla cómo ves reuniones, fechas y tu reloj en el calendario.</p></div></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    <form className="content-card profile-form" onSubmit={submit}>
      <div className="profile-identity"><div className="brand-mark">{(profile.full_name || 'TP').slice(0, 2).toUpperCase()}</div><div><strong>{profile.full_name}</strong><span>{user.email}</span></div></div>
      <label>Zona horaria<input list="timezone-options" value={form.timezone} onChange={(event) => setField('timezone', event.target.value)} placeholder="Escribe una ciudad o zona…" required /><datalist id="timezone-options">{timezones.map((zone) => <option value={zone} key={zone} />)}</datalist><small className="field-help">Hora actual: {localTime}</small></label>
      <label>Usuario o enlace de Slack<input value={form.slackContact} onChange={(event) => setField('slackContact', event.target.value)} placeholder="@usuario o https://…slack.com/…" /></label>
      <label>WhatsApp<input value={form.whatsappContact} onChange={(event) => setField('whatsappContact', event.target.value)} placeholder="+505… o https://wa.me/…" /></label>
      <button className="primary-button compact-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar mi perfil'}</button>
    </form>
  </div>
}
