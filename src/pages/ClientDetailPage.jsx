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
const dossierFields = sections.flatMap((section) => section.fields)
const isMissing = (value, type) => type === 'boolean' ? value == null : type === 'number' ? value == null || value === '' || Number(value) <= 0 : value == null || value === '' || /pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(value))
const displayValue = (value, type) => {
  if (type === 'boolean') return value == null ? 'Pendiente' : value ? 'Sí' : 'No'
  if (type === 'number' && value !== '' && value != null) return `$${value}`
  return value || 'Pendiente'
}

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editingSection, setEditingSection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    const result = await loadClient(clientId)
    setData(result); setDraft(result.client)
  }
  useEffect(() => { refresh().catch((loadError) => setError(loadError.message)) }, [clientId])
  if (!data && !error) return <LoadingScreen />
  if (error && !data) return <div className="page-stack"><p className="form-error">{error}</p><Link to="/clientes">← Volver</Link></div>

  const { client, tasks, blockers, workflowSteps, auditLog, notes } = data
  const missingFields = dossierFields.filter(([, key, type]) => isMissing(client[key], type)).map(([label]) => label)
  const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const startEditing = (index) => { setDraft(client); setEditingSection(index); setMessage(''); setError('') }
  const cancelEditing = () => { setDraft(client); setEditingSection(null) }
  const saveSection = async (section, index) => {
    setSaving(true); setError(''); setMessage('')
    try {
      const changes = Object.fromEntries(section.fields.map(([, key]) => [key, draft[key]]))
      await updateClient(clientId, changes)
      await refresh()
      setEditingSection(null); setMessage(`${section.title} guardado correctamente.`)
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }
  const toggleStep = async (step) => {
    try { await updateWorkflowStep(step.id, !step.completed); await refresh() }
    catch (updateError) { setError(updateError.message) }
  }

  return <div className="page-stack">
    <Link className="back-link" to="/clientes">← Todos los clientes</Link>
    <header className="page-header"><div><p className="eyebrow">{client.code} · Active Client Dossier</p><h2>{client.business_name}</h2><p className="muted">{client.phase}</p></div><div className="header-actions"><span className={`lifecycle large-pill ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span><button className="secondary-button" type="button" onClick={() => window.print()} disabled={editingSection != null} title="Guarda únicamente el dossier WWWW, sin tareas">Descargar WWWW</button></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    <section className="metric-grid compact"><article className="metric-card blue"><span>Gasto</span><strong>$${client.spend}</strong><small>registrado</small></article><article className="metric-card green"><span>Leads</span><strong>{client.leads}</strong><small>recibidos</small></article><article className="metric-card amber"><span>Citas</span><strong>{client.appointments}</strong><small>agendadas</small></article></section>
    <section className="content-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action}</h3></section>
    <section className="content-card missing-dossier-card"><p className="eyebrow">Falta en el dossier</p>{missingFields.length ? <div className="missing-chips">{missingFields.map((label) => <span key={label}>{label}</span>)}</div> : <p className="complete-note">Dossier WWWW completo</p>}</section>

    <div className="print-dossier">
      <header className="print-only print-title"><p>{client.code} · TACTICAL PIPELINE</p><h1>{client.business_name}</h1><span>{client.status} · {client.phase}</span></header>
      {sections.map((section, index) => {
        const editing = editingSection === index
        return <section className="content-card dossier-section" key={section.title}>
          <div className="section-heading dossier-section-heading"><p className="eyebrow">{section.title}</p><div className="section-actions">{editing ? <><button className="secondary-button" type="button" onClick={cancelEditing}>Cancelar</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={() => saveSection(section, index)}>{saving ? 'Guardando…' : 'Guardar'}</button></> : <button className="secondary-button" type="button" disabled={editingSection != null} onClick={() => startEditing(index)}>Editar</button>}</div></div>
          <div className="detail-grid">{section.fields.map(([label, key, type]) => <div className="detail-item" key={key}><span>{label}</span>{editing ? (type === 'boolean' ? <select value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => setField(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select> : type === 'status' ? <select value={draft[key]} onChange={(event) => setField(key, event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select> : <input type={type || 'text'} value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />) : (type === 'url' && client[key] ? <a href={client[key]} target="_blank" rel="noreferrer">Abrir enlace ↗</a> : <strong>{displayValue(client[key], type)}</strong>)}</div>)}</div>
        </section>
      })}
    </div>

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Operational Task Log</p><h3>Proceso asignado por rol</h3></div><span className="muted">{workflowSteps.filter((item) => item.completed).length} de {workflowSteps.length} visibles completados</span></div><div className="workflow-list">{workflowSteps.map((step) => <label className={`workflow-step ${step.completed ? 'completed' : ''}`} key={step.id}><input type="checkbox" checked={step.completed} onChange={() => toggleStep(step)} /><span className="workflow-order">{String(step.sort_order).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{step.owner_name}</small></div></label>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Notas del cliente</p><h3>Contexto compartido</h3></div><span className="muted">{notes.length} nota{notes.length === 1 ? '' : 's'}</span></div><div className="note-list">{notes.length === 0 && <p className="muted">Kevin todavía no ha agregado notas para este cliente.</p>}{notes.map((note) => <article className="note-card" key={note.id}><strong>{note.title}</strong>{note.body && <p>{note.body}</p>}<small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small></article>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div><span className="muted">Últimos {auditLog.length}</span></div><div className="audit-list">{auditLog.length === 0 && <p className="muted">Aún no hay cambios registrados.</p>}{auditLog.map((entry) => <article className="audit-row" key={entry.id}><span className={`audit-badge ${entry.actor_role}`}>{entry.actor_name}</span><div><strong>{entry.action === 'dossier_updated' ? 'Actualizó el dossier' : entry.summary}</strong>{entry.action === 'dossier_updated' && <p>{entry.changed_fields.map((field) => fieldLabels[field] || field).join(', ')}</p>}<small>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</small></div></article>)}</div></section>
    <div className="dashboard-grid"><section className="content-card"><p className="eyebrow">Tareas adicionales</p><h3>{tasks.length} visibles</h3>{tasks.slice(0, 8).map((task) => <div className="mini-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong>{task.evidence && <p className="task-detail">{task.evidence}</p>}<small>{task.status} · {task.owner_name}</small></div></div>)}</section><section className="content-card"><p className="eyebrow">Bloqueos</p><h3>{blockers.filter((item) => !item.resolved).length} abiertos</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section></div>
  </div>
}
