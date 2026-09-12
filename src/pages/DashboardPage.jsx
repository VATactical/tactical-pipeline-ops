import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import {
  createAssignedTask,
  createTeamNote,
  loadOperations,
  markTasksSeen,
  subscribeToOperations,
  updateTaskStatus,
} from '../services/opsService'

const priorityRank = { Urgente: 0, Alta: 1, Media: 2, Baja: 3 }
const ownerLabels = { onboarding_media: 'Diego', automation_funnels: 'Daniel', superadmin: 'Kevin' }
const isOverdue = (task) => task.due_at && task.status !== 'Completada' && new Date(`${task.due_at}T23:59:59`) < new Date()
const isStale = (client) => Date.now() - new Date(client.updated_at).getTime() > 3 * 86400000
const dossierFields = [
  'legal_name', 'owner_name', 'phone', 'email', 'address', 'target_zip_codes', 'legal_business_info',
  'services', 'offer', 'domain', 'website_url', 'gbp_status', 'onboarding_date', 'target_launch_date',
  'ad_strategy', 'ghl_subaccount_link', 'drive_folder_link', 'facebook_business_info', 'meta_assets_info',
  'retell_agent_id', 'make_scenario_link', 'slack_channel_link',
]
const isMissing = (value) => !value || /pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(value))

function AdminComposer({ clients, onCreated }) {
  const initial = { type: 'general_note', clientId: '', title: '', body: '', ownerRole: 'onboarding_media', priority: 'Media', dueAt: '' }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const needsClient = form.type === 'client_note' || form.type === 'client_task'
  const isTask = form.type === 'client_task' || form.type === 'general_task'

  const submit = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || (needsClient && !form.clientId)) return
    setSaving(true); setError('')
    try {
      if (isTask) await createAssignedTask(form)
      else await createTeamNote({ clientId: needsClient ? form.clientId : null, title: form.title, body: form.body })
      setForm(initial)
      onCreated(isTask ? 'Tarea asignada y alerta enviada.' : 'Nota guardada.')
    } catch (submitError) { setError(submitError.message) }
    finally { setSaving(false) }
  }

  return (
    <section className="content-card admin-composer">
      <div className="section-heading"><div><p className="eyebrow">Crear actualización</p><h3>Notas y tareas del equipo</h3></div><span className="muted">Kevin</span></div>
      <form onSubmit={submit}>
        <div className="entry-type" role="group" aria-label="Tipo de actualización">
          {[['general_note', 'Nota general'], ['client_note', 'Nota de cliente'], ['general_task', 'Tarea general'], ['client_task', 'Tarea de cliente']].map(([value, label]) => (
            <button className={form.type === value ? 'active' : ''} type="button" onClick={() => setField('type', value)} key={value}>{label}</button>
          ))}
        </div>
        <div className="composer-grid">
          {needsClient && <label>Cliente<select value={form.clientId} onChange={(event) => setField('clientId', event.target.value)} required><option value="">Seleccionar cliente…</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.business_name}</option>)}</select></label>}
          {isTask && <label>Asignar a<select value={form.ownerRole} onChange={(event) => setField('ownerRole', event.target.value)}><option value="onboarding_media">Diego</option><option value="automation_funnels">Daniel</option></select></label>}
          {isTask && <label>Prioridad<select value={form.priority} onChange={(event) => setField('priority', event.target.value)}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></label>}
          {isTask && <label>Fecha límite<input type="date" value={form.dueAt} onChange={(event) => setField('dueAt', event.target.value)} /></label>}
          <label className="wide">Título<input value={form.title} onChange={(event) => setField('title', event.target.value)} maxLength="160" required placeholder={isTask ? 'Qué debe hacerse' : 'Título de la nota'} /></label>
          <label className="wide">Detalle<textarea value={form.body} onChange={(event) => setField('body', event.target.value)} rows="3" maxLength="5000" placeholder="Contexto, instrucciones o información adicional…" /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button compact-button" disabled={saving}>{saving ? 'Guardando…' : isTask ? 'Asignar tarea' : 'Guardar nota'}</button>
      </form>
    </section>
  )
}

function GeneralNotes({ notes }) {
  const general = notes.filter((note) => !note.client_id).slice(0, 5)
  if (!general.length) return null
  return <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Comunicaciones</p><h3>Notas generales</h3></div></div><div className="note-list">{general.map((note) => <article className="note-card" key={note.id}><strong>{note.title}</strong>{note.body && <p>{note.body}</p>}<small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small></article>)}</div></section>
}

