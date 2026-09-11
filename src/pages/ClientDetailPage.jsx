import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { loadClient, updateClient, updateWorkflowStep } from '../services/opsService'

const sections = [
  { title: 'Basic Business Profile', fields: [
    ['Business Name', 'business_name'], ['Owner Name', 'owner_name'], ['Phone Number', 'phone'], ['Email Address', 'email', 'email'],
    ['Physical Address / Primary Market', 'address'], ['Target ZIP Codes / Radius', 'target_zip_codes'], ['Legal Business Info · EIN / Tax ID', 'legal_business_info'],
  ] },
  { title: 'What · Offer, Guarantee & Retainer Terms', fields: [
    ['Core Service', 'services'], ['Core Consumer Offer', 'offer'], ['Target Monthly KPI', 'kpi'],
    ['Target Daily Ad Spend', 'daily_budget', 'number'], ['Minimum Target Project Size', 'minimum_project', 'number'],
  ] },
  { title: 'Asset Diagnostics & Existing Infrastructure', fields: [
    ['Does Client Need Website/Funnel Built?', 'needs_website_funnel', 'boolean'], ['Existing Domain Name', 'domain'],
    ['Existing Website URL', 'website_url', 'url'], ['Google Business Profile Status', 'gbp_status'], ['Existing GBP Link', 'gbp_link', 'url'],
  ] },
  { title: 'When · Timeline, Status & Onboarding', fields: [
    ['Onboarding Date', 'onboarding_date', 'date'], ['Target Ad Launch Date', 'target_launch_date', 'date'],
    ['Current Lifecycle Status', 'status', 'status'], ['Active Ad Strategy', 'ad_strategy'],
  ] },
  { title: 'Where · System Links & Access Keys', fields: [
    ['GoHighLevel Sub-Account / Access', 'ghl_subaccount_link'], ['Client Google Drive Assets Folder', 'drive_folder_link', 'url'],
    ['Facebook Page & Business Manager ID', 'facebook_business_info'], ['Meta Ad Account ID & Pixel ID', 'meta_assets_info'],
    ['Retell AI Agent ID', 'retell_agent_id'], ['Make.com Scenario Folder', 'make_scenario_link', 'url'], ['Slack Channel', 'slack_channel_link', 'url'],
  ] },
]

const fieldLabels = Object.fromEntries(sections.flatMap((section) => section.fields.map(([label, key]) => [key, label])))

const displayValue = (value, type) => {
  if (type === 'boolean') return value == null ? 'Pendiente' : value ? 'Sí' : 'No'
  if (type === 'number' && value !== '' && value != null) return `$${value}`
  return value || 'Pendiente'
}

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { loadClient(clientId).then((result) => { setData(result); setDraft(result.client) }).catch((loadError) => setError(loadError.message)) }, [clientId])
  if (!data && !error) return <LoadingScreen />
  if (error && !data) return <div className="page-stack"><p className="form-error">{error}</p><Link to="/clientes">← Volver</Link></div>

  const { client, tasks, blockers, workflowSteps, auditLog } = data
  const saveDossier = async () => {
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, draft)
      const refreshed = await loadClient(clientId)
      setData(refreshed); setDraft(refreshed.client); setEditing(false); setMessage('Dossier actualizado correctamente.')
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }
  const toggleStep = async (step) => {
    const completed = !step.completed
    try {
      await updateWorkflowStep(step.id, completed)
      const refreshed = await loadClient(clientId)
      setData(refreshed); setDraft(refreshed.client)
    } catch (updateError) { setError(updateError.message) }
  }
  const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }))

  return (
    <div className="page-stack">
      <Link className="back-link" to="/clientes">← Todos los clientes</Link>
      <header className="page-header"><div><p className="eyebrow">{client.code} · Active Client Dossier</p><h2>{client.business_name}</h2><p className="muted">{client.phase}</p></div><div className="header-actions"><span className={`lifecycle large-pill ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span>{editing ? <><button className="secondary-button" onClick={() => { setEditing(false); setDraft(client) }}>Cancelar</button><button className="primary-button compact-button" disabled={saving} onClick={saveDossier}>{saving ? 'Guardando…' : 'Guardar dossier'}</button></> : <button className="primary-button compact-button" onClick={() => setEditing(true)}>Editar dossier</button>}</div></header>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
      <section className="metric-grid compact"><article className="metric-card blue"><span>Gasto</span><strong>${client.spend}</strong><small>registrado</small></article><article className="metric-card green"><span>Leads</span><strong>{client.leads}</strong><small>recibidos</small></article><article className="metric-card amber"><span>Citas</span><strong>{client.appointments}</strong><small>agendadas</small></article></section>
      <section className="content-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action}</h3></section>
      {sections.map((section) => <section className="content-card dossier-section" key={section.title}><p className="eyebrow">{section.title}</p><div className="detail-grid">{section.fields.map(([label, key, type]) => <div className="detail-item" key={key}><span>{label}</span>{editing ? (type === 'boolean' ? <select value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => setField(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select> : type === 'status' ? <select value={draft[key]} onChange={(event) => setField(key, event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select> : <input type={type || 'text'} value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />) : (type === 'url' && client[key] ? <a href={client[key]} target="_blank" rel="noreferrer">Abrir enlace ↗</a> : <strong>{displayValue(client[key], type)}</strong>)}</div>)}</div></section>)}
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Operational Task Log</p><h3>Proceso asignado por rol</h3></div><span className="muted">{workflowSteps.filter((item) => item.completed).length} de {workflowSteps.length} visibles completados</span></div><div className="workflow-list">{workflowSteps.map((step) => <label className={`workflow-step ${step.completed ? 'completed' : ''}`} key={step.id}><input type="checkbox" checked={step.completed} onChange={() => toggleStep(step)} /><span className="workflow-order">{String(step.sort_order).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{step.owner_name}</small></div></label>)}</div></section>
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div><span className="muted">Últimos {auditLog.length}</span></div><div className="audit-list">{auditLog.length === 0 && <p className="muted">Aún no hay cambios registrados.</p>}{auditLog.map((entry) => <article className="audit-row" key={entry.id}><span className={`audit-badge ${entry.actor_role}`}>{entry.actor_name}</span><div><strong>{entry.action === 'dossier_updated' ? 'Actualizó el dossier' : entry.summary}</strong>{entry.action === 'dossier_updated' && <p>{entry.changed_fields.map((field) => fieldLabels[field] || field).join(', ')}</p>}<small>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</small></div></article>)}</div></section>
      <div className="dashboard-grid"><section className="content-card"><p className="eyebrow">Tareas adicionales</p><h3>{tasks.length} visibles</h3>{tasks.slice(0, 8).map((task) => <div className="mini-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong><small>{task.status} · {task.owner_name}</small></div></div>)}</section><section className="content-card"><p className="eyebrow">Bloqueos</p><h3>{blockers.filter((item) => !item.resolved).length} abiertos</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section></div>
    </div>
  )
}
