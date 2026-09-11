import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const roleLabels = {
  superadmin: 'Superadmin',
  onboarding_media: 'Onboarding & Media',
  automation_funnels: 'Automations & Funnels',
}

const emptyUser = { fullName: '', email: '', password: '', role: 'onboarding_media' }

export default function TeamPage() {
  const [profiles, setProfiles] = useState([])
  const [form, setForm] = useState(emptyUser)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const callAdmin = async (body) => {
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', { body })
    if (invokeError) throw invokeError
    if (data?.error) throw new Error(data.error)
    return data
  }

  const loadUsers = async () => {
    try {
      const data = await callAdmin({ action: 'list' })
      setProfiles(data.users || [])
    } catch (loadError) { setError(loadError.message) }
  }

  useEffect(() => { loadUsers() }, [])

  const createUser = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await callAdmin({ action: 'create', ...form })
      setForm(emptyUser); setMessage('Usuario creado y correo confirmado.'); await loadUsers()
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  const updateMember = async (member, changes) => {
    const next = { ...member, ...changes }
    setProfiles((current) => current.map((item) => item.id === member.id ? next : item))
    try {
      await callAdmin({ action: 'update', id: next.id, fullName: next.full_name, role: next.role })
      setMessage(`Permisos de ${next.full_name} actualizados.`)
    } catch (updateError) { setError(updateError.message); await loadUsers() }
  }

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Superadmin</p><h2>Usuarios y permisos</h2><p className="muted">Crea accesos y define qué tareas puede ver cada persona.</p></div></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success">{message}</p>}
      <div className="admin-grid">
        <section className="content-card">
          <p className="eyebrow">Nuevo acceso</p><h3>Crear usuario</h3>
          <form onSubmit={createUser}>
            <label>Nombre completo</label><input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
            <label>Correo</label><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <label>Contraseña inicial</label>
            <div className="inline-password"><input required minLength="10" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ocultar' : 'Ver'}</button></div>
            <label>Rol</label><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <button className="primary-button" disabled={saving}>{saving ? 'Creando…' : 'Crear usuario'}</button>
          </form>
        </section>
        <section className="content-card">
          <p className="eyebrow">Equipo activo</p><h3>{profiles.length} usuarios</h3>
          <div className="member-list">{profiles.map((member) => <div className="member-editor" key={member.id}><div><strong>{member.full_name || 'Sin nombre'}</strong><small>{member.email}</small></div><select value={member.role} onChange={(event) => updateMember(member, { role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}</div>
        </section>
      </div>
    </div>
  )
}
