import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadOperations, updateTaskStatus } from '../services/opsService'

const priorityRank = { Urgente: 0, Alta: 1, Media: 2 }

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

  const changeStatus = async (taskId, status) => {
    try {
      await updateTaskStatus(taskId, status)
      setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task) }))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Centro operativo</p><h2>Hola, {profile?.full_name || 'equipo'}</h2></div><span className="status-pill">Actualizado 10 sep 2026</span></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="metric-grid" aria-label="Resumen operativo">
        <article className="metric-card blue"><span>Clientes activos</span><strong>{data.clients.length}</strong><small>C2 · C4 · C5 · C6 · C8 · C9</small></article>
        <article className="metric-card amber"><span>Tareas abiertas</span><strong>{openTasks.length}</strong><small>{priorityTasks.length} prioritarias visibles</small></article>
        <article className="metric-card red"><span>Bloqueos</span><strong>{activeBlockers.length}</strong><small>Requieren seguimiento</small></article>
      </section>
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="section-heading"><div><p className="eyebrow">Orden recomendado</p><h3>Qué debes hacer ahora</h3></div><Link to="/tareas">Ver todas</Link></div>
          <div className="task-list">{priorityTasks.map((task, index) => <article className="task-row" key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task.clients?.code} · {task.clients?.business_name}</strong><p>{task.title}</p><small>{task.phase} · {task.owner_name}</small></div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)} aria-label={`Estado de ${task.title}`}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}</div>
        </section>
        <section className="content-card">
          <p className="eyebrow">Dependencias</p><h3>Bloqueos abiertos</h3>
          <div className="blocker-list">{activeBlockers.map((blocker) => <article className="blocker-row" key={blocker.id}><strong>{blocker.clients?.code} · {blocker.clients?.business_name}</strong><p>{blocker.title}</p><small>Responsable: {blocker.owner_name}</small></article>)}</div>
        </section>
      </div>
      <section className="content-card">
        <div className="section-heading"><div><p className="eyebrow">Pipeline</p><h3>Estado de clientes</h3></div><Link to="/clientes">Ver clientes</Link></div>
        <div className="pipeline-list">{data.clients.map((client) => <Link className="pipeline-row" to={`/clientes/${client.id}`} key={client.id}><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span><div><strong>{client.code} · {client.business_name}</strong><small>{client.phase}</small></div><p><b>Siguiente:</b> {client.next_action}</p><span className="row-arrow">→</span></Link>)}</div>
      </section>
    </div>
  )
}
