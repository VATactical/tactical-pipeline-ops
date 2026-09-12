import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { buildDossierText, copyDossier, downloadDossierPdf } from '../lib/dossierExport'
import { loadClient, markGoogleDocsUpdated, recordDossierEvent, updateClient, updateWorkflowStep } from '../services/opsService'

const sections = [
  { title: 'Who · Perfil comercial', fields: [
    ['Business Name', 'business_name'], ['Owner Name', 'owner_name'], ['Phone Number', 'phone'], ['Email Address', 'email', 'email'],
    ['Physical Address', 'address'], ['Legal Business Info · EIN / Tax ID', 'legal_business_info'], ['Persona / KYC Status', 'kyc_status'],
  ] },
  { title: 'What · Oferta y objetivos', fields: [
    ['Core Service', 'services'], ['Core Consumer Offer', 'offer'], ['Target Monthly KPI', 'kpi'],
    ['Target Daily Ad Spend', 'daily_budget', 'number'], ['Minimum Target Project Size', 'minimum_project', 'number'],
    ['Project Type', 'project_type'], ['Target Customer Profile', 'ideal_customer_profile'],
  ] },
  { title: 'Where · Mercado', fields: [
    ['Target ZIP Codes / Radius', 'target_zip_codes'], ['Markets / Cities', 'markets'], ['Excluded Locations', 'exclusions'], ['Timezone', 'timezone'],
  ] },
  { title: 'Infraestructura', fields: [
    ['Does Client Need Website/Funnel Built?', 'needs_website_funnel', 'boolean'], ['Existing Domain Name', 'domain'],
    ['Existing Website URL', 'website_url', 'url'], ['Google Business Profile Status', 'gbp_status'], ['Existing GBP Link', 'gbp_link', 'url'],
    ['Available Assets', 'available_assets'],
  ] },
  { title: 'When · Cronología', fields: [
    ['Onboarding Date', 'onboarding_date', 'date'], ['Target Ad Launch Date', 'target_launch_date', 'date'],
    ['Current Lifecycle Status', 'status', 'status'],
  ] },
  { title: 'Enlaces y accesos', fields: [
    ['GoHighLevel Sub-Account / Access', 'ghl_subaccount_link'], ['Client Google Drive Assets Folder', 'drive_folder_link', 'url'],
    ['Google Docs Dossier', 'google_docs_url', 'url'], ['Facebook Page', 'facebook_page_url', 'url'], ['Instagram Account', 'instagram_url', 'url'],
    ['Meta Business Portfolio ID', 'meta_business_portfolio_id'], ['Meta Ad Account ID', 'meta_ad_account_id'], ['Meta Pixel / Dataset ID', 'meta_pixel_id'],
    ['Landing Page', 'landing_page_url', 'url'], ['Facebook Page & Business Manager Notes', 'facebook_business_info'], ['Meta Assets Notes', 'meta_assets_info'],
    ['Retell AI Agent ID', 'retell_agent_id'], ['Make.com Scenario Folder', 'make_scenario_link', 'url'], ['Slack Channel', 'slack_channel_link', 'url'],
  ] },
  { title: 'Estrategia publicitaria', fields: [
    ['Active Ad Strategy', 'ad_strategy'], ['Meta Status', 'meta_status'], ['Daily Budget', 'daily_budget', 'number'],
  ] },
  { title: 'Registro operativo', fields: [
    ['Operational Phase', 'phase'], ['Next Action', 'next_action'], ['GHL Status', 'ghl_status'], ['A2P Status', 'a2p_status'],
  ] },
  { title: 'Estado de finalización', fields: [
    ['Onboarding Completed', 'onboarding_completed', 'boolean'], ['GHL Access Confirmed', 'ghl_access_confirmed', 'boolean'],
    ['Facebook Access Confirmed', 'facebook_access_confirmed', 'boolean'], ['Ad Account Access Confirmed', 'ad_account_access_confirmed', 'boolean'],
    ['Pixel Access Confirmed', 'pixel_access_confirmed', 'boolean'], ['Domain Access Confirmed', 'domain_access_confirmed', 'boolean'],
    ['Payment Method Confirmed', 'payment_method_confirmed', 'boolean'], ['Persona / KYC Completed', 'kyc_completed', 'boolean'],
    ['A2P Submitted', 'a2p_submitted', 'boolean'], ['Funnel Live', 'funnel_live', 'boolean'], ['Meta Campaign Live', 'meta_campaign_live', 'boolean'],
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
const normalizeSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export default function ClientDetailPage() {
  const { clientId } = useParams()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editingSection, setEditingSection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [dossierSearch, setDossierSearch] = useState('')
  const [highlightedSection, setHighlightedSection] = useState(null)

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

  const updatedBy = auditLog[0]?.actor_name || profile?.full_name || 'Pending'
  const canEdit = Boolean(profile?.permissions?.clients_edit)
  const dossierText = buildDossierText(client, updatedBy)
  const copyForGoogleDocs = async () => {
    try {
      await copyDossier(dossierText)
      await recordDossierEvent(clientId, 'copied_google_docs', profile.id)
      setMessage('Dossier copied successfully')
      await refresh()
    } catch (copyError) { setError(copyError.message) }
  }
  const downloadPdf = async () => {
    try {
      await downloadDossierPdf(client, dossierText)
      await recordDossierEvent(clientId, 'downloaded_pdf', profile.id)
      setMessage('PDF descargado correctamente.')
    } catch (downloadError) { setError(downloadError.message) }
  }
  const markDocsUpdated = async () => {
    try {
      await markGoogleDocsUpdated(clientId, profile.id)
      await refresh()
      setMessage('Google Docs marcado como actualizado.')
    } catch (updateError) { setError(updateError.message) }
  }
  const toggleIntakeForm = async () => {
    if (!canEdit) return
    const completed = !client.intake_form_completed
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, {
        intake_form_completed: completed,
        intake_form_completed_at: completed ? new Date().toISOString() : null,
        intake_form_completed_by: completed ? profile.id : null,
      })
      await refresh()
      setMessage(completed ? 'Formulario del cliente marcado como recibido.' : 'Formulario marcado como pendiente.')
    } catch (updateError) { setError(updateError.message) }
    finally { setSaving(false) }
  }
  const launchDate = client.target_launch_date ? new Date(`${client.target_launch_date}T23:59:59`) : null
  const launchOverdue = launchDate && client.status !== 'ADS LIVE' && launchDate < new Date()
  const slackChannelUrl = /^https?:\/\//i.test(client.slack_channel_link || '') ? client.slack_channel_link : ''
  const driveFolderUrl = /^https?:\/\//i.test(client.drive_folder_link || '') ? client.drive_folder_link : ''
  const searchDossier = (event) => {
    event.preventDefault()
    const query = normalizeSearch(dossierSearch.trim())
    if (!query) return
    const matchIndex = sections.findIndex((section) => normalizeSearch([
      section.title,
      ...section.fields.flatMap(([label, key]) => [label, key, client[key]]),
    ].join(' ')).includes(query))
    if (matchIndex < 0) {
      setError(`No encontramos “${dossierSearch.trim()}” en este dossier.`)
      setHighlightedSection(null)
      return
    }
    setError(''); setMessage(`Resultado encontrado en ${sections[matchIndex].title}.`); setHighlightedSection(matchIndex)
    document.getElementById(`dossier-section-${matchIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => setHighlightedSection((current) => current === matchIndex ? null : current), 2200)
  }

  return <div className="page-stack">
    <Link className="back-link" to="/clientes">← Todos los clientes</Link>
    <header className="page-header client-detail-header"><div><p className="eyebrow">{client.code} · Active Client Dossier</p><h2>{client.business_name}</h2><p className="muted">{client.phase}</p></div><div className="header-actions dossier-actions"><span className={`lifecycle large-pill ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span>{slackChannelUrl && <a className="secondary-button slack-channel-button" href={slackChannelUrl} target="_blank" rel="noreferrer">Abrir Slack ↗</a>}{driveFolderUrl && <a className="secondary-button drive-folder-button" href={driveFolderUrl} target="_blank" rel="noreferrer">Abrir Drive ↗</a>}<button className="secondary-button" type="button" onClick={copyForGoogleDocs}>Copiar para Google Docs</button><button className="secondary-button" type="button" onClick={downloadPdf}>Descargar WWWW PDF</button>{client.google_docs_url && <a className="secondary-button" href={client.google_docs_url} target="_blank" rel="noreferrer">Abrir Google Docs ↗</a>}{canEdit && <button className="secondary-button" type="button" disabled={!client.google_docs_url} onClick={markDocsUpdated}>Marcar como actualizado</button>}</div></header>
    <form className="dossier-search" role="search" onSubmit={searchDossier}><label htmlFor="dossier-search-input">Buscar en este dossier</label><div><input id="dossier-search-input" type="search" value={dossierSearch} onChange={(event) => setDossierSearch(event.target.value)} placeholder="Ej. EIN, presupuesto, pixel, dominio…" /><button className="secondary-button" type="submit">Buscar</button></div></form>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    <section className={`content-card intake-status ${client.intake_form_completed ? 'complete' : 'pending'}`}><div><p className="eyebrow">Antes del dossier</p><h3>{client.intake_form_completed ? 'Formulario del cliente recibido' : 'Formulario del cliente pendiente'}</h3><p className="muted">{client.intake_form_completed_at ? `Marcado el ${new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.intake_form_completed_at))}` : 'Confirma este paso antes de completar accesos y datos del WWWW.'}</p></div>{canEdit && <button className={client.intake_form_completed ? 'secondary-button' : 'primary-button compact-button'} type="button" disabled={saving} onClick={toggleIntakeForm}>{client.intake_form_completed ? 'Marcar pendiente' : 'Marcar formulario recibido'}</button>}</section>
    <section className="metric-grid compact"><article className="metric-card blue"><span>Gasto</span><strong>${client.spend}</strong><small>registrado</small></article><article className="metric-card green"><span>Leads</span><strong>{client.leads}</strong><small>recibidos</small></article><article className="metric-card amber"><span>Citas</span><strong>{client.appointments}</strong><small>agendadas</small></article></section>
    <section className="content-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action}</h3></section>
    <section className={`content-card launch-deadline ${launchOverdue ? 'overdue' : ''}`}><div><p className="eyebrow">Deadline de lanzamiento ADS</p><h3>{client.target_launch_date || 'Sin fecha definida'}</h3></div><span>{client.status === 'ADS LIVE' ? 'Campaña activa' : launchOverdue ? 'Lanzamiento atrasado' : 'Pendiente de lanzamiento'}</span></section>
    <section className="content-card docs-sync-status"><div><span>Última copia</span><strong>{client.dossier_copied_at ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.dossier_copied_at)) : 'Todavía no se ha copiado'}</strong></div><div><span>Google Docs actualizado</span><strong>{client.google_docs_updated_at ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.google_docs_updated_at)) : 'Pendiente'}</strong></div></section>
    <section className="content-card missing-dossier-card"><p className="eyebrow">Falta en el dossier</p>{missingFields.length ? <div className="missing-chips">{missingFields.map((label) => <span key={label}>{label}</span>)}</div> : <p className="complete-note">Dossier WWWW completo</p>}</section>
    <div className="print-dossier">
      <header className="print-only print-title"><p>{client.code} · TACTICAL PIPELINE</p><h1>{client.business_name}</h1><span>{client.status} · {client.phase}</span></header>
      {sections.map((section, index) => {
        const editing = editingSection === index
        const sectionKeys = section.fields.map(([, key]) => key)
        const lastUpdate = auditLog.find((entry) => entry.changed_fields?.some((field) => sectionKeys.includes(field)))
        return <section className={`content-card dossier-section ${highlightedSection === index ? 'search-highlight' : ''}`} id={`dossier-section-${index}`} key={section.title}>
          <div className="section-heading dossier-section-heading"><p className="eyebrow">{section.title}</p><div className="section-actions">{editing ? <><button className="secondary-button" type="button" onClick={cancelEditing}>Cancelar</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={() => saveSection(section, index)}>{saving ? 'Guardando…' : 'Guardar'}</button></> : canEdit && <button className="secondary-button" type="button" disabled={editingSection != null} onClick={() => startEditing(index)}>Editar</button>}</div></div>
          <div className="detail-grid">{section.fields.map(([label, key, type]) => <div className="detail-item" key={key}><span>{label}</span>{editing ? (type === 'boolean' ? <select value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => setField(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select> : type === 'status' ? <select value={draft[key]} onChange={(event) => setField(key, event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select> : <input type={type || 'text'} value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />) : (type === 'url' && client[key] ? <a href={client[key]} target="_blank" rel="noreferrer">Abrir enlace ↗</a> : <strong>{displayValue(client[key], type)}</strong>)}</div>)}</div>
          <small className="section-updated">{lastUpdate ? `Actualizado por ${lastUpdate.actor_name} · ${new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastUpdate.created_at))}` : 'Sin actualizaciones registradas'}</small>
        </section>
      })}
    </div>

    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Operational Task Log</p><h3>Proceso asignado por rol</h3></div><span className="muted">{workflowSteps.filter((item) => item.completed).length} de {workflowSteps.length} visibles completados</span></div><div className="workflow-list">{workflowSteps.map((step) => <label className={`workflow-step ${step.completed ? 'completed' : ''}`} key={step.id}><input type="checkbox" checked={step.completed} onChange={() => toggleStep(step)} /><span className="workflow-order">{String(step.sort_order).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{step.owner_name}</small></div></label>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Notas del cliente</p><h3>Contexto compartido</h3></div><span className="muted">{notes.length} nota{notes.length === 1 ? '' : 's'}</span></div><div className="note-list">{notes.length === 0 && <p className="muted">Kevin todavía no ha agregado notas para este cliente.</p>}{notes.map((note) => <article className="note-card" key={note.id}><strong>{note.title}</strong>{note.body && <p>{note.body}</p>}<small>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small></article>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div><span className="muted">Últimos {auditLog.length}</span></div><div className="audit-list">{auditLog.length === 0 && <p className="muted">Aún no hay cambios registrados.</p>}{auditLog.map((entry) => <article className="audit-row" key={entry.id}><span className={`audit-badge ${entry.actor_role}`}>{entry.actor_name}</span><div><strong>{entry.action === 'dossier_updated' ? 'Actualizó el dossier' : entry.summary}</strong>{entry.action === 'dossier_updated' && <p>{entry.changed_fields.map((field) => fieldLabels[field] || field).join(', ')}</p>}<small>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</small></div></article>)}</div></section>
    <div className="dashboard-grid"><section className="content-card"><p className="eyebrow">Tareas adicionales</p><h3>{tasks.length} visibles</h3>{tasks.slice(0, 8).map((task) => <div className="mini-row" key={task.id}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong>{task.evidence && <p className="task-detail">{task.evidence}</p>}<small>{task.status} · {task.owner_name}</small></div></div>)}</section><section className="content-card"><p className="eyebrow">Bloqueos</p><h3>{blockers.filter((item) => !item.resolved).length} abiertos</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section></div>
  </div>
}
