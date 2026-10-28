import { useEffect, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { loadTeam, manageTeamUser } from '../services/teamService'

const timezones = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['America/Managua', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']

const permissionLabels = {
  clients_create: 'Crear clientes',
  clients_edit: 'Editar clientes',
  tasks_create: 'Crear tareas',
  eod_reports: 'Enviar reportes EOD',
  operations_admin: 'Administrar operaciones de clientes',
  users_manage: 'Administrar usuarios',
  sensitive_credentials_view: 'Ver credenciales sensibles',
}
const initialForm = {
  email: '', password: '', fullName: '', timezone: 'America/Managua',
  slackContact: '', whatsappContact: '', departmentRoleIds: [],
}

function RolePicker({ departments, departmentRoles, selectedIds, onToggle, locale, t, includeDirection = false }) {
  const visibleRoles = departmentRoles.filter((role) => includeDirection || role.department_id !== 'direction')
  return <div className="department-role-picker">
    {departments.filter((department) => includeDirection || department.id !== 'direction').map((department) => {
      const roles = visibleRoles.filter((role) => role.department_id === department.id)
      if (!roles.length) return null
      return <fieldset className="department-role-group" key={department.id}>
        <legend>{locale.startsWith('en') ? department.name_en : department.name_es}</legend>
        {roles.map((role) => <label className="department-role-option" key={role.id}>
          <input type="checkbox" checked={selectedIds.includes(role.id)} onChange={() => onToggle(role.id)} />
          <span><strong>{locale.startsWith('en') ? role.title_en : role.title_es}</strong>
            <small>{locale.startsWith('en') ? role.description_en : role.description_es}</small></span>
        </label>)}
      </fieldset>
    })}
    <p className="muted">{t('Los permisos se heredan del departamento; no se configuran por usuario.')}</p>
  </div>
}

function TeamMemberCard({
  member, departments, departmentRoles, locale, t, viewerId,
  onChange, onToggleRole, onSave, onReset, saving,
}) {
  const [resetPassword, setResetPassword] = useState('')
  const [showResetPassword, setShowResetPassword] = useState(false)
  const assignedTitles = member.department_roles.map((role) => locale.startsWith('en') ? role.title_en : role.title_es)
  const isOwnSuperadmin = member.id === viewerId && member.role === 'superadmin'
  const canSave = member.department_roles.length > 0 && !saving

  return <article className={`content-card user-management-card ${member.active ? '' : 'inactive'}`}>
    <div className="section-heading">
      <div><strong>{member.full_name || t('Usuario sin nombre')}</strong><p className="muted">{member.email}</p>
        <div className="team-role-chips">{assignedTitles.length ? assignedTitles.map((title) => <span className="status-pill" key={title}>{title}</span>) : <span className="muted">{t('Sin departamento asignado')}</span>}</div>
      </div>
      <label className="active-toggle"><input type="checkbox" checked={member.active} disabled={isOwnSuperadmin} onChange={(event) => onChange(member.id, 'active', event.target.checked)} />{t('Activo')}</label>
    </div>
    <details className="team-member-edit">
      <summary>{t('Editar usuario, departamento y función')}</summary>
      <div className="team-member-fields">
        <label>{t('Nombre')}<input value={member.full_name || ''} onChange={(event) => onChange(member.id, 'full_name', event.target.value)} /></label>
        <label>{t('Zona horaria')}<select value={member.timezone || 'America/Managua'} onChange={(event) => onChange(member.id, 'timezone', event.target.value)}>{timezones.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>
        <label>{t('Slack')}<input value={member.slack_contact || ''} onChange={(event) => onChange(member.id, 'slack_contact', event.target.value)} placeholder="@username or link" /></label>
        <label>WhatsApp<input value={member.whatsapp_contact || ''} onChange={(event) => onChange(member.id, 'whatsapp_contact', event.target.value)} placeholder="Number or link" /></label>
      </div>
      {isOwnSuperadmin
        ? <p className="muted">{t('Dirección permanece reservada al superadmin actual.')}</p>
        : <RolePicker departments={departments} departmentRoles={departmentRoles} selectedIds={member.department_roles.map((role) => role.id)} locale={locale} t={t} onToggle={(roleId) => onToggleRole(member.id, roleId)} />}
      <button className="secondary-button" disabled={!canSave} onClick={() => onSave(member)}>{saving ? t('Guardando…') : t('Guardar usuario')}</button>
      {member.active && <details className="password-reset-panel">
        <summary>{t('Restablecer contraseña')}</summary>
        <label>{t('Nueva contraseña')}<div className="inline-password"><input type={showResetPassword ? 'text' : 'password'} minLength="10" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /><button type="button" className="text-button" onClick={() => setShowResetPassword((value) => !value)}>{showResetPassword ? t('Ocultar') : t('Ver')}</button></div></label>
        <p className="muted">{t('Mínimo 10 caracteres.')} {resetPassword.length}/10</p>
        <button className="text-button" type="button" disabled={saving || resetPassword.length < 10} onClick={async () => { await onReset(member, resetPassword); setResetPassword('') }}>{t('Restablecer')}</button>
      </details>}
    </details>
  </article>
}

export default function TeamPage() {
  const { profile } = useAuth()
  const { locale, t } = useLanguage()
  const [team, setTeam] = useState({ profiles: [], departments: [], departmentRoles: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(initialForm)

  const refresh = async () => setTeam(await loadTeam())
  useEffect(() => { refresh().catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false)) }, [])
  const setFormField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const toggleFormRole = (roleId) => setForm((current) => ({
    ...current,
    departmentRoleIds: current.departmentRoleIds.includes(roleId)
      ? current.departmentRoleIds.filter((item) => item !== roleId)
      : [...current.departmentRoleIds, roleId],
  }))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      await manageTeamUser({ action: 'create', ...form })
      setForm(initialForm)
      await refresh()
      setMessage(t('Usuario creado con permisos heredados de su departamento.'))
    } catch (submitError) { setError(t(submitError.message)) }
    finally { setSaving(false) }
  }

  const changeProfile = (id, key, value) => setTeam((current) => ({
    ...current,
    profiles: current.profiles.map((member) => member.id === id ? { ...member, [key]: value } : member),
  }))
  const toggleProfileRole = (id, roleId) => setTeam((current) => ({
    ...current,
    profiles: current.profiles.map((member) => {
      if (member.id !== id) return member
      const hasRole = member.department_roles.some((role) => role.id === roleId)
      const role = current.departmentRoles.find((item) => item.id === roleId)
      if (!role) return member
      return { ...member, department_roles: hasRole
        ? member.department_roles.filter((item) => item.id !== roleId)
        : [...member.department_roles, role] }
    }),
  }))

  const saveProfile = async (member) => {
    setSaving(true); setError(''); setMessage('')
    try {
      await manageTeamUser({
        action: 'update', userId: member.id, fullName: member.full_name,
        departmentRoleIds: member.department_roles.map((role) => role.id),
        timezone: member.timezone, slackContact: member.slack_contact,
        whatsappContact: member.whatsapp_contact, active: member.active,
      })
      await refresh()
      setMessage(t(`${member.full_name} actualizado correctamente.`))
    } catch (updateError) { setError(t(updateError.message)) }
    finally { setSaving(false) }
  }

  const resetAccess = async (member, password) => {
    setSaving(true); setError(''); setMessage('')
    try {
      await manageTeamUser({ action: 'reset_password', userId: member.id, password })
      setMessage(t(`Contraseña de ${member.full_name} restablecida. Comunícala por un canal seguro.`))
    } catch (resetError) { setError(t(resetError.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  const activeMembers = team.profiles.filter((member) => member.active)
  const inactiveMembers = team.profiles.filter((member) => !member.active)
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('Administración del equipo')}</p><h2>{t('Usuarios, departamentos y funciones')}</h2><p className="muted">{t('Cada correo identifica una cuenta. Las funciones determinan el departamento; sus permisos se comparten dentro del departamento.')}</p></div><span className="status-pill">{activeMembers.length} {t('usuarios activos')}</span></header>
    {error && <p className="form-error" role="alert">{t(error)}</p>}{message && <p className="form-success" role="status">{message}</p>}

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Nuevo acceso')}</p><h3>{t('Crear usuario')}</h3></div></div>
      <form className="user-create-form" onSubmit={submit}>
        <label>{t('Nombre')}<input value={form.fullName} onChange={(event) => setFormField('fullName', event.target.value)} required /></label>
        <label>{t('Correo')}<input type="email" value={form.email} onChange={(event) => setFormField('email', event.target.value)} required /></label>
        <label>{t('Contraseña')}<div className="inline-password"><input type={showPassword ? 'text' : 'password'} minLength="10" value={form.password} onChange={(event) => setFormField('password', event.target.value)} required /><button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t('Ocultar') : t('Ver')}</button></div></label>
        <label>{t('Zona horaria')}<select value={form.timezone} onChange={(event) => setFormField('timezone', event.target.value)}>{timezones.map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>
        <label>Slack<input value={form.slackContact} onChange={(event) => setFormField('slackContact', event.target.value)} placeholder="@username or link" /></label>
        <label>WhatsApp<input value={form.whatsappContact} onChange={(event) => setFormField('whatsappContact', event.target.value)} placeholder="Number or link" /></label>
        <div className="wide"><span className="field-label">{t('Departamento y función')}</span><RolePicker departments={team.departments} departmentRoles={team.departmentRoles} selectedIds={form.departmentRoleIds} onToggle={toggleFormRole} locale={locale} t={t} /></div>
        <div className="wide"><button className="primary-button compact-button" disabled={saving || !form.departmentRoleIds.length}>{saving ? t('Creando…') : t('Crear usuario')}</button></div>
      </form>
    </section>

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Estructura')}</p><h3>{t('Departamentos y funciones')}</h3></div><span className="muted">{t('Permisos comunes por departamento')}</span></div>
      <div className="department-grid">{team.departments.map((department) => {
        const roles = team.departmentRoles.filter((role) => role.department_id === department.id)
        const members = team.profiles.filter((member) => member.active && member.department_roles.some((role) => role.department_id === department.id))
        const permissionNames = Object.entries(department.permissions || {}).filter(([key, allowed]) => allowed && permissionLabels[key] && key !== 'users_manage' && key !== 'sensitive_credentials_view').map(([key]) => permissionLabels[key])
        return <article className="department-card" key={department.id}>
          <div className="section-heading"><div><h3>{locale.startsWith('en') ? department.name_en : department.name_es}</h3><p className="muted">{members.length} {t('integrantes')}</p></div></div>
          <div className="department-role-list">{roles.map((role) => {
            const roleMembers = members.filter((member) => member.department_roles.some((item) => item.id === role.id))
            return <div className="department-role-row" key={role.id}><strong>{locale.startsWith('en') ? role.title_en : role.title_es}</strong><p>{locale.startsWith('en') ? role.description_en : role.description_es}</p><small>{roleMembers.length ? roleMembers.map((member) => member.full_name).join(', ') : t('Sin usuario asignado')}</small></div>
          })}</div>
          <div className="permission-summary"><strong>{t('Permisos compartidos')}</strong><div className="permission-chips">{permissionNames.map((name) => <span key={name}>{t(name)}</span>)}</div><small>{t('Todos los roles del departamento reciben el mismo conjunto.')}</small></div>
        </article>
      })}</div>
    </section>

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Accesos')}</p><h3>{t('Usuarios activos')}</h3></div><span className="status-pill">{activeMembers.length}</span></div>
      <div className="team-grid">{activeMembers.map((member) => <TeamMemberCard key={member.id} member={member} departments={team.departments} departmentRoles={team.departmentRoles} locale={locale} t={t} viewerId={profile.id} onChange={changeProfile} onToggleRole={toggleProfileRole} onSave={saveProfile} onReset={resetAccess} saving={saving} />)}</div>
    </section>

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Acceso')}</p><h3>{t('Usuarios inactivos')}</h3></div><span className="status-pill">{inactiveMembers.length}</span></div><p className="muted">{t('Los usuarios inactivos no pueden acceder. Sus tareas, notas y actividad se conservan.')}</p>
      <div className="team-grid">{inactiveMembers.length === 0 ? <p className="muted">{t('No hay usuarios inactivos.')}</p> : inactiveMembers.map((member) => <TeamMemberCard key={member.id} member={member} departments={team.departments} departmentRoles={team.departmentRoles} locale={locale} t={t} viewerId={profile.id} onChange={changeProfile} onToggleRole={toggleProfileRole} onSave={saveProfile} onReset={resetAccess} saving={saving} />)}</div>
    </section>
  </div>
}
