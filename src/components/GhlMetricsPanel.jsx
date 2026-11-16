import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { isClientGhlTokenConfigured, loadClientGhlMetrics, saveClientGhlToken, syncClientGhlMetrics, updateClient } from '../services/opsService'

const settingsFrom = (client) => ({
  ghl_location_id: client.ghl_location_id || '',
  ghl_qualified_tag: client.ghl_qualified_tag ?? 'qualified',
  ads_launched_on: client.ads_launched_on || '',
  billing_cycle_anchor: client.billing_cycle_anchor || '',
  billing_cycle_days: client.billing_cycle_days || 30,
})

export default function GhlMetricsPanel({ client, canEdit, onClientUpdated }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const canManageToken = profile?.role === 'superadmin'
  const [metrics, setMetrics] = useState([])
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(() => settingsFrom(client))
  const [tokenDraft, setTokenDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = async () => {
    const [rows, configured] = await Promise.all([loadClientGhlMetrics(client.id), isClientGhlTokenConfigured(client.id)])
    setMetrics(rows)
    setTokenConfigured(configured)
  }
  useEffect(() => { refresh().catch((loadError) => setError(t(loadError.message))) }, [client.id])
  useEffect(() => { setSettings(settingsFrom(client)) }, [client])

  const current = metrics[0]
  const connected = Boolean(client.ghl_location_id) && tokenConfigured
  const formatDate = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—'
  const daysToRebill = current ? Math.ceil((new Date(`${current.period_end}T23:59:59`) - new Date()) / 86400000) : null

  const sync = async () => {
    setBusy('sync'); setError(''); setMessage('')
    try {
      const result = await syncClientGhlMetrics(client.id)
      await refresh()
      const failure = result?.results?.find((item) => item.status === 'error')
      if (failure) setError(failure.error)
      else setMessage(t('Métricas de GHL actualizadas.'))
    } catch (syncError) { setError(t(syncError.message)) }
    finally { setBusy('') }
  }

  const saveSettings = async (event) => {
    event.preventDefault(); setBusy('settings'); setError(''); setMessage('')
    try {
      const updated = await updateClient(client.id, {
        ghl_location_id: settings.ghl_location_id.trim() || null,
        ghl_qualified_tag: settings.ghl_qualified_tag.trim(),
        ads_launched_on: settings.ads_launched_on || null,
        billing_cycle_anchor: settings.billing_cycle_anchor || null,
        billing_cycle_days: Number(settings.billing_cycle_days) || 30,
      })
      if (canManageToken && tokenDraft.trim()) {
        await saveClientGhlToken(client.id, tokenDraft)
        setTokenDraft('')
      }
      onClientUpdated?.(updated)
      await refresh()
      setSettingsOpen(false)
      setMessage(t('Conexión GHL guardada.'))
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setBusy('') }
  }

  const setField = (key, value) => setSettings((state) => ({ ...state, [key]: value }))

  return <section className="content-card ghl-metrics-panel">
    <div className="section-heading">
      <div>
        <p className="eyebrow">GoHighLevel</p>
        <h3>{t('Leads y citas del periodo')}</h3>
        <p className="muted">{current ? `${formatDate(current.period_start)} — ${formatDate(current.period_end)}` : t('Todavía no se ha sincronizado.')}</p>
      </div>
      <div className="section-actions">
        <span className={`credential-state ${connected ? '' : 'pending'}`}>{connected ? t('Conectado') : t('Sin conectar')}</span>
        {canEdit && <button className="text-button" type="button" onClick={() => setSettingsOpen((open) => !open)}>{t(settingsOpen ? 'Cancelar' : 'Configurar')}</button>}
        <button className="primary-button compact-button" type="button" disabled={!connected || busy === 'sync'} onClick={sync}>{t(busy === 'sync' ? 'Sincronizando…' : 'Sincronizar GHL')}</button>
      </div>
    </div>
    {error && <p className="form-error" data-no-translate>{error}</p>}
    {message && <p className="form-success">{message}</p>}

    {settingsOpen && <form className="ads-report-form" onSubmit={saveSettings}>
      <div className="ads-report-grid">
        <label>{t('Location ID de GHL')}<input value={settings.ghl_location_id} onChange={(e) => setField('ghl_location_id', e.target.value)} autoComplete="off" spellCheck="false" /></label>
        <label>{t('Etiqueta de lead calificado')}<input value={settings.ghl_qualified_tag} onChange={(e) => setField('ghl_qualified_tag', e.target.value)} /></label>
        <label>{t('Fecha de lanzamiento ADS')}<input type="date" value={settings.ads_launched_on} onChange={(e) => setField('ads_launched_on', e.target.value)} /></label>
        <label>{t('Inicio del ciclo de cobro')}<input type="date" value={settings.billing_cycle_anchor} onChange={(e) => setField('billing_cycle_anchor', e.target.value)} /></label>
        <label>{t('Días por ciclo')}<input type="number" min="7" max="92" value={settings.billing_cycle_days} onChange={(e) => setField('billing_cycle_days', e.target.value)} /></label>
        {canManageToken && <label className="wide">{t('Token de integración privada (sub-cuenta)')}<input type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} autoComplete="off" spellCheck="false" placeholder={tokenConfigured ? t('Ya hay un token guardado; pega uno nuevo para reemplazarlo') : 'pit-…'} /></label>}
      </div>
      <button className="primary-button compact-button" disabled={busy === 'settings'}>{t(busy === 'settings' ? 'Guardando…' : 'Guardar conexión')}</button>
    </form>}

    <div className="metric-grid compact ads-metrics-grid">
      <article className="metric-card green"><span>{t('Leads')}</span><strong>{current?.leads ?? '—'}</strong><small>{t('registrados en GHL')}</small></article>
      <article className="metric-card teal"><span>{t('Calificados')}</span><strong>{current?.qualified_leads ?? '—'}</strong><small data-no-translate>{client.ghl_qualified_tag ? `#${client.ghl_qualified_tag}` : ''}</small></article>
      <article className="metric-card amber"><span>{t('Citas')}</span><strong>{current?.appointments_booked ?? '—'}</strong><small>{current?.appointments_cancelled ? `${current.appointments_cancelled} ${t('canceladas')}` : t('agendadas')}</small></article>
      <article className={`metric-card ${daysToRebill !== null && daysToRebill <= 5 ? 'red' : 'blue'}`}><span>{t('Próximo cobro')}</span><strong>{daysToRebill === null ? '—' : Math.max(daysToRebill, 0)}</strong><small>{client.billing_cycle_anchor ? t('días restantes') : t('ciclo de 30 días sin fecha base')}</small></article>
    </div>
    {current && <p className="muted">{t('Última sincronización')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(current.synced_at))}{current.sync_status === 'error' ? ` · ${t('con error')}` : ''}</p>}
  </section>
}
