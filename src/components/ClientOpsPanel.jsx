import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { supabase } from '../lib/supabase'
import { updateClient } from '../services/opsService'

const dossierFields = [
  ['business_name', 'Nombre comercial'], ['legal_name', 'Nombre legal'], ['owner_name', 'Contacto principal'],
  ['phone', 'Teléfono de negocio'], ['email', 'Correo de negocio'], ['contact_phone', 'Teléfono de contacto'],
  ['address', 'Dirección'], ['timezone', 'Zona horaria'], ['markets', 'Zona de servicio'],
  ['target_zip_codes', 'Códigos ZIP'], ['services', 'Servicios'], ['offer', 'Oferta'],
  ['daily_budget', 'Presupuesto diario'], ['legal_business_info', 'EIN / dato legal'],
  ['payment_method_confirmed', 'Método de pago'], ['facebook_page_url', 'Página de Facebook'],
  ['facebook_business_info', 'Acceso a Meta'], ['facebook_access_confirmed', 'Acceso Facebook confirmado'],
  ['meta_business_portfolio_id', 'Meta Business Portfolio'], ['meta_ad_account_id', 'Cuenta publicitaria Meta'],
  ['gbp_status', 'Google Business Profile'], ['gbp_email', 'Correo GBP'], ['gbp_link', 'Enlace GBP'],
  ['ghl_subaccount_link', 'Subcuenta GHL'], ['drive_folder_link', 'Carpeta de Drive'],
  ['domain', 'Dominio'], ['website_url', 'Sitio web'], ['ad_strategy', 'Estrategia de campaña'],
  ['ideal_customer_profile', 'Público objetivo'], ['available_assets', 'Material de campaña'],
  ['landing_page_url', 'Página de aterrizaje'], ['meta_campaign_live', 'Campaña activa'],
  ['onboarding_completed', 'Capacitación completada'], ['target_launch_date', 'Fecha objetivo de lanzamiento'],
]

const stages = [
  ['onboarding', 'Onboarding'], ['data_access', 'Datos y accesos'], ['technical_setup', 'Configuración técnica'],
  ['campaign_ready', 'Campaña lista'], ['campaign_active', 'Campaña activa'], ['training', 'Capacitación'], ['cruise_control', 'Cruise control'],
]

const stageRequirements = [
  ['business_name', 'legal_name', 'owner_name', 'phone', 'email'],
  ['contact_phone', 'address', 'timezone', 'markets', 'target_zip_codes', 'services', 'offer', 'daily_budget', 'legal_business_info', 'payment_method_confirmed'],
  ['ghl_subaccount_link', 'drive_folder_link', 'gbp_status', 'gbp_email', 'gbp_link', 'facebook_business_info', 'facebook_access_confirmed', 'meta_business_portfolio_id', 'meta_ad_account_id', 'domain', 'website_url'],
  ['ad_strategy', 'ideal_customer_profile', 'available_assets', 'landing_page_url'],
  ['meta_campaign_live'],
  ['onboarding_completed'],
  ['target_launch_date'],
]

const verificationStatuses = ['pending', 'complete', 'not_applicable', 'verify']
const emptyInteraction = { direction: 'outbound', channel: 'ghl', summary: '', responder_id: '', next_step: '', next_follow_up_at: '' }

function fieldHasValue(value) {
  if (typeof value === 'boolean') return value
  return value != null && String(value).trim() !== '' && !/^(pending|pendiente|confirm|verificar|n\/?a|none|null)$/i.test(String(value).trim())
}

