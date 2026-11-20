import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import AdsReportsPanel from '../components/AdsReportsPanel'
import GhlMetricsPanel from '../components/GhlMetricsPanel'
import { NavIcon, usePageTrail } from '../components/navigation'
import ClientOpsPanel from '../components/ClientOpsPanel'
import StepEvidence from '../components/StepEvidence'
import ClientLog from '../components/ClientLog'
import ClientTickets from '../components/ClientTickets'
import DossierSuggestions from '../components/DossierSuggestions'
import GhlLoginVault from '../components/GhlLoginVault'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { buildDossierText, copyDossier, downloadDossierPdf } from '../lib/dossierExport'
import { createClientNote, deleteArchivedClient, deleteClientNote, loadClient, markGoogleDocsUpdated, recordDossierEvent, revealClientMetaToken, saveClientMetaToken, updateClient, reassignClientCode, updateClientNote, updateWorkflowStep, loadStepEvidence } from '../services/opsService'
import LinkifiedText from '../components/LinkifiedText'

// Dossier sections follow the GHL Client Onboarding Form, then what is confirmed on the
// onboarding call, then each platform. Field tuple: [label, key, type, source, optional].
// source: 'form' = Client Onboarding Form, 'call' = onboarding call, 'setup' = filled by TP Ops.
// Platform sections list the Trello checklist steps that prove the platform is ready.
const sections = [
  { title: 'Negocio y contacto', fields: [
    ['Nombre legal registrado', 'legal_name', null, 'form'], ['Nombre comercial', 'business_name', null, 'call'],
    ['Nombre del contacto', 'owner_name', null, 'form'], ['Teléfono del contacto', 'contact_phone', null, 'form'], ['Correo del contacto', 'contact_email', 'email', 'form'],
    ['Teléfono del negocio', 'phone', null, 'form'], ['Correo del negocio', 'email', 'email', 'form'], ['Dirección del negocio', 'address', null, 'form'],
    ['Zona horaria', 'timezone', null, 'form'], ['Idioma para la llamada de onboarding', 'onboarding_call_language', null, 'form'],
    ['Horario y disponibilidad', 'appointment_availability', 'long', 'form'], ['EIN / información legal', 'legal_business_info', null, 'call'],
  ] },
  { title: 'Oferta y mercado', fields: [
    ['Servicios', 'services', 'long', 'form'], ['Ofertas o descuentos', 'offer', 'long', 'form'], ['Rango de precio / proyecto mínimo', 'minimum_project', 'number', 'form'],
    ['Cliente ideal', 'ideal_customer_profile', 'long', 'call'],
  ] },
  // Where the ads point. The business address lives in "Negocio y contacto"; here only targeting.
  { title: 'Segmentación de anuncios', fields: [
    ['Dirección central de los anuncios', 'ads_targeting_address', null, 'form'], ['Radio de segmentación (millas)', 'targeting_radius_miles', 'radius', 'form'],
    ['Ciudades y áreas de servicio', 'markets', 'long', 'form'], ['Códigos ZIP objetivo', 'target_zip_codes', 'long', 'form', true], ['Zonas excluidas', 'exclusions', 'long', 'call', true],
  ] },
  { title: 'Estrategia y lanzamiento', fields: [
    ['Estrategia publicitaria', 'ad_strategy', 'long', 'call'], ['Presupuesto diario', 'daily_budget', 'number', 'call'], ['KPI mensual objetivo', 'kpi', null, 'call'],
    ['Fecha de onboarding', 'onboarding_date', 'date', 'setup'], ['Fecha objetivo de lanzamiento', 'target_launch_date', 'date', 'setup'],
    ['Estado del cliente', 'status', 'status', 'setup'], ['Siguiente acción', 'next_action', 'long', 'setup'],
  ] },
  { title: 'Campañas (Media Buyer)', fields: [
    ['Nombre de la cuenta publicitaria', 'ad_account_name', null, 'setup'], ['Ubicación de conversión', 'conversion_location', 'choice:Instant Form|Landing page', 'setup'],
    ['Nombre del Instant Form', 'instant_form_name', null, 'setup', true], ['Creativos de anuncios', 'ad_creatives_link', 'url', 'setup'],
    ['Calendario de citas', 'booking_calendar_link', 'url', 'setup'], ['Resultado de la campaña', 'ad_result_status', 'choice:Bad|Good|Excellent', 'setup', true],
  ] },
  { title: 'GoHighLevel', steps: ['ghl_a2p_account', 'ghl_personalized', 'ghl_client_login', 'leadconnector_app', 'ghl_payment'], fields: [
    ['Subcuenta de GoHighLevel', 'ghl_subaccount_link', null, 'setup'],
  ] },
  { title: 'Meta (Facebook e Instagram)', steps: ['facebook_2fa', 'business_portfolio', 'facebook_page', 'ad_account', 'meta_payment', 'portfolio_partner', 'meta_access', 'pixel'], fields: [
    ['Página de Facebook', 'facebook_page_url', 'url', 'form'], ['ID de Business Portfolio', 'meta_business_portfolio_id', null, 'setup'],
    ['ID de cuenta publicitaria', 'meta_ad_account_id', null, 'setup'], ['ID de Pixel / Dataset', 'meta_pixel_id', null, 'setup'],
    ['Cuenta de Instagram', 'instagram_url', 'url', 'setup', true], ['Notas de Meta', 'facebook_business_info', 'long', 'setup', true],
  ] },
  { title: 'Google Business Profile', steps: ['gbp_access', 'gbp_optimize'], fields: [
    ['Correo de Google Business Profile', 'gbp_email', 'email', 'form'], ['Enlace de Google Business Profile', 'gbp_link', 'url', 'setup'],
    ['Estado de Google Business Profile', 'gbp_status', null, 'setup', true],
  ] },
  { title: 'Sitio web y landing', steps: ['domain_ready', 'landing_page', 'lp_big5_ready', 'ai_website'], fields: [
    ['Sitio web actual', 'website_url', 'url', 'form'], ['¿Pidió sitio web incluido?', 'needs_website_funnel', 'boolean', 'form'],
    ['Detalle del sitio solicitado', 'website_build_request', 'long', 'form', true], ['Dominio', 'domain', null, 'setup'], ['Landing page', 'landing_page_url', 'url', 'setup'],
  ] },
  { title: 'Archivos y automatizaciones', steps: ['drive_folder', 'media_request', 'work_media', 'selfie_broll', 'make_retell', 'big5_pipeline'], fields: [
    ['Carpeta de Google Drive', 'drive_folder_link', 'url', 'setup'], ['Activos de marca y medios', 'available_assets', 'long', 'setup'],
    ['Canal de Slack', 'slack_channel_link', 'url', 'setup'], ['Dossier en Google Docs', 'google_docs_url', 'url', 'setup', true],
    ['ID del agente Retell AI', 'retell_agent_id', null, 'setup', true], ['Escenarios de Make.com', 'make_scenario_link', 'url', 'setup', true],
  ] },
]
const fieldSources = { form: 'Formulario del cliente', call: 'Llamada de onboarding', setup: 'Gestionado por TP Ops' }
const checklistPhases = [
  ['prep', 'Venta y preparación'], ['call', 'Llamada de onboarding'], ['build', 'Montaje'], ['launch', 'QA y lanzamiento'], ['post', 'Post-lanzamiento'],
]
// Labels for fields that are no longer shown, so older audit entries stay readable.
const retiredFieldLabels = {
  kyc_status: 'Estado Persona / KYC', project_type: 'Tipo de proyecto', timezone_verified: '¿Zona horaria del negocio verificada?',
  website_timeline: 'Tiempo estimado del sitio web', instagram_needed: '¿Necesita cuenta de Instagram?', meta_assets_info: 'Notas de recursos Meta',
  meta_status: 'Estado Meta', phase: 'Fase operativa', ghl_status: 'Estado GHL', a2p_status: 'Estado A2P',
  onboarding_completed: 'Onboarding completado', facebook_access_confirmed: 'Acceso Facebook confirmado', ad_account_access_confirmed: 'Acceso a cuenta publicitaria confirmado',
  pixel_access_confirmed: 'Acceso al pixel confirmado', domain_access_confirmed: 'Acceso al dominio confirmado', kyc_completed: 'Persona / KYC completado',
  a2p_submitted: 'A2P enviado', funnel_live: 'Funnel activo', meta_campaign_live: 'Campaña Meta activa',
}
const fieldLabels = {
  ...retiredFieldLabels,
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
const isMissing = (value, type) => type === 'boolean' ? value == null : type === 'number' || type === 'radius' ? value == null || value === '' || Number(value) <= 0 : value == null || value === '' || /pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(value))
const displayValue = (value, type) => {
  if (type === 'boolean') return value == null ? 'Pendiente' : value ? 'Sí' : 'No'
  if (type === 'number' && value !== '' && value != null) return `$${value}`
  if (type === 'radius' && value !== '' && value != null) return `${value} mi`
  return value || 'Pendiente'
}
const normalizeSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const taskRoles = [
  ['onboarding_media', 'Onboarding & Media'],
  ['automation_funnels', 'Automations & Funnels'],
  ['user_admin', 'User Admin'],
  ['superadmin', 'Superadmin'],
]


