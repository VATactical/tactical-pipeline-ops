import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { supabase } from '../lib/supabase'
import { updateClient } from '../services/opsService'

const stages = [
  ['onboarding', 'Onboarding'], ['data_access', 'Datos y accesos'], ['technical_setup', 'Configuración técnica'],
  ['campaign_ready', 'Campaña lista'], ['campaign_active', 'Campaña activa'], ['training', 'Capacitación'], ['cruise_control', 'Cruise control'],
]

export default function ClientOpsPanel({ client, canEdit, onRefresh }) {
  const { profile } = useAuth()
  const canViewSyncLog = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const { t, locale } = useLanguage()
  const [syncEvents, setSyncEvents] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = async () => {
    const syncResult = canViewSyncLog
      ? await supabase.from('ghl_form_imports').select('id,status,action,sync_stage,attempt_count,last_attempt_at,error_message,processed_at,created_at').or('client_id.eq.' + client.id + (client.ghl_contact_id ? ',contact_id.eq.' + client.ghl_contact_id : '')).order('created_at', { ascending: false }).limit(10)
      : { data: [], error: null }
    if (syncResult.error) throw syncResult.error
    setSyncEvents(syncResult.data || [])
  }

  useEffect(() => { reload().catch((loadError) => setError(loadError.message)) }, [client.id, client.ghl_contact_id, canViewSyncLog])

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

  return <section className="content-card client-ops-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Control del cliente')}</p><h3>{t('Estado del cliente')}</h3></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success">{notice}</p>}
    <div className="lifecycle-stage-picker status-only"><label>{t('Etapa actual')}<select value={client.lifecycle_stage || 'onboarding'} disabled={!canEdit || saving || client.archived} onChange={(event) => changeStage(event.target.value)}>{stages.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label></div>
    {canViewSyncLog && <div className="client-sync-log"><div className="section-heading"><div><h4>{t('Sincronización de onboarding')}</h4><p className="muted">{t('Últimos intentos del formulario de GHL y etapa alcanzada.')}</p></div></div>{syncEvents.length === 0 ? <p className="muted">{t('No hay sincronizaciones registradas para este cliente.')}</p> : syncEvents.map((entry) => <article className="client-contact-row" key={entry.id}><strong>{t(entry.status)} · {t(entry.sync_stage)}</strong><small>{t('Intento')}: {entry.attempt_count} · {formatDate(entry.last_attempt_at || entry.created_at)}{entry.action ? ' · ' + t(entry.action) : ''}</small>{entry.error_message && <p className="form-error">{entry.error_message}</p>}</article>)}</div>}
  </section>
}
