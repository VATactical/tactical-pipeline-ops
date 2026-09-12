import { useEffect, useMemo, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { runWithSessionRetry, supabase } from '../lib/supabase'
import { createAssignedTask, updateTaskManagement, updateTaskStatus } from '../services/opsService'
import { useAuth } from '../auth/AuthContext'

const initialTask = { scope: 'general', clientId: '', clientSearch: '', title: '', body: '', ownerRole: '', priority: 'Media', dueAt: '' }
const ownerName = (role) => role === 'onboarding_media' ? 'Diego' : role === 'automation_funnels' ? 'Daniel' : role === 'user_admin' ? 'User Admin' : 'Todos'

function TaskComposer({ clients, onCreated, profile }) {
  const isAdmin = profile.role === 'superadmin'
  const emptyForm = { ...initialTask, ownerRole: isAdmin ? '' : profile.role }
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const matches = clients.filter((client) => `${client.code} ${client.business_name}`.toLowerCase().includes(form.clientSearch.toLowerCase())).slice(0, 6)
  const selected = clients.find((client) => client.id === form.clientId)
  const submit = async (event) => {
    event.preventDefault()
    if (form.scope === 'client' && !form.clientId) { setError('Selecciona el cliente específico.'); return }
    setSaving(true); setError('')
    try {
      const task = await createAssignedTask({ ...form, clientId: form.scope === 'client' ? form.clientId : null, ownerRole: form.ownerRole || null })
      onCreated(task); setForm(emptyForm)
    } catch (submitError) { setError(submitError.message) }
    finally { setSaving(false) }
  }
  return <section className="content-card task-composer"><div className="section-heading"><div><p className="eyebrow">Nueva tarea</p><h3>Asignar trabajo</h3></div></div><form onSubmit={submit}>
    <div className="entry-type"><button type="button" className={form.scope === 'general' ? 'active' : ''} onClick={() => setField('scope', 'general')}>Tarea general</button><button type="button" className={form.scope === 'client' ? 'active' : ''} onClick={() => setField('scope', 'client')}>Cliente específico</button></div>
    <div className="composer-grid">
      {form.scope === 'client' && <label className="wide client-search-picker">Buscar cliente<input type="search" value={form.clientSearch} placeholder="Escribe código o nombre…" onChange={(event) => { setField('clientSearch', event.target.value); setField('clientId', '') }} required />{selected ? <span className="selected-client">Seleccionado: {selected.code} · {selected.business_name}</span> : form.clientSearch && <div className="search-results">{matches.map((client) => <button type="button" key={client.id} onClick={() => setForm((current) => ({ ...current, clientId: client.id, clientSearch: `${client.code} · ${client.business_name}` }))}>{client.code} · {client.business_name}</button>)}{matches.length === 0 && <span>No encontramos ese cliente.</span>}</div>}</label>}
      <label>Asignar a<select value={form.ownerRole} onChange={(event) => setField('ownerRole', event.target.value)} disabled={!isAdmin}>{isAdmin && <option value="">Todos</option>}<option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option>{isAdmin && <option value="user_admin">User Admin</option>}</select></label>
      <label>Prioridad<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></label>
      <label>Fecha límite<input type="date" value={form.dueAt} onChange={(event) => setField('dueAt', event.target.value)} /></label>
      <label className="wide">Título<input value={form.title} onChange={(event) => setField('title', event.target.value)} maxLength="160" required placeholder="Qué debe realizarse" /></label>
      <label className="wide">Detalle<textarea rows="3" value={form.body} onChange={(event) => setField('body', event.target.value)} placeholder="Contexto e instrucciones…" /></label>
    </div>{error && <p className="form-error">{error}</p>}<button className="primary-button compact-button" disabled={saving}>{saving ? 'Creando…' : 'Crear tarea'}</button>
  </form></section>
}

export default function TasksPage() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState([])
  const [clients, setClients] = useState([])
  const [filter, setFilter] = useState('Abiertas')
  const [priority, setPriority] = useState('Todas')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    runWithSessionRetry(() => Promise.all([
      supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, code, business_name').order('code'),
    ])).then(([tasksResult, clientsResult]) => {
      const queryError = tasksResult.error || clientsResult.error
      if (queryError) setError(queryError.message)
      else { setTasks(tasksResult.data || []); setClients(clientsResult.data || []) }
    }).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => tasks.filter((task) => {
    const matchesStatus = filter === 'Todas' || (filter === 'Abiertas' ? task.status !== 'Completada' : task.status === 'Completada')
    const matchesPriority = priority === 'Todas' || task.priority === priority
    const term = search.trim().toLowerCase()
    return matchesStatus && matchesPriority && (!term || `${task.title} ${task.clients?.code || ''} ${task.clients?.business_name || ''}`.toLowerCase().includes(term))
  }), [tasks, filter, priority, search])
  const changeStatus = async (id, status) => {
    try { await updateTaskStatus(id, status); setTasks((current) => current.map((task) => task.id === id ? { ...task, status, completed_at: status === 'Completada' ? new Date().toISOString() : null } : task)) }
    catch (updateError) { setError(updateError.message) }
  }
  const manageTask = async (task, changes) => {
    const next = { ownerRole: task.owner_role || '', priority: task.priority, dueAt: task.due_at || '', ...changes }
    try { await updateTaskManagement(task.id, next); setTasks((current) => current.map((item) => item.id === task.id ? { ...item, owner_role: next.ownerRole || null, owner_name: ownerName(next.ownerRole), priority: next.priority, due_at: next.dueAt || null } : item)) }
    catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Ejecución</p><h2>Tareas</h2><p className="muted">Las completadas se conservan separadas en Historial.</p></div><span className="status-pill">{visible.length} visibles</span></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {profile?.permissions?.tasks_create && <TaskComposer clients={clients} profile={profile} onCreated={(task) => { setTasks((current) => [task, ...current]); setMessage('Tarea creada y alerta enviada.') }} />}
    <section className="filter-bar"><input type="search" placeholder="Buscar tarea o cliente…" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>Abiertas</option><option>Historial completadas</option><option>Todas</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Todas</option><option>Urgente</option><option>Alta</option><option>Media</option><option>Baja</option></select></section>
    <section className="content-card task-table">{visible.length === 0 && <p className="muted">No hay tareas en esta vista.</p>}{visible.map((task) => { const overdue = task.due_at && task.status !== 'Completada' && new Date(`${task.due_at}T23:59:59`) < new Date(); return <article className={`task-row ${overdue ? 'overdue' : ''}`} key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'}</strong><p>{task.title}</p>{task.comments && <p className="task-detail">{task.comments}</p>}<small>{task.phase} · {task.owner_name}{task.due_at ? ` · ${overdue ? 'Atrasada' : 'Vence'} ${task.due_at}` : ''}</small>{profile?.role === 'superadmin' && <div className="task-admin-controls"><select value={task.owner_role || ''} onChange={(event) => manageTask(task, { ownerRole: event.target.value })}><option value="">Todos</option><option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option></select><select value={task.priority} onChange={(event) => manageTask(task, { priority: event.target.value })}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select><input type="date" value={task.due_at || ''} onChange={(event) => manageTask(task, { dueAt: event.target.value })} /></div>}</div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>})}</section>
  </div>
}
