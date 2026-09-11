import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadOperations, updateTaskStatus } from '../services/opsService'

const priorityRank = { Urgente: 0, Alta: 1, Media: 2 }
const dossierFields = [
  ['Nombre legal', 'legal_name'], ['Propietario', 'owner_name'], ['Teléfono', 'phone'], ['Correo', 'email'],
  ['Dirección', 'address'], ['ZIP / radio', 'target_zip_codes'], ['EIN / Tax ID', 'legal_business_info'],
  ['Servicios', 'services'], ['Oferta', 'offer'], ['Dominio', 'domain'], ['Sitio web', 'website_url'],
  ['Google Business Profile', 'gbp_status'], ['Onboarding', 'onboarding_date'], ['Fecha de lanzamiento', 'target_launch_date'],
  ['Estrategia de anuncios', 'ad_strategy'], ['Acceso GHL', 'ghl_subaccount_link'], ['Carpeta Drive', 'drive_folder_link'],
  ['Facebook / Business Manager', 'facebook_business_info'], ['Ad Account / Pixel', 'meta_assets_info'],
  ['Retell AI', 'retell_agent_id'], ['Make.com', 'make_scenario_link'], ['Canal Slack', 'slack_channel_link'],
]

const isMissing = (value) => !value || /pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(value))
const missingFromDossier = (client) => dossierFields.filter(([, key]) => isMissing(client[key])).map(([label]) => label)

