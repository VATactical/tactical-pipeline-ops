import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { loadStatusSignals, resolveStatusSignal } from '../services/opsService'

// What the team or the client said in the client's Slack channel that changes its status:
// campaign launched / paused, payment problem / fixed, or a problem. Nothing changes until someone applies it.
export const SIGNALS = {
  ads_live: { icon: '🚀', label: 'Campaña encendida', action: 'Marcar ADS LIVE', tone: 'good' },
  payment_fixed: { icon: '💳', label: 'Pago resuelto', action: 'Reactivar ADS', tone: 'good' },
  ads_paused: { icon: '⏸', label: 'Campaña pausada', action: 'Pausar ADS', tone: 'warn' },
  payment_error: { icon: '⚠️', label: 'Problema de pago', action: 'Marcar Payment Error', tone: 'bad' },
  problem: { icon: '🚩', label: 'Problema reportado', action: 'Registrar bloqueo', tone: 'bad' },
}
const OUTCOME = {
  applied: 'Aplicado en TP OPS.', already: 'El cliente ya estaba así; alerta cerrada.', dismissed: 'Alerta descartada.',
}

export default function StatusSignals({ clientId = null, onApplied, title, className = '', limit = 20 }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canEdit = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_edit)

  const reload = useCallback(async () => {
    try { setItems(await loadStatusSignals(clientId)); setError('') } catch (loadError) { setError(t(loadError.message)) }
  }, [clientId, t])
  useEffect(() => { reload() }, [reload])

  const resolve = async (item, apply) => {
    setBusy(item.id); setError(''); setNotice('')
    try {
      const outcome = await resolveStatusSignal(item.id, apply)
      setNotice(t(OUTCOME[outcome] || 'Listo.'))
      await reload()
      if (apply) onApplied?.()
    } catch (resolveError) { setError(t(resolveError.message)) } finally { setBusy('') }
  }

  if (!items?.length && !error && !notice) return null
  const when = (value) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

  return <section className={`content-card status-signals ${className}`}>
    <div className="section-heading"><div>
      <p className="eyebrow">{t('Desde Slack')}</p>
      <h3>{t(title || 'Alertas de estado')} <small className="status-signals-count">{items?.length || 0}</small></h3>
      <p className="muted">{t('Lo que se dijo en el canal del cliente y cambia su estado. Confirma para actualizar TP OPS.')}</p>
    </div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    <ul>{(items || []).slice(0, limit).map((item) => {
      const meta = SIGNALS[item.signal] || { icon: '•', label: item.signal, action: 'Aplicar', tone: '' }
      return <li key={item.id} className={`signal-${meta.tone}`}>
        <span className="status-signal-icon" aria-hidden="true">{meta.icon}</span>
        <div className="status-signal-main">
          <strong>{t(meta.label)}{!clientId && item.clients && <> · <Link to={`/clientes/${item.client_id}`} data-no-translate>{item.clients.code} {item.clients.business_name}</Link></>}</strong>
          {item.excerpt && <blockquote data-no-translate>{item.excerpt.length > 240 ? `${item.excerpt.slice(0, 237)}…` : item.excerpt}</blockquote>}
          <small><span data-no-translate>{item.slack_user_name || t('Equipo')}</span> · {when(item.created_at)}
            {item.clients?.status && <> · {t('Estado actual')}: {item.clients.status}</>}
            {item.source_url && <> · <a href={item.source_url} target="_blank" rel="noreferrer">{t('Ver en Slack')}</a></>}</small>
        </div>
        {canEdit && <div className="status-signal-actions">
          <button type="button" className="primary-button compact-button" disabled={busy === item.id} onClick={() => resolve(item, true)}>{t(meta.action)}</button>
          <button type="button" className="secondary-button compact-button" disabled={busy === item.id} onClick={() => resolve(item, false)}>{t('Descartar')}</button>
        </div>}
      </li>
    })}</ul>
  </section>
}