export default function ClientOpsPanel({ client, directory = [], canEdit, onRefresh }) {
  const { profile } = useAuth()\n  const canViewSyncLog = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const { t, locale } = useLanguage()
  const [verifications, setVerifications] = useState({})
  const [interactions, setInteractions] = useState([])
  const [syncEvents, setSyncEvents] = useState([])
  const [interaction, setInteraction] = useState(emptyInteraction)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAllFields, setShowAllFields] = useState(false)

  const reload = async () => {
    const [verificationResult, interactionResult, syncResult] = await Promise.all([
      supabase.from('client_field_verifications').select('*').eq('client_id', client.id),
      supabase.from('client_interactions').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),\n      canViewSyncLog ? supabase.from('ghl_form_imports').select('id,status,action,sync_stage,attempt_count,last_attempt_at,error_message,processed_at,created_at').or('client_id.eq.' + client.id + (client.ghl_contact_id ? ',contact_id.eq.' + client.ghl_contact_id : '')).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
    ])
    if (verificationResult.error) throw verificationResult.error
    if (interactionResult.error) throw interactionResult.error
    setVerifications(Object.fromEntries((verificationResult.data || []).map((row) => [row.field_key, row])))
    setInteractions(interactionResult.data || [])
  }

  useEffect(() => { reload().catch((loadError) => setError(loadError.message)) }, [client.id])

  const currentStageIndex = Math.max(0, stages.findIndex(([key]) => key === client.lifecycle_stage))
  const requiredBeforeNext = useMemo(() => stageRequirements.slice(0, currentStageIndex + 1).flat(), [currentStageIndex])
  const missingBeforeNext = requiredBeforeNext.filter((key) => {
    const field = dossierFields.find(([fieldKey]) => fieldKey === key)
    const status = verifications[key]?.status
    if (status === 'not_applicable') return false
    return status !== 'complete' || !fieldHasValue(client[key])
  })
  const latestContact = interactions[0]
  const unclaimedInbound = interactions.find((item) => item.direction === 'inbound' && !item.responder_id)
  const memberName = (id) => directory.find((member) => member.id === id)?.full_name || t('Sin responsable')
  const formatDate = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''

  const saveVerification = async (fieldKey, status, note = '') => {
    setSaving(true); setError(''); setNotice('')
    const verified = status === 'complete' || status === 'not_applicable'
    const { error: saveError } = await supabase.from('client_field_verifications').upsert({
      client_id: client.id,
      field_key: fieldKey,
      status,
      note,
      verified_by: verified ? profile.id : null,
      verified_at: verified ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id,field_key' })
    if (saveError) setError(t(saveError.message))
    else {
      setNotice(t('Verificación guardada.'))
      await reload()
    }
    setSaving(false)
  }

  const changeStage = async (nextStage) => {
    setSaving(true); setError(''); setNotice('')
    try {
      await updateClient(client.id, { lifecycle_stage: nextStage })
      await onRefresh?.()
      setNotice(t('Etapa actualizada.'))
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }

  const saveInteraction = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const { error: saveError } = await supabase.from('client_interactions').insert({
      client_id: client.id,
      ...interaction,
      responder_id: interaction.responder_id || null,
      next_follow_up_at: interaction.next_follow_up_at ? new Date(interaction.next_follow_up_at).toISOString() : null,
      created_by: profile.id,
    })
    if (saveError) setError(t(saveError.message))
    else {
      setInteraction(emptyInteraction)
      setNotice(t('Seguimiento registrado.'))
      await reload()
    }
    setSaving(false)
  }

  const displayedFields = showAllFields ? dossierFields : dossierFields.filter(([key]) => {
    const verification = verifications[key]
    return verification?.status !== 'complete' || !fieldHasValue(client[key])
  })

  return <section className="content-card client-ops-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Control del cliente')}</p><h3>{t('Dossier y avance')}</h3><p className="muted">{t('Verifica los datos antes de avanzar; cada cambio conserva responsable y fecha.')}</p></div><span className="lifecycle">{Math.max(0, currentStageIndex + 1)} / {stages.length}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}
    <div className="lifecycle-stage-picker"><label>{t('Etapa actual')}<select value={client.lifecycle_stage || 'onboarding'} disabled={!canEdit || saving || client.archived} onChange={(event) => changeStage(event.target.value)}>{stages.map(([key, label], index) => <option key={key} value={key}>{index + 1}. {t(label)}</option>)}</select></label><div className="lifecycle-progress" role="progressbar" aria-valuemin="0" aria-valuemax={stages.length} aria-valuenow={currentStageIndex + 1}><span style={{ width: ((currentStageIndex + 1) / stages.length * 100) + '%' }} /></div></div>
    {missingBeforeNext.length > 0 && <div className="dossier-gate"><strong>{t('Pendiente para avanzar')}</strong><p>{missingBeforeNext.map((key) => t(dossierFields.find(([fieldKey]) => fieldKey === key)?.[1] || key)).join(', ')}</p></div>}
    <div className="section-heading"><div><h4>{t('Verificación del dossier')}</h4><p className="muted">{t('Campos completos, pendientes, no aplicables o por verificar.')}</p></div><button className="text-button" type="button" onClick={() => setShowAllFields((value) => !value)}>{showAllFields ? t('Ver solo pendientes') : t('Ver todos los campos')}</button></div>
    <div className="dossier-verification-list">{displayedFields.map(([key, label]) => {
      const row = verifications[key] || { status: fieldHasValue(client[key]) ? 'verify' : 'pending', note: '' }
      return <article className="dossier-verification-row" key={key}><div><strong>{t(label)}</strong><small>{fieldHasValue(client[key]) ? t('Dato recibido') : t('Sin dato')}{row.verified_by ? ' · ' + memberName(row.verified_by) + ' · ' + formatDate(row.verified_at) : ''}</small><input aria-label={t('Nota de verificación') + ' ' + t(label)} maxLength={1000} placeholder={t('Nota de verificación')} value={row.note || ''} disabled={!canEdit || client.archived} onChange={(event) => setVerifications((current) => ({ ...current, [key]: { ...row, note: event.target.value } }))} onBlur={(event) => canEdit && !client.archived && event.target.value !== (verifications[key]?.note || '') && saveVerification(key, row.status, event.target.value)} /></div><select aria-label={t('Estado de verificación') + ' ' + t(label)} value={row.status} disabled={!canEdit || saving || client.archived} onChange={(event) => saveVerification(key, event.target.value, row.note || '')}>{verificationStatuses.map((status) => <option key={status} value={status}>{t(status)}</option>)}</select></article>
    })}</div>
    {canViewSyncLog && <div className="client-sync-log"><div className="section-heading"><div><h4>{t('Sincronización de onboarding')}</h4><p className="muted">{t('Últimos intentos del formulario de GHL y etapa alcanzada.')}</p></div></div>{syncEvents.length === 0 ? <p className="muted">{t('No hay sincronizaciones registradas para este cliente.')}</p> : syncEvents.map((entry) => <article className="client-contact-row" key={entry.id}><strong>{t(entry.status)} · {t(entry.sync_stage)}</strong><small>{t('Intento')}: {entry.attempt_count} · {formatDate(entry.last_attempt_at || entry.created_at)}{entry.action ? ' · ' + t(entry.action) : ''}</small>{entry.error_message && <p className="form-error">{entry.error_message}</p>}</article>)}</div>}
    <div className="client-contact-summary"><div className="section-heading"><div><h4>{t('Seguimiento del cliente')}</h4><p className="muted">{latestContact ? t('Último contacto') + ': ' + formatDate(latestContact.created_at) + ' · ' + t(latestContact.channel) + ' · ' + memberName(latestContact.responder_id || latestContact.created_by) : t('Aún no hay contactos registrados.')}</p></div></div>{unclaimedInbound && <p className="form-error">{t('Respuesta del cliente sin responsable')}: {unclaimedInbound.summary}</p>}
      <div className="client-contact-list">{interactions.slice(0, 5).map((item) => <article className="client-contact-row" key={item.id}><strong>{t(item.direction)} · {t(item.channel)}</strong><p>{item.summary}</p><small>{memberName(item.responder_id || item.created_by)} · {formatDate(item.created_at)}{item.next_follow_up_at ? ' · ' + t('Próximo seguimiento') + ': ' + formatDate(item.next_follow_up_at) : ''}{item.next_step ? ' · ' + item.next_step : ''}</small></article>)}</div>
      {canEdit && !client.archived && <form className="client-contact-form" onSubmit={saveInteraction}><label>{t('Canal')}<select value={interaction.channel} onChange={(event) => setInteraction((value) => ({ ...value, channel: event.target.value }))}>{['ghl','whatsapp','phone','email','sms','other'].map((key) => <option key={key} value={key}>{t(key)}</option>)}</select></label><label>{t('Dirección')}<select value={interaction.direction} onChange={(event) => setInteraction((value) => ({ ...value, direction: event.target.value }))}>{['outbound','inbound','internal'].map((key) => <option key={key} value={key}>{t(key)}</option>)}</select></label><label>{t('Responsable de responder')}<select value={interaction.responder_id} onChange={(event) => setInteraction((value) => ({ ...value, responder_id: event.target.value }))}><option value="">{t('Sin responsable')}</option>{directory.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label><label>{t('Resumen del contacto')}<textarea required maxLength={3000} rows={3} value={interaction.summary} onChange={(event) => setInteraction((value) => ({ ...value, summary: event.target.value }))} /></label><div className="client-contact-form-grid"><label>{t('Próximo paso')}<input maxLength={1000} value={interaction.next_step} onChange={(event) => setInteraction((value) => ({ ...value, next_step: event.target.value }))} /></label><label>{t('Fecha del próximo seguimiento')}<input type="datetime-local" value={interaction.next_follow_up_at} onChange={(event) => setInteraction((value) => ({ ...value, next_follow_up_at: event.target.value }))} /></label></div><button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Registrar contacto')}</button></form>}
    </div>
  </section>
}
