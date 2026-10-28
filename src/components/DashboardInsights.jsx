import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { runWithSessionRetry, supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageContext'

const accessFields = [
  ['facebook_access_confirmed', 'Facebook'],
  ['ad_account_access_confirmed', 'Cuenta de anuncios'],
  ['pixel_access_confirmed', 'Pixel'],
  ['gbp_access_confirmed', 'GBP'],
  ['ghl_access_confirmed', 'GHL'],
  ['domain_access_confirmed', 'Dominio'],
  ['meta_payment_method_confirmed', 'Método de pago Meta'],
  ['payment_method_confirmed', 'Método de pago GHL'],
]

const pendingPattern = /pendiente|pending|confirmar|confirm|verificar|verify|bloquead|rechazad|por definir/i
const isPending = (value) => !value || pendingPattern.test(String(value).trim())

function dateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function dateLabel(value, locale, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, options).format(new Date(`${value}T12:00:00`))
}

function isIanaTimezone(value) {
  if (!value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function dossierIssues(client, t) {
  const issues = []
  const address = String(client.address || '').trim()
  if (isPending(address)) issues.push(t('Dirección pendiente'))
  else if (!/\d/.test(address)) issues.push(t('Verificar dirección'))

  const zip = String(client.target_zip_codes || '').trim()
  const market = String(client.markets || '').trim()
  if (isPending(zip) && isPending(market)) issues.push(t('Zona de servicio pendiente'))
  else if (isPending(zip) || !/\b\d{5}\b/.test(zip)) issues.push(t('Verificar ZIP'))
  if (!isPending(market) && pendingPattern.test(market)) issues.push(t('Verificar zona'))

  if (!client.timezone) issues.push(t('Zona horaria pendiente'))
  else if (!isIanaTimezone(client.timezone)) issues.push(t('Verificar zona horaria'))

  if (isPending(client.services)) issues.push(t('Servicios pendientes'))
  if (isPending(client.offer)) issues.push(t('Oferta pendiente'))
  return [...new Set(issues)]
}

function AccessMark({ value, t }) {
  const state = value === true ? 'confirmed' : value === false ? 'pending' : 'unknown'
  const label = value === true ? t('Confirmado') : value === false ? t('Pendiente') : t('Sin dato')
  const mark = value === true ? '✓' : value === false ? '×' : '—'
  return <span className={`dashboard-access-mark ${state}`} aria-label={label} title={label}>{mark}</span>
}

function AccessMatrix({ clients, t }) {
  return <section className="content-card dashboard-insight-card access-matrix-card">
    <div className="section-heading">
      <div><p className="eyebrow">{t('Control de accesos')}</p><h3>{t('Matriz de accesos')}</h3></div>
      <Link to="/clientes">{t('Abrir clientes')} →</Link>
    </div>
    <div className="dashboard-table-scroll">
      <table className="dashboard-access-table">
        <thead><tr>
          <th>{t('Cliente')}</th><th>{t('Estado')}</th>
          {accessFields.map(([, label]) => <th key={label}>{t(label)}</th>)}
          <th>{t('Progreso')}</th>
        </tr></thead>
        <tbody>{clients.map((client) => {
          const confirmed = accessFields.filter(([key]) => client[key] === true).length
          const percent = Math.round(confirmed / accessFields.length * 100)
          return <tr key={client.id}>
            <td><Link className="dashboard-client-link" to={`/clientes/${client.id}`}><span>{client.code}</span><strong>{client.business_name}</strong></Link></td>
            <td><span className={`dashboard-status ${client.status === 'ADS LIVE' ? 'live' : ''}`}>{t(client.status)}</span></td>
            {accessFields.map(([key, label]) => <td className="dashboard-access-cell" key={key}><AccessMark value={client[key]} t={t} /></td>)}
            <td><div className="dashboard-mini-progress" role="progressbar" aria-label={t('Progreso de accesos')} aria-valuenow={confirmed} aria-valuemin={0} aria-valuemax={accessFields.length}><span style={{ width: `${percent}%` }} /></div><small>{confirmed}/{accessFields.length}</small></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <p className="dashboard-footnote">{t('✓ confirmado · × pendiente · — sin dato')}</p>
  </section>
}

function DossierQuality({ clients, t }) {
  const rows = clients
    .map((client) => ({ client, issues: dossierIssues(client, t) }))
    .filter((row) => row.issues.length)
    .sort((a, b) => b.issues.length - a.issues.length || a.client.code.localeCompare(b.client.code, undefined, { numeric: true }))
    .slice(0, 6)

  return <section className="content-card dashboard-insight-card">
    <div className="section-heading">
      <div><p className="eyebrow">{t('Calidad del dossier')}</p><h3>{t('Datos incompletos o por verificar')}</h3></div>
      <Link to="/clientes">{t('Ver clientes')} →</Link>
    </div>
    <div className="dashboard-issue-list">
      {rows.length === 0 && <p className="complete-note">{t('No hay datos críticos pendientes.')}</p>}
      {rows.map(({ client, issues }) => <Link to={`/clientes/${client.id}`} className="dashboard-issue-row" key={client.id}>
        <span className="dashboard-issue-client"><b>{client.code} · {client.business_name}</b><small>{issues.length} {t(issues.length === 1 ? 'dato por revisar' : 'datos por revisar')}</small></span>
        <span className="dashboard-issue-tags">{issues.slice(0, 3).map((issue) => <i key={issue}>{issue}</i>)}{issues.length > 3 && <i>+{issues.length - 3}</i>}</span>
      </Link>)}
      {rows.length > 0 && <p className="dashboard-footnote">{t('Se revisan dirección, ZIP, zona horaria, servicios y oferta.')}</p>}
    </div>
  </section>
}

function MetaPerformance({ clients, reports, loading, error, locale, timeZone, t }) {
  const fromDate = addDays(dateInZone(new Date(), timeZone), -6)
  const grouped = new Map()
  for (const report of reports) {
    if (report.report_date < fromDate) continue
    const current = grouped.get(report.client_id) || { spend: 0, leads: 0, lastLeadDate: null, lastReportDate: report.report_date }
    current.spend += Number(report.spend || 0)
    current.leads += Number(report.leads || 0)
    if (Number(report.leads || 0) > 0 && (!current.lastLeadDate || report.report_date > current.lastLeadDate)) current.lastLeadDate = report.report_date
    if (report.report_date > current.lastReportDate) current.lastReportDate = report.report_date
    grouped.set(report.client_id, current)
  }
  const rows = clients
    .filter((client) => grouped.has(client.id))
    .map((client) => ({ client, ...grouped.get(client.id) }))
    .sort((a, b) => b.spend - a.spend)

  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  return <section className="content-card dashboard-insight-card">
    <div className="section-heading">
      <div><p className="eyebrow">{t('Meta · últimos 7 días')}</p><h3>{t('Rendimiento por cliente')}</h3></div>
      <Link to="/clientes">{t('Ver clientes')} →</Link>
    </div>
    {error && <p className="dashboard-data-note error">{t('No se pudieron cargar los reportes de Meta.')}</p>}
    {loading && <p className="muted">{t('Cargando reportes…')}</p>}
    {!loading && !error && rows.length === 0 && <div className="dashboard-empty-state"><strong>{t('Aún no hay reportes diarios de Meta.')}</strong><p>{t('El panel mostrará gasto, leads, CPL y último lead cuando se registren reportes.')}</p></div>}
    {!loading && !error && rows.length > 0 && <div className="dashboard-table-scroll">
      <table className="dashboard-performance-table">
        <thead><tr><th>{t('Cliente')}</th><th>{t('Gasto')}</th><th>{t('Leads')}</th><th>{t('CPL')}</th><th>{t('Último lead')}</th></tr></thead>
        <tbody>{rows.map(({ client, spend, leads, lastLeadDate }) => <tr key={client.id}>
          <td><Link className="dashboard-client-link" to={`/clientes/${client.id}`}><span>{client.code}</span><strong>{client.business_name}</strong></Link></td>
          <td>{money.format(spend)}</td><td>{leads}</td><td>{leads ? money.format(spend / leads) : '—'}</td>
          <td>{lastLeadDate ? dateLabel(lastLeadDate, locale) : t('Sin leads registrados')}</td>
        </tr>)}</tbody>
      </table>
      <p className="dashboard-footnote">{t('CPL calculado como gasto total dividido entre leads del periodo.')}</p>
    </div>}
  </section>
}

function StaleClients({ clients, tasks, blockers, t }) {
  const now = Date.now()
  const rows = clients
    .map((client) => ({
      client,
      days: Math.max(0, Math.floor((now - new Date(client.updated_at).getTime()) / 86400000)),
      openTasks: tasks.filter((task) => task.client_id === client.id && task.status !== 'Completada').length,
      openTickets: blockers.filter((blocker) => blocker.client_id === client.id && !blocker.resolved).length,
    }))
    .filter((row) => row.days >= 7)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)

  return <section className="content-card dashboard-insight-card">
    <div className="section-heading">
      <div><p className="eyebrow">{t('Seguimiento')}</p><h3>{t('Clientes sin actualización >7 días')}</h3></div>
      <Link to="/clientes">{t('Abrir pipeline')} →</Link>
    </div>
    <p className="dashboard-data-note">{t('Trello no está sincronizado; mostramos la última actualización del cliente en TP Ops.')}</p>
    <div className="dashboard-stale-list">
      {rows.length === 0 && <p className="complete-note">{t('Todos los clientes tuvieron actividad reciente.')}</p>}
      {rows.map(({ client, days, openTasks, openTickets }) => <Link to={`/clientes/${client.id}`} className="dashboard-stale-row" key={client.id}>
        <span className="dashboard-stale-main"><b>{client.code} · {client.business_name}</b><small>{t(client.status)} · {client.phase || t('Sin etapa')} · {openTasks} {t('tareas abiertas')} · {openTickets} {t('tickets abiertos')}</small></span>
        <span className={`dashboard-age ${days >= 14 ? 'critical' : ''}`}>{days} {t('días')}</span>
      </Link>)}
    </div>
  </section>
}

export default function DashboardInsights({ clients = [], tasks = [], blockers = [], timeZone = 'America/Managua' }) {
  const { locale, t } = useLanguage()
  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [reportsError, setReportsError] = useState('')
  const clientIds = useMemo(() => clients.map((client) => client.id).join(','), [clients])
  const today = dateInZone(new Date(), timeZone)
  const dateFrom = addDays(today, -6)
  const accessIncomplete = clients.filter((client) => accessFields.some(([key]) => client[key] !== true)).length
  const dossierIncomplete = clients.filter((client) => dossierIssues(client, t).length > 0).length
  const adsLive = clients.filter((client) => client.status === 'ADS LIVE')
  const reportCutoff = addDays(today, -2)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setReportsLoading(true)
      setReportsError('')
      if (!clientIds) {
        setReports([])
        setReportsLoading(false)
        return
      }
      try {
        const ids = clientIds.split(',')
        const { data, error } = await runWithSessionRetry(() => supabase
          .from('ad_performance_reports')
          .select('client_id, report_date, spend, leads')
          .in('client_id', ids)
          .gte('report_date', dateFrom)
          .lte('report_date', today)
          .order('report_date', { ascending: false }))
        if (error) throw error
        if (!cancelled) setReports(data || [])
      } catch (loadError) {
        if (!cancelled) setReportsError(loadError.message || 'No se pudieron cargar los reportes de Meta.')
      } finally {
        if (!cancelled) setReportsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [clientIds, dateFrom, today])

  const performanceByClient = useMemo(() => {
    const grouped = new Map()
    for (const report of reports) {
      if (report.report_date < reportCutoff) continue
      const dates = grouped.get(report.client_id) || new Map()
      if (!dates.has(report.report_date)) dates.set(report.report_date, [])
      dates.get(report.report_date).push(report)
      grouped.set(report.client_id, dates)
    }
    return grouped
  }, [reports, reportCutoff])

  const coveredCampaigns = adsLive.filter((client) => {
    const dates = performanceByClient.get(client.id)
    return [-2, -1, 0].every((offset) => dates?.has(addDays(today, offset)))
  })
  const campaignsWithNoLeads = coveredCampaigns.filter((client) => {
    const dates = performanceByClient.get(client.id)
    return [-2, -1, 0].every((offset) => {
      const dailyReports = dates.get(addDays(today, offset))
      return dailyReports.reduce((sum, report) => sum + Number(report.leads || 0), 0) === 0
    })
  })
  const campaignsWithoutReport = adsLive.filter((client) => !reports.some((report) => report.client_id === client.id && report.report_date >= reportCutoff))
  const staleCount = clients.filter((client) => Date.now() - new Date(client.updated_at).getTime() >= 7 * 86400000).length

  return <section className="dashboard-insights page-stack">
    <div className="dashboard-insight-metrics">
      <article className="metric-card blue"><span>{t('Accesos incompletos')}</span><strong>{accessIncomplete}/{clients.length}</strong><small>{t('clientes con al menos un acceso pendiente')}</small></article>
      <article className="metric-card amber"><span>{t('Dossier con alertas')}</span><strong>{dossierIncomplete}</strong><small>{t('dirección, ZIP, zona horaria, oferta')}</small></article>
      <article className="metric-card red"><span>{t('Campañas en riesgo')}</span><strong>{coveredCampaigns.length ? campaignsWithNoLeads.length : '—'}</strong><small>{campaignsWithoutReport.length} {t('ADS LIVE sin reporte de los últimos 3 días')} · {adsLive.length - coveredCampaigns.length} {t('sin datos suficientes')}</small></article>
      <article className="metric-card teal"><span>{t('Seguimiento atrasado')}</span><strong>{staleCount}</strong><small>{t('clientes sin actualización >7 días')}</small></article>
    </div>
    <div className="dashboard-insight-grid">
      <AccessMatrix clients={clients} t={t} />
      <DossierQuality clients={clients} t={t} />
      <MetaPerformance clients={clients} reports={reports} loading={reportsLoading} error={Boolean(reportsError)} locale={locale} timeZone={timeZone} t={t} />
      <StaleClients clients={clients} tasks={tasks} blockers={blockers} t={t} />
    </div>
  </section>
}