export default function ClientDetailPage() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locale, t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [showPinnedClient, setShowPinnedClient] = useState(false)
  const clientHeaderRef = useRef(null)
  // True while a dossier section has unsaved edits; read by the browser's leave-page warning.
  const unsavedRef = useRef(false)
  useEffect(() => {
    const warn = (event) => { if (unsavedRef.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const [draft, setDraft] = useState(null)
  const [editingSection, setEditingSection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showAllWorkflowSteps, setShowAllWorkflowSteps] = useState(false)
  const [codeEditing, setCodeEditing] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
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
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [noteDraft, setNoteDraft] = useState({ title: '', body: '' })
  const tabs = [
    ['dossier', 'Dossier'],
    ['checklist', 'Checklist'],
    ['ads', 'Ads'],
    ['notes', 'Bitácora y notas'],
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
    if (tab !== activeTab && !confirmDiscard()) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next)
  }

  const refresh = async () => {
    const result = await loadClient(clientId)
    setData(result); setDraft(result.client)
  }
  // Checklist screenshots load apart so a storage hiccup never blocks the client page.
  const [stepEvidence, setStepEvidence] = useState([])
  const [evidencePromptStep, setEvidencePromptStep] = useState('')
  const refreshEvidence = async () => {
    try { setStepEvidence(await loadStepEvidence(clientId)) }
    catch (evidenceError) { console.warn('Step evidence unavailable', evidenceError) }
  }
  useEffect(() => { refresh().catch((loadError) => setError(loadError.message)) }, [clientId])
  useEffect(() => { refreshEvidence() }, [clientId])
  useEffect(() => {
    const header = clientHeaderRef.current
    if (!header || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setShowPinnedClient(!entry.isIntersecting), { threshold: 0 })
    observer.observe(header)
    return () => observer.disconnect()
  }, [data?.client?.id])
  // Location trail: Operación › Clientes › [Archivados ›] C4 Business › Ads
  const trailClient = data?.client
  const activeTabLabel = t(tabs.find(([key]) => key === activeTab)?.[1] || 'Dossier')
  usePageTrail(trailClient ? [
    ...(trailClient.archived ? [{ label: t('Archivados'), to: '/clientes?vista=archivados' }] : []),
    { label: `${trailClient.code} ${trailClient.business_name}`, to: `/clientes/${trailClient.id}?tab=dossier` },
    { label: activeTabLabel },
  ] : [])
  if (!data && !error) return <LoadingScreen />
  if (error && !data) return <div className="page-stack"><p className="form-error">{error}</p><Link to="/clientes">← Volver</Link></div>

  const { client, blockers, workflowSteps, auditLog, notes, adStatusEvents, directory = [] } = data
  const dossierFieldKeys = new Set(sections.flatMap((section) => section.fields.map(([, key]) => key)))
  const latestDossierAudit = auditLog.find((entry) => entry.changed_fields?.some((field) => dossierFieldKeys.has(field)))
  const dossierUpdatedAt = latestDossierAudit?.created_at || client.updated_at
  const dossierUpdatedBy = latestDossierAudit?.actor_name || profile?.full_name || 'Pending'
  const formatDossierDateTime = (value) => value ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(value)) : t('Pendiente')
  const comparable = (value) => value == null ? '' : String(value)
  const dirtyKeys = editingSection == null ? [] : sections[editingSection].fields
    .map(([, key]) => key).filter((key) => comparable(draft?.[key]) !== comparable(client[key]))
  unsavedRef.current = dirtyKeys.length > 0
  const confirmDiscard = () => {
    if (!dirtyKeys.length) { if (editingSection != null) cancelEditing(); return true }
    if (!window.confirm(t('Tienes cambios sin guardar en el dossier. ¿Descartarlos?'))) return false
    cancelEditing()
    return true
  }
  const sectionKeyDown = (event, section, index) => {
    if (event.key === 'Escape') { event.preventDefault(); confirmDiscard() }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveSection(section, index) }
  }
  const openMissingField = ({ key, index }) => {
    if (canEdit && editingSection !== index) {
      if (!confirmDiscard()) return
      startEditing(index)
    }
    window.requestAnimationFrame(() => {
      const field = document.getElementById(`dossier-field-${key}`)
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field?.querySelector('input, select, textarea')?.focus({ preventScroll: true })
    })
  }
  const stepTitle = (step) => (locale.startsWith('en') && step.title_en) ? step.title_en : step.title
  const stepByKey = new Map(workflowSteps.map((step) => [step.step_key, step]))
  const currentPhase = workflowSteps.find((step) => !step.completed)?.phase || null
  const visibleWorkflowSteps = showAllWorkflowSteps || !currentPhase ? workflowSteps : workflowSteps.filter((step) => step.phase === currentPhase)
  const workflowDone = workflowSteps.filter((step) => step.completed).length
  const isStepDone = (key) => Boolean(stepByKey.get(key)?.completed)
  const suggestedStatus = isStepDone('cruise_control') && client.status === 'ADS LIVE'
    ? 'CRUISE CONTROL'
    : isStepDone('launch_ads') && ['ONBOARDING', 'A2P SUBMITTED'].includes(client.status) ? 'ADS LIVE' : null

  const missingFields = sections.flatMap((section, index) => section.fields
    .filter(([, key, type, , optional]) => !optional && isMissing(client[key], type))
    .map(([label, key]) => ({ label, key, index })))
  const setField = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const startEditing = (index) => { setDraft(client); setEditingSection(index); setMessage(''); setError('') }
  const cancelEditing = () => { setDraft(client); setEditingSection(null) }
  const saveSection = async (section, index) => {
    // Only fields that actually changed are sent, so a section save never overwrites
    // what someone else changed in another field meanwhile.
    const changedFields = section.fields.filter(([, key]) => dirtyKeys.includes(key))
    if (!changedFields.length) { setEditingSection(null); setMessage(t('Sin cambios.')); return }
    setSaving(true); setError(''); setMessage('')
    try {
      const changes = Object.fromEntries(changedFields.map(([, key, type]) => {
        const value = draft[key]
        if (type === 'radius') return [key, value === '' || value == null ? null : Number(value)]
        if (type === 'number') return [key, value === '' || value == null ? 0 : Number(value)]
        return [key, value]
      }))
      await updateClient(clientId, changes)
      await refresh()
      setEditingSection(null); setMessage(`${t(section.title)} ${t('guardado correctamente.')}`)
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }
  const saveClientCode = async (event) => {
    event.preventDefault()
    const code = codeDraft.trim().toUpperCase()
    if (!code) { setError(t('Escribe un código para el cliente.')); return }
    if (code === client.code) { setCodeEditing(false); return }
    setSaving(true); setError(''); setMessage('')
    try {
      await reassignClientCode(clientId, code)
      await refresh()
      setCodeEditing(false)
      setMessage(t('Código de cliente actualizado correctamente.'))
    } catch (saveError) {
      setError(saveError.code === '23505'
        ? t('Ese código ya está asignado a otro cliente.')
        : t(saveError.message))
    } finally { setSaving(false) }
  }
  // Checking a step that needs a screenshot opens the upload box right away (it is not blocked).
  const toggleStep = async (step) => {
    try {
      await updateWorkflowStep(step.id, !step.completed)
      const hasEvidence = stepEvidence.some((item) => item.step_id === step.id)
      setEvidencePromptStep(!step.completed && step.evidence === 'required' && !hasEvidence ? step.id : '')
      await refresh()
    } catch (updateError) { setError(t(updateError.message)) }
  }
  const applySuggestedStatus = async () => {
    if (!suggestedStatus) return
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClient(clientId, { status: suggestedStatus })
      await refresh()
      setMessage(t(`Estado actualizado a ${suggestedStatus}.`))
    } catch (statusError) { setError(t(statusError.message)) }
    finally { setSaving(false) }
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

  const saveClientNote = async (event) => {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      await updateClientNote(editingNoteId, noteDraft)
      await refresh()
      setEditingNoteId(null); setNoteDraft({ title: '', body: '' })
      setMessage(t('Nota actualizada correctamente.'))
    } catch (noteError) { setError(t(noteError.message)) }
    finally { setSaving(false) }
  }
  const removeClientNote = async (noteId) => {
    if (!window.confirm(t('¿Eliminar esta nota?'))) return
    setSaving(true); setError(''); setMessage('')
    try {
      await deleteClientNote(noteId)
      await refresh()
      setMessage(t('Nota eliminada correctamente.'))
    } catch (noteError) { setError(t(noteError.message)) }
    finally { setSaving(false) }
  }


  const canManageArchive = ['superadmin', 'user_admin'].includes(profile?.role) || Boolean(profile?.permissions?.operations_admin)
  const canDeleteArchived = profile?.role === 'onboarding_media' && client.archived
  const canCreateNotes = !client.archived && (profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin || profile?.permissions?.clients_edit))
  const canManageNotes = canCreateNotes
  const canManageWorkflow = !client.archived && (profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin || profile?.permissions?.clients_edit))
  const canToggleStep = (step) => !client.archived && (canManageWorkflow || step.owner_role === profile?.role)
  const canViewSensitive = profile?.role === 'superadmin' || Boolean(profile?.permissions?.sensitive_credentials_view)
  const canManageSensitive = profile?.role === 'superadmin'
  const canEdit = Boolean(profile?.permissions?.clients_edit) && !client.archived
  const dossierText = buildDossierText(client, dossierUpdatedBy, { lastUpdatedAt: dossierUpdatedAt, workflowSteps })
  const copyForGoogleDocs = async () => {
    try {
      const copiedAt = new Date().toISOString()
      const copyText = buildDossierText(client, dossierUpdatedBy, { lastUpdatedAt: dossierUpdatedAt, copiedAt, workflowSteps })
      await copyDossier(copyText)
      await recordDossierEvent(clientId, 'copied_google_docs', profile.id, copiedAt)
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
  const permanentlyDeleteArchivedClient = async () => {
    if (!canDeleteArchived) return
    const code = window.prompt(t('Escribe el código del cliente para confirmar que quieres eliminar permanentemente el cliente y su historial relacionado.'))
    if (code === null) return
    if (code.trim().toUpperCase() !== String(client.code).toUpperCase()) {
      setError(t('El código no coincide. El cliente no se eliminó.'))
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      await deleteArchivedClient(clientId)
      navigate('/clientes?vista=archivados')
    } catch (deleteError) { setError(t(deleteError.message)) }
    finally { setSaving(false) }
  }
  const launchDate = client.target_launch_date ? new Date(`${client.target_launch_date}T23:59:59`) : null
  const launchOverdue = launchDate && !['ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL'].includes(client.status) && launchDate < new Date()
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
    if (targetSection) window.scrollTo({ top: window.scrollY + targetSection.getBoundingClientRect().top - 88, behavior: 'smooth' })
    window.setTimeout(() => setHighlightedSection((current) => current === matchIndex ? null : current), 2200)
  }

  return <div className="page-stack client-dossier-page" data-client-tab={activeTab}>
    <header ref={clientHeaderRef} className="page-header client-detail-header"><div><p className="eyebrow">{client.code} · {client.archived ? t('Cliente archivado') : t('Cliente activo')} {canEdit && <button className="text-button compact-button" type="button" onClick={() => { setCodeDraft(client.code); setCodeEditing(true); setError(''); setMessage('') }}>{t('Editar código')}</button>}</p><h2>{client.business_name}</h2><p className="muted">{t(client.phase)}</p></div><div className="header-actions dossier-actions"><span className={`lifecycle large-pill ${client.archived ? 'archived' : client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.archived ? t('ARCHIVADO') : t(client.status)}</span>{canManageArchive && !client.archived && <button className="secondary-button archive-client-button" type="button" disabled={saving} onClick={() => { setArchiveOpen(true); setError(''); setMessage('') }}>{t('Archivar cliente')}</button>}{canManageArchive && client.archived && <button className="primary-button compact-button" type="button" disabled={saving} onClick={restoreClient}>{saving ? 'Restaurando…' : t('Restaurar cliente')}</button>}{canEdit && ['ADS LIVE', 'CRUISE CONTROL'].includes(client.status) && <button className="danger-button" type="button" disabled={saving} onClick={() => { setPauseOpen(true); setError(''); setMessage(''); if (activeTab !== 'ads') selectTab('ads') }}>{t('Pausar ADS')}</button>}{canEdit && client.status === 'ADS PAUSED' && <button className="primary-button compact-button" type="button" disabled={saving} onClick={resumeAds}>{saving ? 'Reactivando…' : 'Reactivar ADS'}</button>}{slackChannelUrl && <a className="secondary-button slack-channel-button" href={slackChannelUrl} target="_blank" rel="noreferrer">{t('Abrir Slack')} ↗</a>}{driveFolderUrl && <a className="secondary-button drive-folder-button" href={driveFolderUrl} target="_blank" rel="noreferrer">{t('Abrir Drive')} ↗</a>}<button className="secondary-button" type="button" onClick={copyForGoogleDocs}>{t('Copiar para Google Docs')}</button><button className="secondary-button" type="button" onClick={downloadPdf}>{t('Descargar WWWW PDF')}</button>{client.google_docs_url && <a className="secondary-button" href={client.google_docs_url} target="_blank" rel="noreferrer">{t('Abrir Google Docs')} ↗</a>}{canEdit && <button className="secondary-button" type="button" disabled={!client.google_docs_url} onClick={markDocsUpdated}>{t('Marcar como actualizado')}</button>}</div></header>
    {showPinnedClient && <div className="client-name-pin" aria-label={client.business_name}><span className="client-name-pin-code">{client.code}</span><strong>{client.business_name}</strong><span className="client-name-pin-phase">{t(client.phase)}</span><span className={`lifecycle client-name-pin-status ${client.archived ? 'archived' : client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.archived ? t('ARCHIVADO') : t(client.status)}</span></div>}
    <div className="client-sticky-shell">
    <nav className="client-detail-tabs" role="tablist" aria-label={t('Secciones del cliente')}>{tabs.map(([key, label]) => {
      const count = key === 'notes' ? notes.length : key === 'audit' ? auditLog.length : key === 'checklist' ? workflowSteps.length - workflowDone : 0
      return <button key={key} type="button" role="tab" aria-selected={activeTab === key} className={activeTab === key ? 'active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => selectTab(key)}>
        <NavIcon name={key} />
        <span>{t(label)}</span>
        {count > 0 && <span className="tab-count">{count > 99 ? '99+' : count}</span>}
      </button>
    })}</nav>
    <form className="dossier-search compact-sticky-search client-tab-section tab-dossier" role="search" onSubmit={searchDossier}><label htmlFor="dossier-search-input">Buscar en este dossier</label><div><input id="dossier-search-input" type="search" value={dossierSearch} onChange={(event) => setDossierSearch(event.target.value)} placeholder="Ej. EIN, presupuesto, pixel, dominio…" /><button className="secondary-button" type="submit">Buscar</button></div></form>
    </div>
    {codeEditing && <form className="content-card client-code-editor" onSubmit={saveClientCode}>
      <div className="section-heading"><div><p className="eyebrow">{t('Código')}</p><h3>{t('Editar código')}</h3><p className="muted">{t('El código debe ser único para cada cliente.')}</p></div></div>
      <label htmlFor="client-code-input">{t('Código')}</label>
      <input id="client-code-input" value={codeDraft} onChange={(event) => setCodeDraft(event.target.value)} autoComplete="off" autoCapitalize="characters" maxLength={30} required />
      <div className="section-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setCodeEditing(false)}>{t('Cancelar')}</button><button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Guardar')}</button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    {archiveOpen && <form className="content-card client-archive-form client-tab-section tab-dossier" onSubmit={archiveClient}><div><p className="eyebrow">Salida de la operación</p><h3>Archivar cliente</h3><p className="muted">El dossier y el historial se conservarán fuera de los clientes activos.</p></div><label>Motivo<select value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} required><option value="">Seleccionar…</option><option>Contrato finalizado</option><option>Cancelación del cliente</option><option>Falta de pago</option><option>Campaña terminada</option><option>Otro</option></select></label><label>Nota final opcional<textarea rows="4" maxLength="2000" value={archiveNote} onChange={(event) => setArchiveNote(event.target.value)} placeholder="Contexto de la salida, pendientes o condiciones para regresar…" /></label><div className="section-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => { setArchiveOpen(false); setArchiveReason(''); setArchiveNote('') }}>Cancelar</button><button className="danger-button" disabled={saving}>{saving ? 'Archivando…' : 'Confirmar archivo'}</button></div></form>}
    {client.archived && <section className="content-card client-archive-summary client-tab-section tab-dossier"><div><p className="eyebrow">Cliente archivado</p><h3 data-no-translate>{client.archive_reason}</h3>{client.archive_note && <p data-no-translate>{client.archive_note}</p>}<small>{client.archived_at ? t(`Archivado el ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.archived_at))}`) : ''}</small></div><div className="section-actions">{canManageArchive && <button className="primary-button compact-button" type="button" disabled={saving} onClick={restoreClient}>{saving ? 'Restaurando…' : t('Restaurar cliente')}</button>}{canDeleteArchived && <button className="danger-button compact-button" type="button" disabled={saving} onClick={permanentlyDeleteArchivedClient}>{saving ? t('Eliminando…') : t('Eliminar definitivamente')}</button>}</div></section>}
    <DossierSuggestions clientId={client.id} className="content-card client-tab-section tab-dossier" onApplied={() => refresh()} />
    <div className="client-ops-summary-grid client-tab-section tab-dossier">
      <section className="content-card compact-summary-card"><p className="eyebrow">Próxima acción</p><h3>{client.next_action || 'Sin acción'}</h3></section>
      <section className={`content-card launch-deadline compact-summary-card ${launchOverdue ? 'overdue' : ''}`}><div><p className="eyebrow">Deadline de lanzamiento ADS</p><h3>{client.target_launch_date || 'Sin fecha definida'}</h3></div><span>{client.status === 'CRUISE CONTROL' ? t('Cruise Control') : client.status === 'ADS LIVE' ? 'Campaña activa' : client.status === 'ADS PAUSED' ? 'Campaña pausada' : launchOverdue ? 'Lanzamiento atrasado' : 'Pendiente de lanzamiento'}</span></section>
      <section className="content-card docs-sync-status compact-summary-card compact-last-copy-card"><div><span>{t('Última actualización del dossier')}</span><strong>{formatDossierDateTime(dossierUpdatedAt)}</strong><small>{dossierUpdatedBy}</small></div><div><span>Última copia</span><strong>{client.dossier_copied_at ? formatDossierDateTime(client.dossier_copied_at) : t('Todavía no se ha copiado')}</strong></div><div><span>Google Docs actualizado</span><strong>{client.google_docs_updated_at ? formatDossierDateTime(client.google_docs_updated_at) : t('Pendiente')}</strong></div></section>
    </div>
    <section className="content-card missing-dossier-card client-tab-section tab-dossier"><p className="eyebrow">Falta en el dossier</p>{missingFields.length ? <div className="missing-chips">{missingFields.map((item) => <button type="button" key={item.key} onClick={() => openMissingField(item)}>{t(item.label)}</button>)}</div> : <p className="complete-note">Dossier WWWW completo</p>}</section>
    <p className="muted dossier-language-note client-tab-section tab-dossier">{t('Escribe en inglés todos los datos descriptivos del dossier, incluidas notas, servicios, ofertas, público objetivo y estrategia de campaña. Conserva nombres oficiales, direcciones, códigos ZIP, enlaces e identificadores tal como fueron proporcionados.')}</p>
    <div className="print-dossier client-tab-section tab-dossier">
      <header className="print-only print-title"><p>{client.code} · TACTICAL PIPELINE</p><h1>{client.business_name}</h1><span>{client.status} · {client.phase}</span></header>
      {sections.map((section, index) => {
        const editing = editingSection === index
        const sectionKeys = section.fields.map(([, key]) => key)
        const lastUpdate = auditLog.find((entry) => entry.changed_fields?.some((field) => sectionKeys.includes(field)))
        return <section className={`content-card dossier-section ${highlightedSection === index ? 'search-highlight' : ''} ${editing ? 'is-editing' : ''}`} id={`dossier-section-${index}`} key={section.title} onKeyDown={editing ? (event) => sectionKeyDown(event, section, index) : undefined}>
          <div className="section-heading dossier-section-heading"><p className="eyebrow">{t(section.title)}</p><div className="section-actions">{editing ? <><small className="dossier-edit-hint">{dirtyKeys.length ? t(`${dirtyKeys.length} cambio(s) sin guardar`) : t('Esc para cancelar · Ctrl+Enter para guardar')}</small><button className="secondary-button" type="button" onClick={confirmDiscard}>{t('Cancelar')}</button><button className="primary-button compact-button" type="button" disabled={saving} onClick={() => saveSection(section, index)}>{saving ? t('Guardando…') : t('Guardar')}</button></> : canEdit && <button className="secondary-button" type="button" disabled={editingSection != null} onClick={() => startEditing(index)}>{t('Editar')}</button>}</div></div>
          <div className="detail-grid">{section.fields.map(([label, key, type, source]) => <div className={`detail-item ${type === 'long' ? 'long-field' : ''} ${editing && dirtyKeys.includes(key) ? 'changed' : ''}`} id={`dossier-field-${key}`} key={key}><span>{t(label)}<small className={`dossier-field-source source-${source}`}>{t(fieldSources[source])}</small></span>{editing ? (type === 'boolean' ? <select value={draft[key] == null ? '' : String(draft[key])} onChange={(event) => setField(key, event.target.value === '' ? null : event.target.value === 'true')}><option value="">Pendiente</option><option value="true">Sí</option><option value="false">No</option></select> : type === 'status' ? <select value={draft[key]} onChange={(event) => setField(key, event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option><option>CRUISE CONTROL</option><option disabled>ADS PAUSED</option></select> : String(type || '').startsWith('choice:') ? <select value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)}><option value="">{t('Pendiente')}</option>{type.slice(7).split('|').map((option) => <option key={option} value={option}>{option}</option>)}</select> : type === 'radius' ? <input type="number" min="1" max="500" step="1" value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} /> : type === 'long' ? <textarea rows="3" value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} /> : <input type={type === 'url' ? 'text' : type || 'text'} value={draft[key] ?? ''} onChange={(event) => setField(key, event.target.value)} />) : (type === 'url' && /^https?:\/\//i.test(client[key] || '') ? <a href={client[key]} target="_blank" rel="noreferrer">{t('Abrir enlace')} ↗</a> : <strong>{type === 'boolean' || isMissing(client[key], type) ? t(displayValue(client[key], type)) : displayValue(client[key], type)}</strong>)}</div>)}</div>
          {editing && section.title === 'Segmentación de anuncios' && !String(draft.ads_targeting_address || '').trim() && client.address && <p className="dossier-hint"><button className="text-button" type="button" onClick={() => setField('ads_targeting_address', client.address)}>{t('Usar la dirección del negocio')}</button> <span data-no-translate>({client.address})</span></p>}
          {section.steps && <div className="dossier-step-chips" aria-label={t('Pasos del checklist')}>{section.steps.map((key) => stepByKey.get(key)).filter(Boolean).map((step) => <button type="button" key={step.id} className={`dossier-step-chip ${step.completed ? 'done' : ''}`} disabled={!canToggleStep(step)} title={step.department_id ? t(step.owner_name) : ''} onClick={() => toggleStep(step)}><span aria-hidden="true">{step.completed ? '✓' : '○'}</span>{stepTitle(step)}</button>)}</div>}
          <small className="section-updated">{lastUpdate ? t(`Actualizado por ${lastUpdate.actor_name} · ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(lastUpdate.created_at))}`) : 'Sin actualizaciones registradas'}</small>
        </section>
      })}
    </div>

    <section className="content-card credential-vault client-tab-section tab-dossier"><div className="section-heading"><div><p className="eyebrow">Bóveda de credenciales</p><h3>Meta Access Token</h3><p className="muted">No se incluye en el dossier, PDF, Google Docs ni búsquedas.</p></div><span className="credential-state">Protegido</span></div>{!canViewSensitive ? <p className="credential-restricted">Acceso restringido. Un administrador puede habilitar el permiso individual desde Usuarios.</p> : <div className="credential-controls">{!secretVisible ? <button className="secondary-button" type="button" disabled={secretLoading} onClick={revealMetaToken}>{secretLoading ? 'Verificando permiso…' : 'Mostrar token'}</button> : <><div className="credential-value"><span>Access Token</span><code>{secretValue || 'No hay token configurado'}</code></div><div className="section-actions"><button className="secondary-button" type="button" onClick={copyMetaToken} disabled={!secretValue}>Copiar</button><button className="text-button" type="button" onClick={hideMetaToken}>Ocultar</button></div></>}{canManageSensitive && !secretEditing && <button className="text-button" type="button" onClick={() => { hideMetaToken(); setSecretEditing(true); setSecretDraft('') }}>Actualizar token</button>}{canManageSensitive && secretEditing && <form className="credential-editor" onSubmit={saveMetaToken}><label>Nuevo Access Token<textarea rows="4" value={secretDraft} autoComplete="off" spellCheck="false" onChange={(event) => setSecretDraft(event.target.value)} placeholder="Pega aquí el token nuevo" required /></label><div className="section-actions"><button className="text-button" type="button" onClick={() => { setSecretEditing(false); setSecretDraft('') }}>Cancelar</button><button className="primary-button compact-button" disabled={secretLoading}>{secretLoading ? 'Guardando…' : 'Guardar protegido'}</button></div></form>}</div>}</section>
    <GhlLoginVault clientId={client.id} archived={client.archived} />
    {client.onboarding_form_notes && <details className="content-card dossier-source-notes client-tab-section tab-dossier">
      <summary className="section-heading dossier-section-heading"><span className="eyebrow">{t('Ver notas originales del formulario')}</span></summary>
      <p className="dossier-source-notes-content">{client.onboarding_form_notes}</p>
    </details>}

    <div className="client-tab-section tab-dossier"><ClientOpsPanel client={client} directory={directory} canEdit={canEdit} onRefresh={refresh} /></div>

    <div className="client-tab-section tab-checklist client-workflow-groups">
      <section className="content-card client-checklist"><div className="section-heading"><div><p className="eyebrow">{t('Checklist de lanzamiento')}</p><h3>{workflowDone} {t('de')} {workflowSteps.length} {t('completadas')}</h3><p className="muted">{currentPhase ? `${t('Fase actual')}: ${t(checklistPhases.find(([key]) => key === currentPhase)?.[1] || '')}` : t('Checklist completo')}</p></div><button className="text-button" type="button" onClick={() => setShowAllWorkflowSteps((value) => !value)}>{showAllWorkflowSteps ? t('Ver solo la fase actual') : t('Ver checklist completo')}</button></div>
        {(() => {
          const missing = workflowSteps.filter((step) => step.completed && step.evidence === 'required' && !stepEvidence.some((item) => item.step_id === step.id))
          return missing.length > 0 && <div className="checklist-evidence-hint">📷 {missing.length === 1 ? t('1 paso marcado espera su captura:') : t(`${missing.length} pasos marcados esperan su captura:`)} <span data-no-translate>{missing.map((step) => String(step.sort_order).padStart(2, '0')).join(', ')}</span></div>
        })()}
        {suggestedStatus && canEdit && <div className="checklist-status-hint"><span>{t(`El checklist indica que el cliente ya está en ${suggestedStatus}.`)}</span><button className="primary-button compact-button" type="button" disabled={saving} onClick={applySuggestedStatus}>{t(`Cambiar estado a ${suggestedStatus}`)}</button></div>}
        {checklistPhases.filter(([phase]) => visibleWorkflowSteps.some((step) => step.phase === phase)).map(([phase, phaseLabel]) => {
          const phaseSteps = visibleWorkflowSteps.filter((step) => step.phase === phase)
          const allPhaseSteps = workflowSteps.filter((step) => step.phase === phase)
          return <div className="checklist-phase" key={phase}>
            <h4>{t(phaseLabel)} <small>{allPhaseSteps.filter((step) => step.completed).length}/{allPhaseSteps.length}</small></h4>
            <div className="workflow-list">{phaseSteps.map((step) => {
              const evidence = stepEvidence.filter((item) => item.step_id === step.id)
              return <div className={`workflow-step-block ${step.completed ? 'completed' : ''}`} key={step.id}>
                <label className={`workflow-step ${step.completed ? 'completed' : ''}`}><input type="checkbox" checked={step.completed} disabled={!canToggleStep(step)} onChange={() => toggleStep(step)} /><span className="workflow-order">{String(step.sort_order).padStart(2, '0')}</span><div><strong>{stepTitle(step)}{step.evidence === 'required' && !evidence.length && <span className={`step-evidence-needed ${step.completed ? 'late' : ''}`} title={t('Este paso se confirma con una captura')}>📷 {t('Captura')}</span>}</strong><small>{t(step.owner_name)}</small>{step.notes && <small className="workflow-step-note" data-no-translate>{step.notes}</small>}</div></label>
                <StepEvidence clientId={client.id} step={step} items={evidence} canUpload={canToggleStep(step)} canDelete={(item) => item.uploaded_by === profile?.id || canManageArchive} onChange={refreshEvidence} autoOpen={evidencePromptStep === step.id} />
              </div>
            })}</div>
          </div>
        })}
      </section>
      <section className="content-card"><p className="eyebrow">{t('Bloqueos')}</p><h3>{blockers.filter((item) => !item.resolved).length} {t('abiertos')}</h3>{blockers.map((item) => <div className="blocker-row" key={item.id}><strong>{item.title}</strong><small>{item.owner_name}</small></div>)}</section>
    </div>
    {/* Ads tab: current state first, then performance and reports; pause history last. */}
    {pauseOpen && <form className="content-card ads-pause-form client-tab-section tab-ads" onSubmit={pauseAds}><div><p className="eyebrow">Pausar campaña</p><h3>¿Por qué se pausarán los ADS?</h3><p className="muted">El motivo quedará visible en el cliente y en el historial.</p></div><label>Motivo de pausa<textarea rows="4" maxLength="2000" value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="Ej. CPL alto, método de pago rechazado o esperando aprobación del cliente…" required /></label><div className="section-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => { setPauseOpen(false); setPauseReason('') }}>Cancelar</button><button className="danger-button" disabled={saving}>{saving ? 'Pausando…' : 'Confirmar pausa'}</button></div></form>}
    {client.status === 'ADS PAUSED' && <section className="content-card ads-pause-summary client-tab-section tab-ads"><div><p className="eyebrow">ADS PAUSED</p><h3>Campaña pausada</h3><p data-no-translate>{client.ads_pause_reason}</p><small>{client.ads_paused_at ? t(`Pausada el ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(client.ads_paused_at))}`) : ''}</small></div>{canEdit && <button className="primary-button compact-button" type="button" disabled={saving} onClick={resumeAds}>{saving ? 'Reactivando…' : 'Reactivar ADS'}</button>}</section>}
    <div className="client-tab-section tab-ads">
      <GhlMetricsPanel client={client} canEdit={canEdit} onClientUpdated={() => refresh()} />
      <AdsReportsPanel client={client} canEdit={canEdit} />
    </div>
    {adStatusEvents.length > 0 && <section className="content-card client-tab-section tab-ads"><div className="section-heading"><div><p className="eyebrow">Historial ADS</p><h3>Pausas y reactivaciones</h3></div><span className="muted">{adStatusEvents.length} eventos</span></div><div className="ads-status-history">{adStatusEvents.map((event) => <article key={event.id}><span className={`lifecycle ${event.event_type === 'paused' ? 'ads-paused' : 'ads-live'}`}>{event.event_type === 'paused' ? 'PAUSADO' : 'REACTIVADO'}</span><div><strong>{event.event_type === 'paused' ? 'Pausó la campaña' : 'Reactivó la campaña'}</strong><p data-no-translate>{event.note}</p><small><span data-no-translate>{event.actor_name}</span> · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</small></div></article>)}</div></section>}
    <section className="content-card client-tab-section tab-notes client-log-section">
      <div className="section-heading"><div><p className="eyebrow">{t('Bitácora')}</p><h3>{t('Avances, entregas y bloqueos')}</h3></div></div>
      <ClientLog clientId={client.id} />
    </section>
    <section className="content-card client-tab-section tab-notes">
      <div className="section-heading"><div><p className="eyebrow">{t('Tickets')}</p><h3>{t('Tickets del cliente')}</h3></div><Link className="text-button" to="/tickets">{t('Ver todos')}</Link></div>
      <ClientTickets clientId={client.id} />
    </section>
    <section className="content-card client-tab-section tab-notes">
      <div className="section-heading"><div><p className="eyebrow">{t('Notas del cliente')}</p><h3>{t('Contexto compartido')}</h3></div><span className="muted">{notes.length} {t('notas')}</span></div>
      {canCreateNotes && <form className="client-note-form" onSubmit={addClientNote}>
        <label>{t('Título de la nota')}<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength="160" required /></label>
        <label>{t('Contenido')}<textarea rows="3" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength="5000" placeholder={t('Escribe una nota específica para este cliente…')} /></label>
        <button className="primary-button compact-button" disabled={saving || !noteTitle.trim()}>{saving ? t('Guardando…') : t('Agregar nota')}</button>
      </form>}
      <div className="note-list">{notes.length === 0 && <p className="muted">{t('Aún no hay notas para este cliente.')}</p>}{notes.map((note) => <article className="note-card" key={note.id}>
        {editingNoteId === note.id ? <form className="client-note-form" onSubmit={saveClientNote}>
          <label>{t('Título de la nota')}<input value={noteDraft.title} onChange={(event) => setNoteDraft((current) => ({ ...current, title: event.target.value }))} maxLength="160" required /></label>
          <label>{t('Contenido')}<textarea rows="3" value={noteDraft.body} onChange={(event) => setNoteDraft((current) => ({ ...current, body: event.target.value }))} maxLength="5000" /></label>
          <div className="section-actions"><button className="text-button" type="button" onClick={() => setEditingNoteId(null)}>{t('Cancelar')}</button><button className="primary-button compact-button" disabled={saving || !noteDraft.title.trim()}>{saving ? t('Guardando…') : t('Guardar cambios')}</button></div>
        </form> : <>
          <div className="section-heading"><strong data-no-translate>{note.title}</strong>{canManageNotes && <div className="section-actions"><button className="text-button" type="button" onClick={() => { setEditingNoteId(note.id); setNoteDraft({ title: note.title, body: note.body || '' }) }}>{t('Editar nota')}</button><button className="text-button" type="button" disabled={saving} onClick={() => removeClientNote(note.id)}>{t('Eliminar nota')}</button></div>}</div>
          {note.body && <LinkifiedText text={note.body} className="formatted-text" />}
          <small>{note.author?.full_name || t('Usuario')} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small>
        </>}
      </article>)}</div>
    </section>
    <section className="content-card client-tab-section tab-audit"><div className="section-heading"><div><p className="eyebrow">Auditoría</p><h3>Historial de cambios</h3></div><span className="muted">Últimos {auditLog.length}</span></div><div className="audit-list">{auditLog.length === 0 && <p className="muted">Aún no hay cambios registrados.</p>}{auditLog.map((entry) => <article className="audit-row" key={entry.id}><span className={`audit-badge ${entry.actor_role}`} data-no-translate>{entry.actor_name}</span><div><strong>{entry.action === 'dossier_updated' ? 'Actualizó el dossier' : entry.summary}</strong>{entry.action === 'dossier_updated' && <p>{entry.changed_fields.map((field) => t(fieldLabels[field] || field)).join(', ')}</p>}<small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.created_at))}</small></div></article>)}</div></section>
  </div>
}