function SuperadminDashboard({ data, blockers }) {
  const clientSummaries = data.clients.map((client) => {
    const missing = missingFromDossier(client)
    const openTasks = data.tasks.filter((task) => task.client_id === client.id && task.status !== 'Completada').length
    const clientBlockers = blockers.filter((blocker) => blocker.client_id === client.id).length
    const pendingSteps = data.workflowSteps.filter((step) => step.client_id === client.id && !step.completed)
    return { client, missing, openTasks, clientBlockers, pendingSteps }
  })
  const incomplete = clientSummaries.filter((item) => item.missing.length > 0).length
  const statusCounts = data.clients.reduce((counts, client) => ({ ...counts, [client.status]: (counts[client.status] || 0) + 1 }), {})

  return (
    <>
      <section className="metric-grid" aria-label="Clientes por estado">
        <article className="metric-card blue"><span>Onboarding</span><strong>{statusCounts.ONBOARDING || 0}</strong><small>de {data.clients.length} clientes activos</small></article>
        <article className="metric-card amber"><span>A2P Submitted</span><strong>{statusCounts['A2P SUBMITTED'] || 0}</strong><small>verificación enviada</small></article>
        <article className="metric-card green"><span>Ads Live</span><strong>{statusCounts['ADS LIVE'] || 0}</strong><small>campañas activas</small></article>
      </section>
      <section className="content-card"><div className="dossier-meta"><span>{data.clients.length} clientes totales</span><span>{incomplete} dossiers incompletos</span><span className={blockers.length ? 'danger-text' : ''}>{new Set(blockers.map((item) => item.client_id)).size} clientes bloqueados</span></div></section>
      <section>
        <div className="section-heading"><div><p className="eyebrow">Control por cliente</p><h3>Qué falta según cada dossier</h3></div><Link to="/clientes">Abrir pipeline</Link></div>
        <div className="dossier-grid">{clientSummaries.map(({ client, missing, openTasks, clientBlockers, pendingSteps }) => <Link className={`dossier-card ${clientBlockers ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
          <div className="client-card-top"><div><span className="client-code">{client.code}</span><h3>{client.business_name}</h3></div><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
          <div className="dossier-meta"><span>{client.phase}</span><span>{openTasks} tareas abiertas</span>{clientBlockers > 0 && <span className="danger-text">{clientBlockers} bloqueo{clientBlockers === 1 ? '' : 's'}</span>}</div>
          <div className="missing-section"><strong>Falta en el dossier</strong>{missing.length ? <div className="missing-chips">{missing.map((item) => <span key={item}>{item}</span>)}</div> : <p className="complete-note">Dossier esencial completo</p>}</div>
          <div className="process-pending"><strong>Siguiente paso del proceso</strong>{pendingSteps.length ? <><p>{pendingSteps[0].title}</p><small>{pendingSteps[0].owner_name}</small></> : <p className="complete-note">Proceso completo · auditoría activa</p>}</div>
          <div className="next-step"><span>Próximo paso</span><p>{client.next_action}</p></div>
          <span className="card-link">Ver expediente completo →</span>
        </Link>)}</div>
      </section>
    </>
  )
}

function RoleDashboard({ data, openTasks, blockers, changeStatus }) {
  const priorityTasks = useMemo(() => [...openTasks].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)).slice(0, 5), [openTasks])
  return (
    <>
      <section className="metric-grid" aria-label="Resumen operativo">
        <article className="metric-card blue"><span>Clientes activos</span><strong>{data.clients.length}</strong><small>Pipeline compartido</small></article>
        <article className="metric-card amber"><span>Mis tareas abiertas</span><strong>{openTasks.length}</strong><small>{priorityTasks.length} prioritarias visibles</small></article>
        <article className="metric-card red"><span>Bloqueos</span><strong>{blockers.length}</strong><small>Requieren seguimiento</small></article>
      </section>
      <div className="dashboard-grid">
        <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Orden recomendado</p><h3>Qué debes hacer ahora</h3></div><Link to="/tareas">Ver todas</Link></div><div className="task-list">{priorityTasks.map((task, index) => <article className="task-row" key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{task.clients?.code} · {task.clients?.business_name}</strong><p>{task.title}</p><small>{task.phase} · {task.owner_name}</small></div><select value={task.status} onChange={(event) => changeStatus(task.id, event.target.value)} aria-label={`Estado de ${task.title}`}><option>Pendiente</option><option>En progreso</option><option>Bloqueada</option><option>Completada</option></select></article>)}</div></section>
        <section className="content-card alert-card"><p className="eyebrow">Dependencias</p><h3>Bloqueos abiertos</h3><div className="blocker-list">{blockers.map((blocker) => <article className="blocker-row" key={blocker.id}><span className="alert-dot red-dot" /><div><strong>{blocker.clients?.code} · {blocker.clients?.business_name}</strong><p>{blocker.title}</p><small>Responsable: {blocker.owner_name}</small></div></article>)}</div></section>
      </div>
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Pipeline</p><h3>Estado de clientes</h3></div><Link to="/clientes">Ver clientes</Link></div><div className="pipeline-list">{data.clients.map((client) => <Link className="pipeline-row" to={`/clientes/${client.id}`} key={client.id}><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span><div><strong>{client.code} · {client.business_name}</strong><small>{client.phase}</small></div><p><b>Siguiente:</b> {client.next_action}</p><span className="row-arrow">→</span></Link>)}</div></section>
    </>
  )
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const [data, setData] = useState({ clients: [], tasks: [], blockers: [], workflowSteps: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadOperations().then(setData).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)) }, [])
  const openTasks = data.tasks.filter((task) => task.status !== 'Completada')
  const activeBlockers = data.blockers.filter((blocker) => !blocker.resolved)
  const isAdmin = profile?.role === 'superadmin'

  const changeStatus = async (taskId, status) => {
    try {
      await updateTaskStatus(taskId, status)
      setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status } : task) }))
    } catch (updateError) { setError(updateError.message) }
  }

  if (loading) return <LoadingScreen />
  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">{isAdmin ? 'Superadmin · Control de dossiers' : 'Centro operativo'}</p><h2>Hola, {profile?.full_name || 'equipo'}</h2><p className="muted">{isAdmin ? 'Revisa por cliente qué información, acceso o configuración sigue pendiente.' : 'Tus clientes y tareas asignadas.'}</p></div><span className="status-pill">Datos en vivo</span></header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {isAdmin ? <SuperadminDashboard data={data} blockers={activeBlockers} /> : <RoleDashboard data={data} openTasks={openTasks} blockers={activeBlockers} changeStatus={changeStatus} />}
    </div>
  )
}
