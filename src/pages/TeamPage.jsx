import { useEffect, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { loadTeam, manageTeamUser } from '../services/teamService'

const roles = [
  ['onboarding_media', 'Onboarding & Media'],
  ['automation_funnels', 'Automations & Funnels'],
  ['superadmin', 'Superadmin'],
]
const permissionLabels = {
  clients_create: 'Crear clientes', clients_edit: 'Editar dossiers', tasks_create: 'Crear tareas',
  calendar_manage: 'Crear eventos', eod_reports: 'Generar EOD',
}
const defaultPermissions = {
  clients_create: false, clients_edit: true, tasks_create: false,
  calendar_manage: true, eod_reports: true, users_manage: false,
}
const allPermissions = Object.fromEntries(Object.keys(permissionLabels).map((key) => [key, true]))

function PermissionFields({ permissions, onChange, disabled }) {
  return <div className="permission-grid">{Object.entries(permissionLabels).map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(permissions[key])} disabled={disabled} onChange={(event) => onChange(key, event.target.checked)} />{label}</label>)}</div>
}

export default function TeamPage() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ email: '', password: '', fullName: '', role: 'onboarding_media', permissions: { ...defaultPermissions } })

  const refresh = async () => setProfiles(await loadTeam())
  useEffect(() => { refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)) }, [])
  const setFormField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setFormPermission = (key, value) => setForm((current) => ({ ...current, permissions: { ...current.permissions, [key]: value } }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await manageTeamUser({ action: 'create', ...form, permissions: form.role === 'superadmin' ? allPermissions : form.permissions })
      setForm({ email: '', password: '', fullName: '', role: 'onboarding_media', permissions: { ...defaultPermissions } })
      await refresh(); setMessage('Usuario creado y acceso confirmado.')
    } catch (submitError) { setError(submitError.message) }
    finally { setSaving(false) }
  }
  const changeProfile = (id, key, value) => setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, [key]: value } : profile))
  const changePermission = (id, key, value) => setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, permissions: { ...profile.permissions, [key]: value } } : profile))
  const saveProfile = async (profile) => {
    setSaving(true); setError(''); setMessage('')
    try {
      await manageTeamUser({ action: 'update', userId: profile.id, fullName: profile.full_name, role: profile.role, permissions: profile.role === 'superadmin' ? allPermissions : profile.permissions, active: profile.active })
      await refresh(); setMessage(`${profile.full_name} actualizado correctamente.`)
    } catch (updateError) { setError(updateError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Superadmin</p><h2>Usuarios y permisos</h2><p className="muted">Crea accesos internos y controla qué puede hacer cada integrante.</p></div><span className="status-pill">{profiles.length} usuarios</span></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Nuevo acceso</p><h3>Crear usuario</h3></div></div><form className="user-create-form" onSubmit={submit}>
      <label>Nombre<input value={form.fullName} onChange={(event) => setFormField('fullName', event.target.value)} required /></label>
      <label>Correo<input type="email" value={form.email} onChange={(event) => setFormField('email', event.target.value)} required /></label>
      <label>Contraseña<div className="inline-password"><input type={showPassword ? 'text' : 'password'} minLength="10" value={form.password} onChange={(event) => setFormField('password', event.target.value)} required /><button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ocultar' : 'Ver'}</button></div></label>
      <label>Rol<select value={form.role} onChange={(event) => setFormField('role', event.target.value)}>{roles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <div className="wide"><span className="field-label">Permisos</span><PermissionFields permissions={form.role === 'superadmin' ? allPermissions : form.permissions} disabled={form.role === 'superadmin'} onChange={setFormPermission} /></div>
      <div className="wide"><button className="primary-button compact-button" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</button></div>
    </form></section>
    <section className="team-grid">{profiles.map((member) => <article className={`content-card user-management-card ${member.active ? '' : 'inactive'}`} key={member.id}>
      <div className="section-heading"><div><strong>{member.full_name || 'Usuario sin nombre'}</strong><p className="muted">{member.email}</p></div><label className="active-toggle"><input type="checkbox" checked={member.active} onChange={(event) => changeProfile(member.id, 'active', event.target.checked)} />Activo</label></div>
      <label>Nombre<input value={member.full_name || ''} onChange={(event) => changeProfile(member.id, 'full_name', event.target.value)} /></label>
      <label>Rol<select value={member.role} onChange={(event) => changeProfile(member.id, 'role', event.target.value)}>{roles.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <span className="field-label">Permisos</span><PermissionFields permissions={member.role === 'superadmin' ? allPermissions : member.permissions || {}} disabled={member.role === 'superadmin'} onChange={(key, value) => changePermission(member.id, key, value)} />
      <button className="secondary-button" disabled={saving} onClick={() => saveProfile(member)}>Guardar usuario</button>
    </article>)}</section>
  </div>
}
