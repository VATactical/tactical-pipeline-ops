import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { fetchClientGhlRange, isClientGhlTokenConfigured, loadClientGhlMetrics, saveClientGhlToken, syncClientGhlMetrics, updateClient } from '../services/opsService'

const settingsFrom = (client) => ({
  ghl_location_id: client.ghl_location_id || '',
  ghl_qualified_tag: client.ghl_qualified_tag ?? 'qualified',
  ads_launched_on: client.ads_launched_on || '',
  billing_cycle_anchor: client.billing_cycle_anchor || '',
  billing_cycle_days: client.billing_cycle_days || 30,
})

const HISTORY_CYCLES = 6
const toDay = (value) => new Date(`${value}T12:00:00Z`)
const addDays = (value, days) => { const date = toDay(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
const daysBetween = (from, to) => Math.round((toDay(to) - toDay(from)) / 86400000)
const localToday = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

// Same rule as public.client_billing_period: cycles of N days from the anchor, or the last N days.
function currentCycle(anchor, days, today = localToday()) {
  const length = Number(days) || 30
  if (!anchor || anchor > today) return { period_start: addDays(today, -(length - 1)), period_end: today }
  const start = addDays(anchor, Math.floor(daysBetween(anchor, today) / length) * length)
  return { period_start: start, period_end: addDays(start, length - 1) }
}

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
  const [selected, setSelected] = useState('current')
  const [range, setRange] = useState(() => ({ from: addDays(localToday(), -29), to: localToday() }))
  const [rangeResult, setRangeResult] = useState(null)

  const refresh = async () => {
    const [rows, configured] = await Promise.all([loadClientGhlMetrics(client.id), isClientGhlTokenConfigured(client.id)])
    setMetrics(rows)
    setTokenConfigured(configured)
  }
  useEffect(() => { refresh().catch((loadError) => setError(t(loadError.message))) }, [client.id])
  useEffect(() => { setSettings(settingsFrom(client)) }, [client])

  const anchor = client.billing_cycle_anchor
  const cycleDays = Number(client.billing_cycle_days) || 30
  const cycle = currentCycle(anchor, cycleDays)
  // Only rows that line up with the configured billing cycle count as history.
  const cycles = anchor
    ? metrics.filter((row) => row.period_start >= anchor && daysBetween(anchor, row.period_start) % cycleDays === 0)
    : metrics.filter((row) => row.period_start === cycle.period_start)
  const current = cycles.find((row) => row.period_start === cycle.period_start)
  const previous = cycles.filter((row) => row.period_start < cycle.period_start)
  const shown = selected === 'current' ? current : selected === 'custom' ? rangeResult : previous.find((row) => row.period_start === selected)
  const shownPeriod = selected === 'current' ? cycle : shown
  const connected = Boolean(client.ghl_location_id) && tokenConfigured
  const formatDate = (value) => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—'
  const daysToRebill = anchor ? daysBetween(localToday(), cycle.period_end) + 1 : null
  const bookingRate = shown?.leads ? Math.round((shown.appointments_booked / shown.leads) * 100) : null

  const sync = async (history = 1) => {
    setBusy(history > 1 ? 'history' : 'sync'); setError(''); setMessage('')
    try {
      const result = await syncClientGhlMetrics(client.id, history > 1 ? { history } : {})
      await refresh()
      const failure = result?.results?.find((item) => item.status === 'error')
      if (failure) setError(failure.error)
      else setMessage(history > 1 ? `${t('Historial actualizado')}: ${result?.synced ?? 0} ${t('ciclos')}.` : t('Métricas de GHL actualizadas.'))
    } catch (syncError) { setError(t(syncError.message)) }
    finally { setBusy('') }
  }

  const queryRange = async (event) => {
    event.preventDefault(); setBusy('range'); setError(''); setMessage(''); setRangeResult(null)
    try { setRangeResult(await fetchClientGhlRange(client.id, range.from, range.to)) }
    catch (rangeError) { setError(t(rangeError.message)) }
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
        <p className="muted">{shownPeriod ? `${formatDate(shownPeriod.period_start)} — ${formatDate(shownPeriod.period_end)}` : t('Elige las fechas y consulta.')}</p>
      </div>
      <div className="section-actions">
        <span className={`credential-state ${connected ? '' : 'pending'}`}>{connected ? t('Conectado') : t('Sin conectar')}</span>
        {canEdit && <button className="text-button" type="button" onClick={() => setSettingsOpen((open) => !open)}>{t(settingsOpen ? 'Cancelar' : 'Configurar')}</button>}
        <button className="primary-button compact-button" type="button" disabled={!connected || Boolean(busy)} onClick={() => sync()}>{t(busy === 'sync' ? 'Sincronizando…' : 'Sincronizar GHL')}</button>
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

    <div className="ghl-period-bar">
      <div className="status-tabs ghl-period-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={selected === 'current'} className={selected === 'current' ? 'active' : ''} onClick={() => setSelected('current')}>{t('Ciclo actual')}</button>
        {previous.length > 0 && <select aria-label={t('Ciclos anteriores')} value={previous.some((row) => row.period_start === selected) ? selected : ''} onChange={(e) => e.target.value && setSelected(e.target.value)}>
          <option value="">{t('Ciclos anteriores')}</option>
          {previous.map((row) => <option key={row.period_start} value={row.period_start}>{`${formatDate(row.period_start)} — ${formatDate(row.period_end)}`}</option>)}
        </select>}
        <button type="button" role="tab" aria-selected={selected === 'custom'} className={selected === 'custom' ? 'active' : ''} onClick={() => setSelected('custom')}>{t('Rango de fechas')}</button>
      </div>
      {connected && <button className="secondary-button compact-button" type="button" disabled={!anchor || Boolean(busy)} title={anchor ? '' : t('Configura el inicio del ciclo de cobro para traer el historial')} onClick={() => sync(HISTORY_CYCLES)}>{t(busy === 'history' ? 'Trayendo historial…' : 'Traer historial (6 ciclos)')}</button>}
    </div>
    {!anchor && <p className="muted ghl-period-hint">{t('Sin fecha de inicio del ciclo de cobro se usan los últimos 30 días y no hay historial por ciclos.')}</p>}
    {selected === 'custom' && <form className="ghl-range-form" onSubmit={queryRange}>
      <label>{t('Desde')}<input type="date" value={range.from} max={range.to} onChange={(e) => setRange((state) => ({ ...state, from: e.target.value }))} required /></label>
      <label>{t('Hasta')}<input type="date" value={range.to} min={range.from} onChange={(e) => setRange((state) => ({ ...state, to: e.target.value }))} required /></label>
      <button className="primary-button compact-button" disabled={!connected || Boolean(busy)}>{t(busy === 'range' ? 'Consultando…' : 'Consultar en GHL')}</button>
    </form>}

    <div className="metric-grid compact ads-metrics-grid">
      <article className="metric-card green"><span>{t('Leads')}</span><strong>{shown?.leads ?? '—'}</strong><small>{t('registrados en GHL')}</small></article>
      <article className="metric-card teal"><span>{t('Calificados')}</span><strong>{shown?.qualified_leads ?? '—'}</strong><small data-no-translate>{client.ghl_qualified_tag ? `#${client.ghl_qualified_tag}` : ''}</small></article>
      <article className="metric-card amber"><span>{t('Citas')}</span><strong>{shown?.appointments_booked ?? '—'}</strong><small>{bookingRate !== null ? `${bookingRate}% ${t('de los leads')}` : t('agendadas')}{shown?.appointments_cancelled ? ` · ${shown.appointments_cancelled} ${t('canceladas')}` : ''}</small></article>
      {selected === 'current'
        ? <article className={`metric-card ${daysToRebill !== null && daysToRebill <= 5 ? 'red' : 'blue'}`}><span>{t('Próximo cobro')}</span><strong>{daysToRebill === null ? '—' : daysToRebill}</strong><small>{anchor ? `${t('días')} · ${formatDate(addDays(cycle.period_end, 1))}` : t('falta la fecha de inicio del ciclo')}</small></article>
        : <article className="metric-card purple"><span>{t('Tasa de calificados')}</span><strong>{shown?.leads ? `${Math.round((shown.qualified_leads / shown.leads) * 100)}%` : '—'}</strong><small>{t('de los leads del periodo')}</small></article>}
    </div>
    {selected === 'custom'
      ? rangeResult && <p className="muted">{t('Consulta en vivo; no se guarda en el historial.')}</p>
      : shown ? <p className="muted">{t('Última sincronización')}: {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(shown.synced_at))}{shown.sync_status === 'error' ? ` · ${t('con error')}` : ''}</p>
        : <p className="muted">{t('Este ciclo todavía no se ha sincronizado.')}</p>}
  </section>
}
