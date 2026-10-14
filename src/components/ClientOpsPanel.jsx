import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { supabase } from '../lib/supabase'
import { updateClient } from '../services/opsService'

const stages = [
  ['onboarding', 'Onboarding'], ['data_access', 'Datos y accesos'], ['technical_setup', 'Configuración técnica'],
  ['campaign_ready', 'Campaña lista'], ['campaign_active', 'Campaña activa'], ['training', 'Capacitación'], ['cruise_control', 'Cruise control'],
]

const emptyInteraction = { direction: 'outbound', channel: 'ghl', summary: '', responder_id: '', next_step: '', next_follow_up_at: '' }

export default function ClientOpsPanel({ client, directory = [], canEdit, onRefresh }) {
  const { profile } = useAuth()
  const canViewSyncLog = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const { t, locale } = useLanguage()
  const [interactions, setInteractions] = useState([])
  const [syncEvents, setSyncEvents] = useState([])
  const [offerHistory, setOfferHistory] = useState([])
  const [interaction, setInteraction] = useState(emptyInteraction)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = async () => {
    const [interactionResult, offerHistoryResult, syncResult] = await Promise.all([
      supabase.from('client_interactions').select('*').eq('client_id', client.id).order('created_at', { ascending: false }).limit(50),
      supabase.from('client_offer_history').select('*').eq('client_id', client.id).order('changed_at', { ascending: false }).limit(50),
      canViewSyncLog ? supabase.from('ghl_form_imports').select('id,status,action,sync_stage,attempt_count,last_attempt_at,error_message,processed_at,created_at').or('client_id.eq.' + client.id + (client.ghl_contact_id ? ',contact_id.eq.' + client.ghl_contact_id : '')).order('created_at', { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null }),
    ])
    if (interactionResult.error) throw interactionResult.error
    if (offerHistoryResult.error) throw offerHistoryResult.error
    if (syncResult.error) throw syncResult.error
    setSyncEvents(syncResult.data || [])
    setInteractions(interactionResult.data || [])
    setOfferHistory(offerHistoryResult.data || [])
  }

  useEffect(() => { reload().catch((loadError) => setError(loadError.message)) }, [client.id])

  const currentStageIndex = Math.max(0, stages.findIndex(([key]) => key === client.lifecycle_stage))
  const latestContact = interactions[0]
  const unclaimedInbound = interactions.find((item) => item.direction === 'inbound' && !item.responder_id)
  const memberName = (id) => directory.find((member) => member.id === id)?.full_name || t('Sin responsable')
  const formatDate = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''

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

  return <section className="content-card client-ops-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Control del cliente')}</p><h3>{t('Dossier y avance')}</h3><p className="muted">{t('Revisa la etapa actual y los datos que faltan para avanzar.')}</p></div><span className="lifecycle">{Math.max(0, currentStageIndex + 1)} / {stages.length}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}
    <div className="lifecycle-stage-picker"><label>{t('Etapa actual')}<select value={client.lifecycle_stage || 'onboarding'} disabled={!canEdit || saving || client.archived} onChange={(event) => changeStage(event.target.value)}>{stages.map(([key, label], index) => <option key={key} value={key}>{index + 1}. {t(label)}</option>)}</select></label><div className="lifecycle-progress" role="progressbar" aria-valuemin="0" aria-valuemax={stages.length} aria-valuenow={currentStageIndex + 1}><span style={{ width: ((currentStageIndex + 1) / stages.length * 100) + '%' }} /></div></div>
    <div className="client-sync-log client-offer-history"><div className="section-heading"><div><h4>{t('Historial de ofertas')}</h4><p className="muted">{t('Historial de ofertas: las ofertas anteriores y sus fechas se conservan aquí. El dossier copiado o descargado muestra solo la oferta actual.')}</p></div></div><p><strong>{t('Oferta actual')}:</strong> {client.offer || t('pending')}</p>{offerHistory.length === 0 ? <p className="muted">{t('Sin cambios de oferta registrados.')}</p> : offerHistory.map((entry) => <article className="client-contact-row" key={entry.id}><strong>{entry.new_offer || t('Oferta retirada')}</strong>{entry.previous_offer && <p>{t('Oferta anterior:')} {entry.previous_offer}</p>}<small>{entry.source === 'baseline' ? t('Seguimiento inicial') : entry.changed_by ? memberName(entry.changed_by) : t('Sistema / integración')} · {formatDate(entry.changed_at)}</small></article>)}</div>
    {canViewSyncLog && <div className="client-sync-log"><div className="section-heading"><div><h4>{t('Sincronización de onboarding')}</h4><p className="muted">{t('Últimos intentos del formulario de GHL y etapa alcanzada.')}</p></div></div>{syncEvents.length === 0 ? <p className="muted">{t('No hay sincronizaciones registradas para este cliente.')}</p> : syncEvents.map((entry) => <article className="client-contact-row" key={entry.id}><strong>{t(entry.status)} · {t(entry.sync_stage)}</strong><small>{t('Intento')}: {entry.attempt_count} · {formatDate(entry.last_attempt_at || entry.created_at)}{entry.action ? ' · ' + t(entry.action) : ''}</small>{entry.error_message && <p className="form-error">{entry.error_message}</p>}</article>)}</div>}
    <div className="client-contact-summary"><div className="section-heading"><div><h4>{t('Seguimiento del cliente')}</h4><p className="muted">{latestContact ? t('Último contacto') + ': ' + formatDate(latestContact.created_at) + ' · ' + t(latestContact.channel) + ' · ' + memberName(latestContact.responder_id || latestContact.created_by) : t('Aún no hay contactos registrados.')}</p></div></div>{unclaimedInbound && <p className="form-error">{t('Respuesta del cliente sin responsable')}: {unclaimedInbound.summary}</p>}
      <div className="client-contact-list">{interactions.slice(0, 5).map((item) => <article className="client-contact-row" key={item.id}><strong>{t(item.direction)} · {t(item.channel)}</strong><p>{item.summary}</p><small>{memberName(item.responder_id || item.created_by)} · {formatDate(item.created_at)}{item.next_follow_up_at ? ' · ' + t('Próximo seguimiento') + ': ' + formatDate(item.next_follow_up_at) : ''}{item.next_step ? ' · ' + item.next_step : ''}</small></article>)}</div>
      {canEdit && !client.archived && <form className="client-contact-form" onSubmit={saveInteraction}><label>{t('Canal')}<select value={interaction.channel} onChange={(event) => setInteraction((value) => ({ ...value, channel: event.target.value }))}>{['ghl','whatsapp','phone','email','sms','other'].map((key) => <option key={key} value={key}>{t(key)}</option>)}</select></label><label>{t('Dirección')}<select value={interaction.direction} onChange={(event) => setInteraction((value) => ({ ...value, direction: event.target.value }))}>{['outbound','inbound','internal'].map((key) => <option key={key} value={key}>{t(key)}</option>)}</select></label><label>{t('Responsable de responder')}<select value={interaction.responder_id} onChange={(event) => setInteraction((value) => ({ ...value, responder_id: event.target.value }))}><option value="">{t('Sin responsable')}</option>{directory.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label><label>{t('Resumen del contacto')}<textarea required maxLength={3000} rows={3} value={interaction.summary} onChange={(event) => setInteraction((value) => ({ ...value, summary: event.target.value }))} /></label><div className="client-contact-form-grid"><label>{t('Próximo paso')}<input maxLength={1000} value={interaction.next_step} onChange={(event) => setInteraction((value) => ({ ...value, next_step: event.target.value }))} /></label><label>{t('Fecha del próximo seguimiento')}<input type="datetime-local" value={interaction.next_follow_up_at} onChange={(event) => setInteraction((value) => ({ ...value, next_follow_up_at: event.target.value }))} /></label></div><button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Registrar contacto')}</button></form>}
    </div>
  </section>
}
