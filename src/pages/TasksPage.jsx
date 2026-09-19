import { useEffect, useMemo, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { runWithSessionRetry, supabase } from '../lib/supabase'
import { createAssignedTask, updateTaskDetails, updateTaskProgress } from '../services/opsService'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'

const initialTask = { scope: 'general', clientId: '', clientSearch: '', title: '', body: '', assignedTo: '', priority: 'Media', dueAt: '' }
const priorities = ['Baja', 'Media', 'Alta', 'Urgente']
const statuses = ['Pendiente', 'En progreso', 'Bloqueada', 'Completada']

function assigneeData(members, assignedTo) {
  const member = members.find((item) => item.id === assignedTo)
  return member ? { assignedTo: member.id, assigneeName: member.full_name, assigneeRole: member.role } : { assignedTo: null, assigneeName: 'Todos', assigneeRole: null }
}

function AssigneeSelect({ members, value, onChange, disabled = false, t }) {
  return <select value={value || ''} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
    {!disabled && <option value="">{t('Todos / tarea compartida')}</option>}
    {members.map((member) => <option value={member.id} key={member.id}>{member.full_name}</option>)}
  </select>
}

function TaskComposer({ clients, members, onCreated, profile }) {
  const { t } = useLanguage()
  const isAdmin = profile.role === 'superadmin' || Boolean(profile.permissions?.operations_admin)
  const emptyForm = { ...initialTask, assignedTo: isAdmin ? '' : profile.id }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const matches = clients.filter((client) => `${client.code} ${client.business_name}`.toLowerCase().includes(form.clientSearch.toLowerCase())).slice(0, 6)
  const selected = clients.find((client) => client.id === form.clientId)

  const submit = async (event) => {
    event.preventDefault()
    if (form.scope === 'client' && !form.clientId) { setError(t('Selecciona el cliente específico.')); return }
    setSaving(true); setError('')
    try {
      const task = await createAssignedTask({
        ...form,
        clientId: form.scope === 'client' ? form.clientId : null,
        ...assigneeData(members, form.assignedTo),
      })
      onCreated(task)
      setForm(emptyForm)
    } catch (submitError) {
      setError(t(submitError.message))
    } finally {
      setSaving(false)
    }
  }

  return <section className="content-card task-composer">
    <div className="section-heading"><div><p className="eyebrow">{t('Nueva tarea')}</p><h3>{t('Asignar trabajo')}</h3></div></div>
    <form onSubmit={submit}>
      <div className="entry-type">
        <button type="button" className={form.scope === 'general' ? 'active' : ''} onClick={() => setField('scope', 'general')}>{t('Tarea general')}</button>
        <button type="button" className={form.scope === 'client' ? 'active' : ''} onClick={() => setField('scope', 'client')}>{t('Cliente específico')}</button>
      </div>
      <div className="composer-grid">
        {form.scope === 'client' && <label className="wide client-search-picker">{t('Buscar cliente')}<input type="search" value={form.clientSearch} placeholder={t('Escribe código o nombre…')} onChange={(event) => { setField('clientSearch', event.target.value); setField('clientId', '') }} required />{selected ? <span className="selected-client">{t('Seleccionado:')} {selected.code} · {selected.business_name}</span> : form.clientSearch && <div className="search-results">{matches.map((client) => <button type="button" key={client.id} onClick={() => setForm((current) => ({ ...current, clientId: client.id, clientSearch: `${client.code} · ${client.business_name}` }))}>{client.code} · {client.business_name}</button>)}{matches.length === 0 && <span>{t('No encontramos ese cliente.')}</span>}</div>}</label>}
        <label>{t('Asignar a una persona')}<AssigneeSelect members={members} value={form.assignedTo} onChange={(value) => setField('assignedTo', value)} disabled={!isAdmin} t={t} /></label>
        <label>{t('Prioridad')}<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}>{priorities.map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></label>
        <label>{t('Fecha límite')}<input type="date" value={form.dueAt} onChange={(event) => setField('dueAt', event.target.value)} /></label>
        <label className="wide">{t('Título')}<input value={form.title} onChange={(event) => setField('title', event.target.value)} maxLength="160" required placeholder={t('Qué debe realizarse')} /></label>
        <label className="wide">{t('Detalle')}<textarea rows="3" value={form.body} onChange={(event) => setField('body', event.target.value)} placeholder={t('Contexto e instrucciones…')} /></label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button compact-button" disabled={saving}>{t(saving ? 'Creando…' : 'Crear tarea')}</button>
    </form>
  </section>
}

function TaskEditor({ task, clients, members, onCancel, onSaved }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    clientId: task.client_id || '',
    title: task.title || '',
    details: task.comments || task.evidence || '',
    assignedTo: task.assigned_to || '',
    priority: task.priority || 'Media',
    dueAt: task.due_at || '',
    status: task.status || 'Pendiente',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const updated = await updateTaskDetails(task.id, { ...form, ...assigneeData(members, form.assignedTo) })
      onSaved(updated)
    } catch (saveError) {
      setError(t(saveError.message))
    } finally {
      setSaving(false)
    }
  }
  return <section className="content-card task-edit-card">
    <div className="section-heading"><div><p className="eyebrow">{t('Edición')}</p><h3>{t('Editar tarea')}</h3></div><button className="text-button" type="button" onClick={onCancel}>{t('Cancelar')}</button></div>
    <form className="composer-grid" onSubmit={submit}>
      <label>{t('Cliente')}<select value={form.clientId} onChange={(event) => setField('clientId', event.target.value)}><option value="">{t('Tarea general')}</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.business_name}</option>)}</select></label>
      <label>{t('Asignar a una persona')}<AssigneeSelect members={members} value={form.assignedTo} onChange={(value) => setField('assignedTo', value)} t={t} /></label>
      <label>{t('Prioridad')}<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}>{priorities.map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></label>
      <label>{t('Estado')}<select value={form.status} onChange={(event) => setField('status', event.target.value)}>{statuses.map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></label>
      <label>{t('Fecha límite')}<input type="date" value={form.dueAt} onChange={(event) => setField('dueAt', event.target.value)} /></label>
      <label className="wide">{t('Título')}<input value={form.title} onChange={(event) => setField('title', event.target.value)} maxLength="160" required /></label>
      <label className="wide">{t('Detalle')}<textarea rows="4" value={form.details} onChange={(event) => setField('details', event.target.value)} /></label>
      {error && <p className="form-error wide">{error}</p>}
      <div className="section-actions wide"><button className="primary-button compact-button" disabled={saving}>{t(saving ? 'Guardando…' : 'Guardar cambios')}</button></div>
    </form>
  </section>
}

function TaskProgressEditor({ task, profileId, onSaved }) {
  const { t } = useLanguage()
  const [status, setStatus] = useState(task.status || 'Pendiente')
  const [statusNote, setStatusNote] = useState(task.status_note || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = status !== task.status || statusNote !== (task.status_note || '')

  const save = async () => {
    setSaving(true); setError('')
    try {
      onSaved(await updateTaskProgress(task.id, { status, statusNote, profileId }))
    } catch (saveError) {
      setError(t(saveError.message))
    } finally {
      setSaving(false)
    }
  }

  return <div className="task-status-controls">
    <label>{t('Estado')}<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={`${t('Estado')}: ${task.title}`}>{statuses.map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></label>
    <label>{t('Nota de estado')}<textarea rows="2" maxLength="2000" value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder={t('Explica por qué sigue en progreso o está bloqueada…')} /></label>
    {error && <small className="form-error">{error}</small>}
    <button className="secondary-button" type="button" disabled={saving || !dirty} onClick={save}>{t(saving ? 'Guardando…' : 'Guardar estado')}</button>
  </div>
}

export default function TasksPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const canManage = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const [tasks, setTasks] = useState([])
  const [clients, setClients] = useState([])
  const [members, setMembers] = useState([])
  const [editingTask, setEditingTask] = useState(null)
  const [filter, setFilter] = useState('Abiertas')
  const [priority, setPriority] = useState('Todas')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    runWithSessionRetry(() => Promise.all([
      supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, code, business_name').eq('archived', false).order('code'),
      supabase.rpc('get_team_directory'),
    ])).then(([tasksResult, clientsResult, membersResult]) => {
      const queryError = tasksResult.error || clientsResult.error || membersResult.error
      if (queryError) setError(t(queryError.message))
      else {
        setTasks(tasksResult.data || [])
        setClients(clientsResult.data || [])
        setMembers((membersResult.data || []).filter((member) => member.active !== false))
      }
    }).catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false))
  }, [t])

  const visible = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === 'Todas' || (filter === 'Abiertas' ? task.status !== 'Completada' : task.status === 'Completada')
    const matchesPriority = priority === 'Todas' || task.priority === priority
    const term = search.trim().toLowerCase()
    return matchesStatus && matchesPriority && (!term || `${task.title} ${task.owner_name} ${task.clients?.code || ''} ${task.clients?.business_name || ''}`.toLowerCase().includes(term))
  }), [tasks, filter, priority, search])

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{t('Ejecución')}</p><h2>{t('Tareas')}</h2><p className="muted">{t('Las completadas se conservan separadas en Historial.')}</p></div><span className="status-pill">{visible.length} {t('visibles')}</span></header>
    {error && <p className="form-error">{error}</p>}
    {message && <p className="form-success">{message}</p>}
    {profile?.permissions?.tasks_create && <TaskComposer clients={clients} members={members} profile={profile} onCreated={(task) => { setTasks((current) => [task, ...current]); setMessage(t('Tarea creada y alerta enviada.')) }} />}
    {editingTask && <TaskEditor task={editingTask} clients={clients} members={members} onCancel={() => setEditingTask(null)} onSaved={(updated) => { setTasks((current) => current.map((task) => task.id === updated.id ? updated : task)); setEditingTask(null); setMessage(t('Tarea actualizada correctamente.')) }} />}
    <section className="filter-bar"><input type="search" placeholder={t('Buscar tarea o cliente…')} value={search} onChange={(event) => setSearch(event.target.value)} /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="Abiertas">{t('Abiertas')}</option><option value="Historial completadas">{t('Historial completadas')}</option><option value="Todas">{t('Todas')}</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="Todas">{t('Todas')}</option>{['Urgente', 'Alta', 'Media', 'Baja'].map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></section>
    <section className="content-card task-table">
      {visible.length === 0 && <p className="muted">{t('No hay tareas en esta vista.')}</p>}
      {visible.map((task) => {
        const overdue = task.due_at && task.status !== 'Completada' && new Date(`${task.due_at}T23:59:59`) < new Date()
        return <article className={`task-row ${overdue ? 'overdue' : ''}`} key={task.id}>
          <span className={`priority ${task.priority.toLowerCase()}`}>{t(task.priority)}</span>
          <div>
            <strong data-no-translate>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : t('Tarea general')}</strong>
            <p data-no-translate>{task.title}</p>
            {task.comments && <p className="task-detail" data-no-translate>{task.comments}</p>}
            <small><span>{t('Asignada a')} </span><span data-no-translate>{task.owner_name || t('Todos')}</span>{task.due_at ? ` · ${t(overdue ? 'Atrasada' : 'Vence')} ${task.due_at}` : ''}</small>
            {canManage && <button className="text-button task-edit-button" type="button" onClick={() => { setEditingTask(task); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{t('Editar tarea')}</button>}
          </div>
          <TaskProgressEditor task={task} profileId={profile.id} onSaved={(updated) => { setTasks((current) => current.map((item) => item.id === updated.id ? updated : item)); setMessage(t('Estado y nota actualizados.')) }} />
        </article>
      })}
    </section>
  </div>
}
