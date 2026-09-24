import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import AdsReportsPanel from '../components/AdsReportsPanel'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { buildDossierText, copyDossier, downloadDossierPdf } from '../lib/dossierExport'
import { createClientNote, loadClient, markGoogleDocsUpdated, recordDossierEvent, revealClientMetaToken, saveClientMetaToken, updateClient, updateWorkflowStep } from '../services/opsService'

const sections = [
  { title: 'Quién · Perfil comercial', fields: [
    ['Nombre comercial · formulario', 'business_name'], ['Nombre legal del negocio · formulario', 'legal_name'], ['Nombre completo de contacto · formulario', 'owner_name'], ['Teléfono de negocio · formulario', 'phone'], ['Correo de negocio · formulario', 'email', 'email'],
    ['Dirección física', 'address'], ['EIN / información legal · formulario', 'legal_business_info'], ['Notas adicionales del formulario', 'onboarding_form_notes'], ['Estado Persona / KYC', 'kyc_status'],
  ] },
  { title: 'Qué · Oferta y objetivos', fields: [
    ['Servicios ofrecidos · formulario', 'services'], ['Ofertas o descuentos · formulario', 'offer'], ['KPI mensual objetivo', 'kpi'],
    ['Gasto diario objetivo', 'daily_budget', 'number'], ['Proyecto mínimo objetivo', 'minimum_project', 'number'],
    ['Tipo de proyecto', 'project_type'], ['Perfil del cliente objetivo', 'ideal_customer_profile'],
  ] },
  { title: 'Dónde · Mercado', fields: [
    ['Áreas de servicio · ciudades / ZIP · formulario', 'markets'], ['ZIP objetivo / Radio', 'target_zip_codes'], ['Ubicaciones excluidas', 'exclusions'], ['Zona horaria', 'timezone'],
  ] },
  { title: 'Infraestructura', fields: [
    ['¿Necesita sitio web o funnel?', 'needs_website_funnel', 'boolean'], ['Dominio existente', 'domain'],
    ['Sitio web · formulario', 'website_url', 'url'], ['Estado de Google Business Profile', 'gbp_status'], ['Enlace GBP existente', 'gbp_link', 'url'],
    ['Activos de marca / Drive · formulario', 'available_assets'],
  ] },
  { title: 'Cuándo · Cronología', fields: [
    ['Fecha de onboarding', 'onboarding_date', 'date'], ['Fecha objetivo de lanzamiento', 'target_launch_date', 'date'],
    ['Estado actual del ciclo', 'status', 'status'],
  ] },
  { title: 'Enlaces y accesos', fields: [
    ['Subcuenta / Acceso GoHighLevel', 'ghl_subaccount_link'], ['Carpeta de recursos en Google Drive', 'drive_folder_link', 'url'],
    ['Dossier en Google Docs', 'google_docs_url', 'url'], ['Página de Facebook', 'facebook_page_url', 'url'], ['Cuenta de Instagram', 'instagram_url', 'url'],
    ['ID de Meta Business Portfolio', 'meta_business_portfolio_id'], ['ID de cuenta publicitaria Meta', 'meta_ad_account_id'], ['ID de Pixel / Dataset Meta', 'meta_pixel_id'],
    ['Página de aterrizaje', 'landing_page_url', 'url'], ['Notas de Facebook y Business Manager', 'facebook_business_info'], ['Notas de recursos Meta', 'meta_assets_info'],
    ['ID del agente Retell AI', 'retell_agent_id'], ['Carpeta de escenarios Make.com', 'make_scenario_link', 'url'], ['Canal de Slack', 'slack_channel_link', 'url'],
  ] },
  { title: 'Estrategia publicitaria', fields: [
    ['Estrategia publicitaria activa', 'ad_strategy'], ['Estado Meta', 'meta_status'], ['Presupuesto diario', 'daily_budget', 'number'],
  ] },
  { title: 'Registro operativo', fields: [
    ['Fase operativa', 'phase'], ['Siguiente acción', 'next_action'], ['Estado GHL', 'ghl_status'], ['Estado A2P', 'a2p_status'],
  ] },
  { title: 'Estado de finalización', fields: [
    ['Onboarding completado', 'onboarding_completed', 'boolean'], ['Acceso GHL confirmado', 'ghl_access_confirmed', 'boolean'],
    ['Acceso Facebook confirmado', 'facebook_access_confirmed', 'boolean'], ['Acceso a cuenta publicitaria confirmado', 'ad_account_access_confirmed', 'boolean'],
    ['Acceso al pixel confirmado', 'pixel_access_confirmed', 'boolean'], ['Acceso al dominio confirmado', 'domain_access_confirmed', 'boolean'],
    ['Método de pago confirmado', 'payment_method_confirmed', 'boolean'], ['Persona / KYC completado', 'kyc_completed', 'boolean'],
    ['A2P enviado', 'a2p_submitted', 'boolean'], ['Funnel activo', 'funnel_live', 'boolean'], ['Campaña Meta activa', 'meta_campaign_live', 'boolean'],
  ] },
]
const fieldLabels = {
  ...Object.fromEntries(sections.flatMap((section) => section.fields.map(([label, key]) => [key, label]))),
  ads_pause_reason: 'Motivo de pausa ADS',
  ads_paused_at: 'Fecha de pausa ADS',
  ads_paused_by: 'Usuario que pausó ADS',
  archived: 'Cliente archivado',
  archive_reason: 'Motivo de archivo',
  archive_note: 'Nota de salida',
  archived_at: 'Fecha de archivo',
  archived_by: 'Usuario que archivó',
}
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
  const { locale, t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [editingSection, setEditingSection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [dossierSearch, setDossierSearch] = useState('')
  const [highlightedSection, setHighlightedSection] = useState(null)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [pauseReason, setPauseReason] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [archiveNote, setArchiveNote] = useState('')
  const [secretVisible, setSecretVisible] = useState(false)
  const [secretValue, setSecretValue] = useState('')
  const [secretLoading, setSecretLoading] = useState(false)
  const [secretEditing, setSecretEditing] = useState(false)
  const [secretDraft, setSecretDraft] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const tabs = [
    ['dossier', 'Dossier'],
    ['ads', 'Ads'],
    ['notes', 'Notas'],
    ['tasks', 'Tareas'],
    ['audit', 'Auditoría'],
  ]
  const requestedTab = searchParams.get('tab')
  const activeTab = tabs.some(([key]) => key === requestedTab) ? requestedTab : 'dossier'
  useEffect(() => {
    if (!requestedTab || !tabs.some(([key]) => key === requestedTab)) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'dossier')
      setSearchParams(next, { replace: true })
    }
  }, [requestedTab, searchParams, setSearchParams])
  const selectTab = (tab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next)
  }

  const refresh = async () => {
    const result = await loadClient(clientId)
    setData(result); setDraft(result.client)
  }
  useEffect(() => { refresh().catch((loadError) => setError(loadError.message)) }, [clientId])
  if (!data && !error) return <LoadingScreen />
  if (error && !data) return <div className="page-stack"><p className="form-error">{error}</p><Link to="/clientes">← Volver</Link></div>

  const { client, tasks, blockers, workflowSteps, auditLog, notes, adStatusEvents } = data
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
      setEditingSection(null); setMessage(`${t(section.title)} ${t('guardado correctamente.')}`)
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }
  const toggleStep = async (step) => {
    try { await updateWorkflowStep(step.id, !step.completed); await refresh() }
    catch (updateError) { setError(t(updateError.message)) }
  }
  const addClientNote = async (event) => {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      await createClientNote({ clientId, profileId: profile.id, title: noteTitle, body: noteBody })
      await refresh()
      setNoteTitle(''); setNoteBody('')
      setMessage(t('Nota agregada correctamente.'))
    } catch (noteError) { setError(t(noteError.message)) }
    finally { setSaving(false) }
  }

  const updatedBy = auditLog[0]?.actor_name || profile?.full_name || 'Pending'
  const canManageArchive = ['superadmin', 'user_admin'].includes(profile?.role) || Boolean(profile?.permissions?.operations_admin)
  const canCreateNotes = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const canViewSensitive = profile?.role === 'superadmin' || Boolean(profile?.permissions?.sensitive_credentials_view)
  const canManageSensitive = profile?.role === 'superadmin'
  const canEdit = Boolean(profile?.permissions?.clients_edit) && !client.archived
  const dossierText = buildDossierText(client, updatedBy)
  const copyForGoogleDocs = async () => {
    try {
      await copyDossier(dossierText)
      await recordDossierEvent(clientId, 'copied_google_docs', profile.id)
      setMessage('Dossier copied successfully')
      await refresh()
    } catch (copyError) { setError(t(copyError.message)) }
  }
  const downloadPdf = async () => {
    try {
      await downloadDossierPdf(client, dossierText)
      await recordDossierEvent(clientId, 'downloaded_pdf', profile.id)
      setMessage(t('PDF descargado correctamente.'))
    } catch (downloadError) { setError(t(downloadError.message)) }
  }
  const markDocsUpdated = async () => {
    try {
      await markGoogleDocsUpdated(clientId, profile.id)
      await refresh()
      setMessage(t('Google Docs marcado como actualizado.'))
    } catch (updateError) { setError(t(updateError.message)) }
  }
  const pauseAds = async (event) => {
    event.preventDefault()
    const reason = pauseReason.trim()
    if (!reason) { setError(t('Escribe el motivo de la pausa.')); return }
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, { status: 'ADS PAUSED', ads_pause_reason: reason })
      await refresh()
      setPauseOpen(false); setPauseReason('')
      setMessage(t('ADS pausados correctamente.'))
    } catch (pauseError) { setError(t(pauseError.message)) }
    finally { setSaving(false) }
  }
  const resumeAds = async () => {
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, { status: 'ADS LIVE' })
      await refresh()
      setMessage(t('ADS reactivados correctamente.'))
    } catch (resumeError) { setError(t(resumeError.message)) }
    finally { setSaving(false) }
  }
  const revealMetaToken = async () => {
    setSecretLoading(true); setError(''); setMessage('')
    try {
      const token = await revealClientMetaToken(clientId)
      setSecretValue(token); setSecretVisible(true)
    } catch (secretError) { setError(t(secretError.message)) }
    finally { setSecretLoading(false) }
  }
  const hideMetaToken = () => {
    setSecretVisible(false); setSecretValue('')
  }
  const copyMetaToken = async () => {
    try {
      await navigator.clipboard.writeText(secretValue)
      setMessage(t('Access Token copiado de forma segura.'))
    } catch { setError(t('No se pudo copiar el token. Selecciónalo manualmente.')) }
  }
  const saveMetaToken = async (event) => {
    event.preventDefault()
    if (!secretDraft.trim()) { setError(t('El Access Token no puede estar vacío.')); return }
    setSecretLoading(true); setError(''); setMessage('')
    try {
      await saveClientMetaToken(clientId, secretDraft)
      setSecretValue(''); setSecretVisible(false); setSecretDraft(''); setSecretEditing(false)
      setMessage(t('Access Token actualizado y protegido.'))
    } catch (secretError) { setError(t(secretError.message)) }
    finally { setSecretLoading(false) }
  }
  const archiveClient = async (event) => {
    event.preventDefault()
    if (!archiveReason.trim()) { setError(t('Selecciona el motivo de salida.')); return }
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, { archived: true, archive_reason: archiveReason, archive_note: archiveNote })
      await refresh()
      setArchiveOpen(false); setArchiveReason(''); setArchiveNote('')
      setMessage(t('Cliente archivado correctamente.'))
    } catch (archiveError) { setError(t(archiveError.message)) }
    finally { setSaving(false) }
  }
  const restoreClient = async () => {
    if (!window.confirm(t('¿Restaurar este cliente a la operación activa?'))) return
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, { archived: false })
      await refresh()
      setMessage(t('Cliente restaurado a la operación activa.'))
    } catch (restoreError) { setError(t(restoreError.message)) }
    finally { setSaving(false) }
  }
  const launchDate = client.target_launch_date ? new Date(`${client.target_launch_date}T23:59:59`) : null
  const launchOverdue = launchDate && !['ADS LIVE', 'ADS PAUSED'].includes(client.status) && launchDate < new Date()
  const slackChannelUrl = /^https?:\/\//i.test(client.slack_channel_link || '') ? client.slack_channel_link : ''
  const driveFolderUrl = /^https?:\/\//i.test(client.drive_folder_link || '') ? client.drive_folder_link : ''
  const searchDossier = (event) => {
    event.preventDefault()
    const rawQuery = normalizeSearch(dossierSearch.trim())
    if (!rawQuery) return
    const query = rawQuery === 'gpb' ? 'gbp' : rawQuery
    const terms = query.split(/\\s+/).filter(Boolean)
    const matchIndex = sections.findIndex((section) => {
      const searchable = normalizeSearch([
        section.title,
        ...section.fields.flatMap(([label, key]) => [label, key, client[key]]),
      ].join(' '))
      return terms.every((term) => searchable.includes(term))
    })
    if (matchIndex < 0) {
      setError(t(`No encontramos “${dossierSearch.trim()}” en este dossier.`))
      setHighlightedSection(null)
      return
    }
    setError(''); setMessage(t(`Resultado encontrado en ${sections[matchIndex].title}.`)); setHighlightedSection(matchIndex)
    const targetSection = document.getElementById(`dossier-section-${matchIndex}`)
    const stickyHeight = document.querySelector('.client-sticky-shell')?.getBoundingClientRect().height || 0
    if (targetSection) window.scrollTo({ top: window.scrollY + targetSection.getBoundingClientRect().top - stickyHeight - 16, behavior: 'smooth' })
    window.setTimeout(() => setHighlightedSection((current) => current === matchIndex ? null : current), 2200)
  }

  return <div className="page-stack client-dossier-page" data-client-tab={activeTab}>
    <Link className="back-link" to={client.archived ? '/clientes?vista=archivados' : '/clientes'}>← {t(client.archived ? 'Clientes archivados' : 'Todos los clientes')}</Link>
    <div className="client-sticky-shell">
    <header className="page-header client-detail-header"><div><p className="eyebrow">{client.code} · {client.archived ? t('Cliente archivado') : t('Cliente activo')}</p><h2>{client.business_name}</h2><p className="muted">{client.phase}</p></div><div className="header-actions dossier-actions"><span className={`lifecycle large-pill ${client.archived ? 'archived' : client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.archived ? t('ARCHIVADO') : t(client.status)}</span>{canManageArchive && !client.archived && <button className="secondary-button archive-client-button" type="button" disabled={saving} onClick={() => { setArchiveOpen(true); setError(''); setMessage('') }}>{t('Archivar cliente')}</button>}{canManageArchive && client.archived && <button className="primary-button compact-button" type="button" disabled={saving} onClick={restoreClient}>{saving ? 'Restaurando…' : t('Restaurar cliente')}</button>}{canEdit && client.status === 'ADS LIVE' && <button className="danger-button" type="button" disabled={saving} onClick={() => { setPauseOpen(true); setError(''); setMessage('') }}>{t('Pausar ADS')}</button>}{canEdit && client.status === 'ADS PAUSED' && <button className="primary-button compact-button" type="button" disabled={saving} onClick={resumeAds}>{saving ? 'Reactivando…' : 'Reactivar ADS'}</button>}{slackChannelUrl && <a className="secondary-button slack-channel-button" href={slackChannelUrl} target="_blank" rel="noreferrer">{t('Abrir Slack')} ↗</a>}{driveFolderUrl && <a className="secondary-button drive-folder-button" href={driveFolderUrl} target="_blank" rel="noreferrer">{t('Abrir Drive')} ↗</a>}<button className="secondary-button" type="button" onClick={copyForGoogleDocs}>{t('Copiar para Google Docs')}</button><button className="secondary-button" type="button" onClick={downloadPdf}>{t('Descargar WWWW PDF')}</button>{client.google_docs_url && <a className="secondary-button" href={client.google_docs_url} target="_blank" rel="noreferrer">{t('Abrir Google Docs')} ↗</a>}{canEdit && <button className="secondary-button" type="button" disabled={!client.google_docs_url} onClick={markDocsUpdated}>{t('Marcar como actualizado')}</button>}</div></header>
    <nav className="client-detail-tabs" aria-label={t('Secciones del cliente')}>{tabs.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? 'active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => selectTab(key)}>{t(label)}</button>)}</nav>
    <form className="dossier-search compact-sticky-search client-tab-section tab-dossier" role="search" onSubmit={searchDossier}><label htmlFor="dossier-search-input">Buscar en este dossier</label><div><input id="dossier-search-input" type="search" value={dossierSearch} onChange={(event) => setDossierSearch(event.target.value)} placeholder="Ej. EIN, presupuesto, pixel, dominio…" /><button className="secondary-button" type="submit">Buscar</button></div></form>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    {archiveOpen && <form className="content-card client-archive-form client-tab-section tab-dossier" onSubmit={archiveClient}><div><p className="eyebrow">Salida de la operación</p><h3>Archivar cliente</h3><p className="muted">El dossier y el historial se conservarán fuera de los clientes activos.</p></div><label>Motivo<select value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} required><option value="">Seleccionar…</option><option>Contrato finalizado</option><option>Cancelación del cliente</option><option>Falta de pago</option><option>Campaña terminada</option><option>Otro</option></select></label><label>Nota final opcional<textarea rows="4" maxLength="2000" value={archiveNote} onChange={(event) => setArchiveNote(event.target.value)} placeholder="Contexto de la salida, pendientes o condiciones para regresar…" /></label><div className="section-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => { setArchiveOpen(false); setArchiveReason(''); setArchiveNote('') }}>Cancelar</button><button className="danger-button" disabled={saving}>{saving ? 'Archivando…' : 'Confirmar archivo'}</button></div></form>}
    {client.archived && <section className="content-card client-archive-summary client-tab-section tab-dossier"><div><p className="eyebrow">Cliente archivado</p><h3 data-no-translate>{client.archive_reason}</h3>{client.archive_note && <p data-no-translate>{client.archive_note}</p>}<small>{client.archived_at ? t(`Archivado el ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.archived_at))}`) : ''}</small></div>{canManageArchive && <button className="primary-button compact-button" type="button" disabled={saving} onClick={restoreClient}>{saving ? 'Restaurando…' : t('Restaurar cliente')}</button>}</section>}
    {pauseOpen && <form className="content-card ads-pause-form client-tab-section tab-ads" onSubmit={pauseAds}><div><p className="eyebrow">Pausar campaña</p><h3>¿Por qué se pausarán los ADS?</h3><p className="muted">El motivo quedará visible en el cliente y en el historial.</p></div><label>Motivo de pausa<textarea rows="4" maxLength="2000" value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="Ej. CPL alto, método de pago rechazado o esperando aprobación del cliente…" required /></label><div className="section-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => { setPauseOpen(false); setPauseReason('') }}>Cancelar</button><button className="danger-button" disabled={saving}>{saving ? 'Pausando…' : 'Confirmar pausa'}</button></div></form>}
    <div className="client-tab-section tab-dossier">
      <section className="metric-grid compact"><article className="metric-card blue"><span>Gasto</span><strong>{'$'}{client.spend}</strong><small>registrado</small></article><article className="metric-card green"><span>Leads</span><strong>{client.leads}</strong><small>recibidos</small></article><article className="metric-card amber"><span>Citas</span><strong>{client.appointments}</strong><small>agendadas</small></article></section>
    </div>
    <div className="client-ops-summary-grid client-tab-section tab-dossier">
      <section className="content-card compact-summary-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action || 'Sin acción'}</h3></section>
      <section className={`content-card launch-deadline compact-summary-card ${launchOverdue ? 'overdue' : ''}`}><div><p className="eyebrow">Deadline de lanzamiento ADS</p><h3>{client.target_launch_date || 'Sin fecha definida'}</h3></div><span>{client.status === 'ADS LIVE' ? 'Campaña activa' : client.status === 'ADS PAUSED' ? 'Campaña pausada' : launchOverdue ? 'Lanzamiento atrasado' : 'Pendiente de lanzamiento'}</span></section>
      <section className="content-card docs-sync-status compact-summary-card compact-last-copy-card"><div><span>Última copia</span><strong>{client.dossier_copied_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.dossier_copied_at)) : 'Todavía no se ha copiado'}</strong></div><div><span>Google Docs actualizado</span><strong>{client.google_docs_updated_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.google_docs_updated_at)) : 'Pendiente'}</strong></div></section>
    </div>
    {client.status === 'ADS PAUSED' && <section className="content-card ads-pause-summary client-tab-section tab-ads"><div><p className="eyebrow">ADS PAUSED</p><h3>Campaña pausada</h3><p data-no-translate>{client.ads_pause_reason}</p><small>{client.ads_paused_at ? t(`Pausada el ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.ads_paused_at))}`) : ''}</small></div>{canEdit && <button className="primary-button compact-button" type="button" disabled={saving} onClick={resumeAds}>{saving ? 'Reactivando…' : 'Reactivar ADS'}</button>}</section>}
    {adStatusEvents.length > 0 && <section className="content-card client-tab-section tab-ads"><div className="section-heading"><div><p className="eyebrow">Historial ADS</p><h3>Pausas y reactivaciones</h3></div><span className="muted">{adStatusEvents.length} eventos</span></div><div className="ads-status-history">{adStatusEvents.map((event) => <article key={event.id}><span className={`lifecycle ${event.event_type === 'paused' ? 'ads-paused' : 'ads-live'}`}>{event.event_type === 'paused' ? 'PAUSADO' : 'REACTIVADO'}</span><div><strong>{event.event_type === 'paused' ? 'Pausó la campaña' : 'Reactivó la campaña'}</strong><p data-no-translate>{event.note}</p><small><span data-no-translate>{event.actor_name}</span> · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</small></div></article>)}</div></section>}
    <div className="client-tab-section tab-ads"><AdsReportsPanel client={client} canEdit={canEdit} /></div>
    <section className="content-card credential-vault client-tab-section tab-dossier"><div className="section-heading"><div><p className="eyebrow">Bóveda de credenciales</p><h3>Meta Access Token</h3><p className="muted">No se incluye en el dossier, PDF, Google Docs ni búsquedas.</p></div><span className="credential-state">Protegido</span></div>{!canViewSensitive ? <p className="credential-restricted">Acceso restringido. Kevin puede habilitar el permiso individual desde Usuarios.</p> : <div className="credential-controls">{!secretVisible ? <button className="secondary-button" type="button" disabled={secretLoading} onClick={revealMetaToken}>{secretLoading ? 'Verificando permiso…' : 'Mostrar token'}</button> : <><div className="credential-value"><span>Access Token</span><code>{secretValue || 'No hay token configurado'}</code></div><div className="section-actions"><button className="secondary-button" type="button" onClick={copyMetaToken} disabled={!secretValue}>Copiar</button><button className="text-button" type="button" onClick={hideMetaToken}>Ocultar</button></div></>}{canManageSensitive && !secretEditing && <button className="text-button" type="button" onClick={() => { hideMetaToken(); setSecretEditing(true); setSecretDraft('') }}>Actualizar token</button>}{canManageSensitive && secretEditing && <form className="credential-editor" onSubmit={saveMetaToken}><label>Nuevo Access Token<textarea rows="4" value={secretDraft} autoComplete="off" spellCheck="false" onChange={(event) => setSecretDraft(event.target.value)} placeholder="Pega aquí el token nuevo" required /></label><div className="section-actions"><button className="text-button" type="button" onClick={() => { setSecretEditing(false); setSecretDraft('') }}>Cancelar</button><button className="primary-button compact-button" disabled={secretLoading}>{secretLoading ? 'Guardando…' : 'Guardar protegido'}</button></div></form>}</div>}</section>
    <section className="content-card missing-dossier-card client-tab-section tab-dossier"><p className="eyebrow">Falta en el dossier</p>{missingFields.length ? <div className="missing-chips">{missingFields.map((label) => <span key={label}>{label}</span>)}</div> : <p className="complete-note">Dossier WWWW completo</p>}</section>
    <div className="print-dossier client-tab-section tab-dossier">
      <header className="print-only print-title"><p>{client.code} · TACTICAL PIPELINE</p><h1>{client.business_name}</h1><span>{client.status} · {client.phase}</span></header>
      {sections.map((section, index) => {
        const editing = editingSection === index
        const sectionKeys = section.fields.map(([, key]) => key)
        const lastUpdate = auditLog.find((entry) => entry.changed_fields?.some((field) => sectionKeys.includes(field)))
        return <section className={`content-card dossier-section ${highlightedSection === index ? 'search-highlight' : ''}`} id={`dossier-section-${index}`} key={section.title}>
          <div className="section-heading dossier-section-heading"><p className="eyebrow">{section.title}</p><div className="section-actions">{editing ? <><button className="secondary-button" type="button" onClick={cancelEditing}>Cancelar</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={() => saveSection(section, index)}>{saving ? 'Guardando…' : 'Guardar'}</button></> : canEdit && <button className="secondary-button" type="button" disabled={editingSection != null} onClick={() => startEditing(index)}>Editar</button>}</div></div>
          <div className="detail-grid">{section.fields.map(([label, key, type]) => <div className="detail-item" key={key}><span>{label}</span>{editing ? (type === 'boolean' ? <select value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => setField(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select> : type === 'status' ? <select value={draft[key]} onChange={(event) => setField(key, event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option><option disabled>ADS PAUSED</option></select> : <input type={type || 'text'} value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />) : (type === 'url' && client[key] ? <a href={client[key]} target="_blank" rel="noreferrer">Abrir enlace ↗</a> : <strong>{displayValue(client[key], type)}</strong>)}</div>)}</div>
          <small className="section-updated">{lastUpdate ? t(`Actualizado por ${lastUpdate.actor_name} · ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastUpdate.created_at))}`) : 'Sin actualizaciones registradas'}</small>
        </section>
      })}
    </div>

    <section className="content-card client-tab-section tab-notes">
      <div className="section-heading"><div><p className="eyebrow">{t('Notas del cliente')}</p><h3>{t('Contexto compartido')}</h3></div><span className="muted">{notes.length} {t('notas')}</span></div>
      {canCreateNotes && <form className="client-note-form" onSubmit={addClientNote}>
        <label>{t('Título de la nota')}<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength="160" required /></label>
        <label>{t('Contenido')}<textarea rows="3" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength="5000" placeholder={t('Escribe una nota específica para este cliente…')} /></label>
        <button className="primary-button compact-button" disabled={saving || !noteTitle.trim()}>{saving ? t('Guardando…') : t('Agregar nota')}</button>
      </form>}
      <div className="note-list">{notes.length === 0 && <p className="muted">{t('Aún no hay notas para este cliente.')}</p>}{notes.map((note) => <article className="note-card" key={note.id}><strong data-no-translate>{note.title}</strong>{note.body && <p data-no-translate>{note.body}</p>}<small>{note.author?.full_name || t('Usuario')} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small></article>)}</div>
    </section>
    <section className="content-card client-tab-section tab-audit"><div className="section-heading"><div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div><span className="muted">Últimos {auditLog.length}</span></div><div className="audit-list">{auditLog.length === 0 && <p className="muted">Aún no hay cambios registrados.</p>}{auditLog.map((entry) => <article className="audit-row" key={entry.id}><span className={`audit-badge ${entry.actor_role}`} data-no-translate>{entry.actor_name}</span><div><strong>{entry.action === 'dossier_updated' ? 'Actualizó el dossier' : entry.summary}</strong>{entry.action === 'dossier_updated' && <p>{entry.changed_fields.map((field) => t(fieldLabels[field] || field)).join(', ')}</p>}<small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</small></div></article>)}</div></section>
    <div className="client-tab-section tab-tasks client-task-groups">
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Tareas adicionales')}</p><h3>{t('Pendientes')} · {tasks.filter((task) => !['Completada', 'Completed'].includes(task.status)).length}</h3></div></div>
        {tasks.filter((task) => !['Completada', 'Completed'].includes(task.status)).length === 0 && <p className="muted">{t('No hay tareas pendientes.')}</p>}
        {tasks.filter((task) => !['Completada', 'Completed'].includes(task.status)).map((task) => <article className="client-task-row" key={task.id}><span className={`priority ${(task.priority || 'Media').toLowerCase()}`}>{t(task.priority || 'Media')}</span><div><strong>{task.title}</strong>{task.evidence && <p className="task-detail">{task.evidence}</p>}<small>{t(task.status)} · {task.owner_name || t('Sin responsable')} · {t('Fecha límite')}: {task.due_at || t('Sin fecha')}</small></div></article>)}
      </section>
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Historial')}</p><h3>{t('Completadas')} · {tasks.filter((task) => ['Completada', 'Completed'].includes(task.status)).length}</h3></div></div>
        {tasks.filter((task) => ['Completada', 'Completed'].includes(task.status)).length === 0 && <p className="muted">{t('No hay tareas completadas.')}</p>}
        {tasks.filter((task) => ['Completada', 'Completed'].includes(task.status)).map((task) => <article className="client-task-row completed" key={task.id}><span className={`priority ${(task.priority || 'Media').toLowerCase()}`}>{t(task.priority || 'Media')}</span><div><strong>{task.title}</strong>{task.evidence && <p className="task-detail">{task.evidence}</p>}<small>{t(task.status)} · {task.owner_name || t('Sin responsable')} · {t('Fecha límite')}: {task.due_at || t('Sin fecha')}</small></div></article>)}
      </section>
      <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Proceso asignado por rol')}</p><h3>{workflowSteps.filter((item) => item.completed).length} {t('de')} {workflowSteps.length} {t('completadas')}</h3></div></div><div className="workflow-list">{workflowSteps.map((step) => <label className={`workflow-step ${step.completed ? 'completed' : ''}`} key={step.id}><input type="checkbox" checked={step.completed} disabled={client.archived} onChange={() => toggleStep(step)} /><span className="workflow-order">{String(step.sort_order).padStart(2, '0')}</span><div><strong>{step.title}</strong><small>{step.owner_name}</small></div></label>)}</div></section>
      <section className="content-card"><p className="eyebrow">{t('Bloqueos')}</p><h3>{blockers.filter((item) => !item.resolved).length} {t('abiertos')}</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section>
    </div>
  </div>
}