function SuperadminDashboard({ data, blockers, onCreated }) {
  const clientSummaries = data.clients.map((client) => {
    const missingCount = dossierFields.filter((key) => isMissing(client[key])).length
    const openTasks = data.tasks.filter((task) => task.client_id === client.id && task.status !== 'Completada').length
    const clientBlockers = blockers.filter((blocker) => blocker.client_id === client.id).length
    const pendingSteps = data.workflowSteps.filter((step) => step.client_id === client.id && !step.completed)
    return { client, missingCount, openTasks, clientBlockers, pendingSteps }
  })
  const incomplete = clientSummaries.filter((item) => item.missingCount > 0).length
  const statusCounts = data.clients.reduce((counts, client) => ({ ...counts, [client.status]: (counts[client.status] || 0) + 1 }), {})
  const overdue = data.tasks.filter(isOverdue)
  const stale = data.clients.filter(isStale)
  const ownerCounts = Object.entries(ownerLabels).map(([role, name]) => ({ name, count: data.tasks.filter((task) => task.owner_role === role && task.status !== 'Completada').length }))

  return <>
    <section className="metric-grid" aria-label="Clientes por estado">
      <article className="metric-card blue"><span>Onboarding</span><strong>{statusCounts.ONBOARDING || 0}</strong><small>de {data.clients.length} clientes activos</small></article>
      <article className="metric-card amber"><span>A2P Submitted</span><strong>{statusCounts['A2P SUBMITTED'] || 0}</strong><small>verificación enviada</small></article>
      <article className="metric-card green"><span>Ads Live</span><strong>{statusCounts['ADS LIVE'] || 0}</strong><small>campañas activas</small></article>
    </section>
    <section className="metric-grid compact" aria-label="Alertas operativas">
      <article className="metric-card red"><span>Tareas atrasadas</span><strong>{overdue.length}</strong><small>requieren seguimiento</small></article>
      <article className="metric-card amber"><span>Sin actualización</span><strong>{stale.length}</strong><small>más de 3 días</small></article>
      <article className="metric-card blue"><span>Tareas por responsable</span><div className="owner-counts">{ownerCounts.map((item) => <b key={item.name}>{item.name}: {item.count}</b>)}</div><small>tareas abiertas</small></article>
    </section>
    <AdminComposer clients={data.clients} onCreated={onCreated} />
    <GeneralNotes notes={data.notes} />
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Actividad del equipo</p><h3>Últimos movimientos</h3></div></div><div className="activity-list">{data.activity.slice(0, 8).map((item) => <article className="activity-row" key={item.id}><div><strong>{item.actor_name}</strong><p>{item.action === 'insert' ? 'creó' : item.action === 'update' ? 'actualizó' : 'eliminó'} {item.entity_type === 'tasks' ? 'una tarea' : item.entity_type === 'clients' ? 'un cliente' : item.entity_type === 'notes' ? 'una nota' : 'un registro operativo'}</p></div><small>{new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</small></article>)}</div></section>
    <section className="content-card"><div className="dossier-meta"><span>{data.clients.length} clientes totales</span><span>{incomplete} dossiers incompletos</span><span className={blockers.length ? 'danger-text' : ''}>{new Set(blockers.map((item) => item.client_id)).size} clientes bloqueados</span></div></section>
    <section>
      <div className="section-heading"><div><p className="eyebrow">Control por cliente</p><h3>Seguimiento por cliente</h3></div><Link to="/clientes">Abrir pipeline</Link></div>
      <div className="dossier-grid">{clientSummaries.map(({ client, openTasks, clientBlockers, pendingSteps }) => <Link className={`dossier-card ${clientBlockers ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
        <div className="client-card-top"><div><span className="client-code">{client.code}</span><h3>{client.business_name}</h3></div><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
        <div className="dossier-meta"><span>{client.phase}</span><span>{openTasks} tareas abiertas</span>{clientBlockers > 0 && <span className="danger-text">{clientBlockers} bloqueo{clientBlockers === 1 ? '' : 's'}</span>}</div>
        <div className="process-pending"><strong>Siguiente paso del proceso</strong>{pendingSteps.length ? <><p>{pendingSteps[0].title}</p><small>{pendingSteps[0].owner_name}</small></> : <p className="complete-note">Proceso completo · auditoría activa</p>}</div>
        <div className="next-step"><span>Próximo paso</span><p>{client.next_action}</p></div><span className="card-link">Ver expediente completo →</span>
      </Link>)}</div>
    </section>
  </>
}

function RoleDashboard({ data, openTasks, blockers, changeStatus, newTasks, markSeen }) {
  const priorityTasks = useMemo(() => [...openTasks].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)).slice(0, 5), [openTasks])
  const overdue = openTasks.filter(isOverdue)
  const stale = data.clients.filter(isStale)
  return <>
    {newTasks.length > 0 && <section className="new-task-alert" role="alert"><div><strong>{newTasks.length} tarea{newTasks.length === 1 ? '' : 's'} nueva{newTasks.length === 1 ? '' : 's'}</strong><p>Kevin agregó trabajo nuevo a tu tablero.</p></div><button className="secondary-button" onClick={markSeen}>Marcar como vistas</button></section>}
    <GeneralNotes notes={data.notes} />
    <section className="metric-grid" aria-label="Resumen operativo">
      <article className="metric-card blue"><span>Mis tareas abiertas</span><strong>{openTasks.length}</strong><small>{newTasks.length} nuevas</small></article>
      <article className="metric-card amber"><span>Mis tareas atrasadas</span><strong>{overdue.length}</strong><small>{stale.length} clientes sin actualización</small></article>
      <article className="metric-card red"><span>Bloqueos</span><strong>{blockers.length}</strong><small>Requieren seguimiento</small></article>
    </section>
    <div className="dashboard-grid">
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Orden recomendado</p><h3>Qué debes hacer ahora</h3></div><Link to="/tareas">Ver todas</Link></div><div className="task-list">{priorityTasks.map((task, index) => <article className={`task-row ${isOverdue(task) ? 'overdue' : ''}`} key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'}</strong><p>{task.title}</p>{task.evidence && <p className="task-detail">{task.evidence}</p>}<small>{task.phase} · {task.owner_name}{task.due_at ? ` · Vence ${task.due_at}` : ''}</small></div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)} aria-label={`Estado de ${task.title}`}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}</div></section>
      <section className="content-card alert-card"><p className="eyebrow">Dependencias</p><h3>Bloqueos abiertos</h3><div className="blocker-list">{blockers.map((blocker) => <article className="blocker-row" key={blocker.id}><span className="alert-dot red-dot" /><div><strong>{blocker.clients?.code} · {blocker.clients?.business_name}</strong><p>{blocker.title}</p><small>Responsable: {blocker.owner_name}</small></div></article>)}</div></section>
    </div>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Pipeline</p><h3>Estado de clientes</h3></div><Link to="/clientes">Ver clientes</Link></div><div className="pipeline-list">{data.clients.map((client) => <Link className="pipeline-row" to={`/clientes/${client.id}`} key={client.id}><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span><div><strong>{client.code} · {client.business_name}</strong><small>{client.phase}</small></div><p><b>Siguiente:</b> {client.next_action}</p><span className="row-arrow">→</span></Link>)}</div></section>
  </>
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const [data, setData] = useState({ clients: [], tasks: [], blockers: [], workflowSteps: [], notes: [], activity: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [seenAt, setSeenAt] = useState(profile?.last_task_seen_at)
  const refresh = useCallback(async () => {
    try { setData(await loadOperations()) } catch (loadError) { setError(loadError.message) }
  }, [])

  useEffect(() => { refresh().finally(() => setLoading(false)); return subscribeToOperations(refresh) }, [refresh])
  useEffect(() => setSeenAt(profile?.last_task_seen_at), [profile?.last_task_seen_at])
  const openTasks = data.tasks.filter((task) => task.status !== 'Completada')
  const activeBlockers = data.blockers.filter((blocker) => !blocker.resolved)
  const isAdmin = profile?.role === 'superadmin'
  const newTasks = isAdmin ? [] : data.tasks.filter((task) => task.owner_role === profile?.role && new Date(task.created_at) > new Date(seenAt || 0))

  const changeStatus = async (taskId, status) => {
    try { await updateTaskStatus(taskId, status); setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task) })) }
    catch (updateError) { setError(updateError.message) }
  }
  const handleCreated = async (text) => { setMessage(text); await refresh() }
  const handleMarkSeen = async () => {
    try { setSeenAt(await markTasksSeen(profile.id)) } catch (markError) { setError(markError.message) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{isAdmin ? 'Superadmin · Control de dossiers' : 'Centro operativo'}</p><h2>Hola, {profile?.full_name || 'equipo'}</h2><p className="muted">{isAdmin ? 'Revisa el estado, crea notas y asigna tareas por cliente.' : 'Tus clientes, tareas y alertas asignadas.'}</p></div><span className="status-pill">Datos en vivo</span></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    {isAdmin ? <SuperadminDashboard data={data} blockers={activeBlockers} onCreated={handleCreated} /> : <RoleDashboard data={data} openTasks={openTasks} blockers={activeBlockers} changeStatus={changeStatus} newTasks={newTasks} markSeen={handleMarkSeen} />}
  </div>
}
