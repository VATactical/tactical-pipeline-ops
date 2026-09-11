import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadOperations, updateTaskStatus } from '../services/opsService'

const priorityRank = { Urgente: 0, Alta: 1, Media: 2 }
const roleNames = { onboarding_media: 'Diego · Onboarding & Media', automation_funnels: 'Daniel · Automations & Funnels' }

export default function DashboardPage() {
  const { profile } = useAuth()
  const [data, setData] = useState({ clients: [], tasks: [], blockers: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadOperations().then(setData).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [])

  const openTasks = data.tasks.filter((task) => task.status !== 'Completada')
  const priorityTasks = useMemo(() => [...openTasks]
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9))
    .slice(0, 5), [openTasks])
  const activeBlockers = data.blockers.filter((blocker) => !blocker.resolved)
  const isAdmin = profile?.role === 'superadmin'
  const completion = data.tasks.length ? Math.round((data.tasks.filter((task) => task.status === 'Completada').length / data.tasks.length) * 100) : 0
  const roleProgress = Object.entries(roleNames).map(([role, name]) => {
    const tasks = data.tasks.filter((task) => task.owner_role === role)
    const completed = tasks.filter((task) => task.status === 'Completada').length
    return { role, name, total: tasks.length, completed, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 }
  })
  const urgentAlerts = openTasks.filter((task) => task.priority === 'Urgente').slice(0, 5)

  const changeStatus = async (taskId, status) => {
    try {
      await updateTaskStatus(taskId, status)
      setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task) }))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{isAdmin ? 'Vista ejecutiva · Superadmin' : 'Centro operativo'}</p><h2>Hola, {profile?.full_name || 'equipo'}</h2><p className="muted">{isAdmin ? 'Control general del equipo, progreso y alertas.' : 'Tus clientes y tareas asignadas.'}</p></div><span className="status-pill">Datos en vivo</span></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="metric-grid" aria-label="Resumen operativo">
        <article className="metric-card blue"><span>Clientes activos</span><strong>{data.clients.length}</strong><small>C2 · C4 · C5 · C6 · C8 · C9</small></article>
        <article className="metric-card amber"><span>Tareas abiertas</span><strong>{openTasks.length}</strong><small>{priorityTasks.length} prioritarias visibles</small></article>
        <article className="metric-card red"><span>{isAdmin ? 'Progreso total' : 'Bloqueos'}</span><strong>{isAdmin ? `${completion}%` : activeBlockers.length}</strong><small>{isAdmin ? `${data.tasks.filter((task) => task.status === 'Completada').length} tareas completadas` : 'Requieren seguimiento'}</small></article>
      </section>
      {isAdmin && <section className="role-progress-grid">{roleProgress.map((item) => <article className="content-card progress-card" key={item.role}><div className="section-heading"><div><p className="eyebrow">Progreso por rol</p><h3>{item.name}</h3></div><strong>{item.percent}%</strong></div><div className="progress-track"><span style={{ width: `${item.percent}%` }} /></div><small>{item.completed} completadas de {item.total} tareas</small></article>)}</section>}
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="section-heading"><div><p className="eyebrow">Orden recomendado</p><h3>Qué debes hacer ahora</h3></div><Link to="/tareas">Ver todas</Link></div>
          <div className="task-list">{priorityTasks.map((task, index) => <article className="task-row" key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task.clients?.code} · {task.clients?.business_name}</strong><p>{task.title}</p><small>{task.phase} · {task.owner_name}</small></div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)} aria-label={`Estado de ${task.title}`}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}</div>
        </section>
        <section className="content-card alert-card">
          <p className="eyebrow">{isAdmin ? 'Centro de alertas' : 'Dependencias'}</p><h3>{isAdmin ? `${activeBlockers.length + urgentAlerts.length} alertas activas` : 'Bloqueos abiertos'}</h3>
          <div className="blocker-list">{activeBlockers.map((blocker) => <article className="blocker-row" key={blocker.id}><span className="alert-dot red-dot" /><div><strong>{blocker.clients?.code} · {blocker.clients?.business_name}</strong><p>{blocker.title}</p><small>Responsable: {blocker.owner_name}</small></div></article>)}{isAdmin && urgentAlerts.map((task) => <article className="blocker-row" key={`alert-${task.id}`}><span className="alert-dot amber-dot" /><div><strong>{task.clients?.code} · Tarea urgente</strong><p>{task.title}</p><small>Asignada a {task.owner_name}</small></div></article>)}</div>
        </section>
      </div>
      <section className="content-card">
        <div className="section-heading"><div><p className="eyebrow">Pipeline</p><h3>Estado de clientes</h3></div><Link to="/clientes">Ver clientes</Link></div>
        <div className="pipeline-list">{data.clients.map((client) => <Link className="pipeline-row" to={`/clientes/${client.id}`} key={client.id}><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span><div><strong>{client.code} · {client.business_name}</strong><small>{client.phase}</small></div><p><b>Siguiente:</b> {client.next_action}</p><span className="row-arrow">→</span></Link>)}</div>
      </section>
    </div>
  )
}
