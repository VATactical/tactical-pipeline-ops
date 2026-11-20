import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { loadDossierSuggestions, resolveDossierSuggestion } from '../services/opsService'

// Dossier values the team wrote in the client's Slack channel (pixel ID, landing page, budget…).
// TOPS proposes them; nothing changes in the dossier until someone applies them here.

export const SUGGESTION_FIELDS = {
  meta_pixel_id: 'Pixel de Meta',
  meta_ad_account_id: 'Cuenta publicitaria',
  meta_business_portfolio_id: 'Business Portfolio',
  landing_page_url: 'Landing page',
  website_url: 'Sitio web',
  facebook_page_url: 'Página de Facebook',
  instagram_url: 'Instagram',
  gbp_link: 'Google Business Profile',
  drive_folder_link: 'Carpeta de Drive',
  google_docs_url: 'Google Doc',
  make_scenario_link: 'Escenario de Make',
  retell_agent_id: 'Agente de Retell',
  daily_budget: 'Presupuesto diario',
  targeting_radius_miles: 'Radio de segmentación (millas)',
  ads_targeting_address: 'Dirección de segmentación',
  ad_account_name: 'Nombre de la cuenta publicitaria',
  conversion_location: 'Ubicación de conversión',
  instant_form_name: 'Nombre del Instant Form',
  ad_creatives_link: 'Creativos de anuncios',
  booking_calendar_link: 'Calendario de citas',
}

const isLink = (value) => /^https?:\/\//i.test(value || '')
const short = (value) => (value.length > 70 ? `${value.slice(0, 67)}…` : value)
const display = (field, value) => (field === 'daily_budget' && value ? `$${value}` : value)

function Value({ field, value }) {
  if (!value) return <em className="muted">—</em>
  const text = display(field, value)
  return isLink(value)
    ? <a href={value} target="_blank" rel="noreferrer" data-no-translate>{short(text)}</a>
    : <span data-no-translate>{text}</span>
}

export default function DossierSuggestions({ clientId, onApplied, compact = false, className = '' }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const canEdit = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_edit)

  const reload = useCallback(async () => {
    try { setItems(await loadDossierSuggestions(clientId)); setError('') }
    catch (loadError) { setError(t(loadError.message)) }
  }, [clientId, t])
  useEffect(() => { setItems(null); reload() }, [reload])

  const resolve = async (item, apply) => {
    setBusy(item.id); setError('')
    try {
      await resolveDossierSuggestion(item.id, apply)
      await reload()
      if (apply) onApplied?.()
    } catch (resolveError) { setError(t(resolveError.message)) }
    finally { setBusy('') }
  }

  if (!items?.length && !error) return null
  const when = (value) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

  return <section className={`dossier-suggestions ${compact ? 'compact' : ''} ${className}`}>
    <div className="dossier-suggestions-head">
      <h3>📥 {t('Slack sugiere actualizar el dossier')} <small>{items?.length || 0}</small></h3>
      <p className="muted">{t('Datos que el equipo escribió en el canal de Slack del cliente. Revisa y aplica solo los correctos.')}</p>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <ul>{(items || []).map((item) => <li key={item.id}>
      <div className="dossier-suggestion-main">
        <strong>{t(SUGGESTION_FIELDS[item.field] || item.field)}</strong>
        <span className="dossier-suggestion-change">
          <span className="dossier-suggestion-old"><Value field={item.field} value={item.current_value} /></span>
          <span aria-hidden="true">→</span>
          <span className="dossier-suggestion-new"><Value field={item.field} value={item.suggested_value} /></span>
        </span>
        {item.excerpt && <blockquote data-no-translate>{item.excerpt.length > 220 ? `${item.excerpt.slice(0, 217)}…` : item.excerpt}</blockquote>}
        <small>
          <span data-no-translate>{item.slack_user_name || t('Equipo')}</span> · {when(item.created_at)}
          {item.source_url && <> · <a href={item.source_url} target="_blank" rel="noreferrer">{t('Ver en Slack')}</a></>}
        </small>
      </div>
      {canEdit && <div className="dossier-suggestion-actions">
        <button type="button" className="primary-button compact-button" disabled={busy === item.id} onClick={() => resolve(item, true)}>{t('Aplicar')}</button>
        <button type="button" className="secondary-button compact-button" disabled={busy === item.id} onClick={() => resolve(item, false)}>{t('Ignorar')}</button>
      </div>}
    </li>)}</ul>
  </section>
}
