import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import TeamAvatar, { teamAvatars } from '../components/TeamAvatar'
import { useLanguage } from '../i18n/LanguageContext'
import { changeMyPassword, updateMyProfile } from '../services/profileService'

const fallbackZones = ['America/Managua', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Sao_Paulo', 'Europe/Madrid', 'Europe/London', 'Asia/Dubai']
const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : fallbackZones
const formatLocalTime = (timezone, language) => {
  try { return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()) }
  catch { return 'Selecciona una zona válida de la lista' }
}

export default function MyAccountPage() {
  const { profile, user, refreshProfile } = useAuth()
  const { language } = useLanguage()
  const [form, setForm] = useState({ timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, slackContact: profile.slack_contact || '', whatsappContact: profile.whatsapp_contact || '', avatarId: profile.avatar_url || 'steel', preferredLanguage: profile.preferred_language || language })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [passwords, setPasswords] = useState({ current: '', next: '', confirmation: '' })
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  useEffect(() => setForm((current) => ({ ...current, preferredLanguage: profile.preferred_language || language })), [profile.preferred_language, language])
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await updateMyProfile(profile.id, form); await refreshProfile(); setMessage('Tu perfil, avatar e idioma se actualizaron.') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  const submitPassword = async (event) => {
    event.preventDefault(); setPasswordError(''); setPasswordMessage('')
    if (passwords.next !== passwords.confirmation) return setPasswordError('Las contraseñas nuevas no coinciden.')
    setChangingPassword(true)
    try {
      await changeMyPassword(user.email, passwords.current, passwords.next)
      setPasswords({ current: '', next: '', confirmation: '' })
      setPasswordMessage('Contraseña actualizada correctamente.')
    } catch (e) { setPasswordError(e.message) }
    finally { setChangingPassword(false) }
  }
  const localTime = formatLocalTime(form.timezone, language)
  return <div className="page-stack compact-page">
    <header className="page-header"><div><p className="eyebrow">Mi cuenta</p><h2>Perfil y hora local</h2><p className="muted">Esta zona controla cómo ves reuniones, fechas y tu reloj en el calendario.</p></div></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    <form className="content-card profile-form" onSubmit={submit}>
      <div className="profile-identity"><TeamAvatar avatarId={form.avatarId} label={profile.full_name || 'Avatar'} /><div><strong>{profile.full_name}</strong><span>{user.email}</span></div></div>
      <fieldset className="avatar-fieldset"><legend>Avatar del equipo</legend><p className="field-help">Elige tu insignia</p><div className="avatar-picker">{teamAvatars.map((avatar) => <button type="button" className={form.avatarId === avatar.id ? 'selected' : ''} onClick={() => setField('avatarId', avatar.id)} aria-label={avatar.label} aria-pressed={form.avatarId === avatar.id} key={avatar.id}><TeamAvatar avatarId={avatar.id} size="picker" label={avatar.label} /></button>)}</div></fieldset>
      <fieldset className="language-fieldset"><legend>Idioma</legend><div className="language-choice"><label><input type="radio" name="preferred-language" value="es" checked={form.preferredLanguage === 'es'} onChange={(event) => setField('preferredLanguage', event.target.value)} />Español</label><label><input type="radio" name="preferred-language" value="en" checked={form.preferredLanguage === 'en'} onChange={(event) => setField('preferredLanguage', event.target.value)} />English</label></div></fieldset>
      <label>Zona horaria<input list="timezone-options" value={form.timezone} onChange={(event) => setField('timezone', event.target.value)} placeholder="Escribe una ciudad o zona…" required /><datalist id="timezone-options">{timezones.map((zone) => <option value={zone} key={zone} />)}</datalist><small className="field-help">Hora actual: {localTime}</small></label>
      <label>Usuario o enlace de Slack<input value={form.slackContact} onChange={(event) => setField('slackContact', event.target.value)} placeholder="@usuario o https://…slack.com/…" /></label>
      <label>WhatsApp<input value={form.whatsappContact} onChange={(event) => setField('whatsappContact', event.target.value)} placeholder="+505… o https://wa.me/…" /></label>
      <button className="primary-button compact-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar mi perfil'}</button>
    </form>
    <form className="content-card password-change-form" onSubmit={submitPassword}>
      <div className="section-heading"><div><p className="eyebrow">Seguridad</p><h3>Cambiar contraseña</h3><p className="muted">Confirma tu contraseña actual antes de establecer una nueva.</p></div><button className="text-button" type="button" onClick={() => setShowPasswords((visible) => !visible)}>{showPasswords ? 'Ocultar' : 'Mostrar'}</button></div>
      <div className="password-change-grid">
        <label>Contraseña actual<input type={showPasswords ? 'text' : 'password'} autoComplete="current-password" value={passwords.current} onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))} required /></label>
        <label>Nueva contraseña<input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={passwords.next} onChange={(event) => setPasswords((current) => ({ ...current, next: event.target.value }))} required /><small className="field-help">Mínimo 10 caracteres.</small></label>
        <label>Confirmar contraseña<input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength="10" value={passwords.confirmation} onChange={(event) => setPasswords((current) => ({ ...current, confirmation: event.target.value }))} required /></label>
      </div>
      {passwordError && <p className="form-error" role="alert">{passwordError}</p>}{passwordMessage && <p className="form-success">{passwordMessage}</p>}
      <button className="primary-button compact-button" disabled={changingPassword}>{changingPassword ? 'Actualizando…' : 'Actualizar contraseña'}</button>
    </form>
  </div>
}
