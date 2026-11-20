import LinkifiedText from '../components/LinkifiedText'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { ClientLogFeed, FocusStrip, TicketWatch, isOpenTicket, recentBlockedComments } from '../components/DashboardFocus'
import { ChartCard, ColumnChart, HBarChart, SERIES, StatRow } from '../components/DashboardCharts'
import { useLanguage } from '../i18n/LanguageContext'
import { downloadCommunicationsPdf } from '../lib/reportExports'
import { loadCompanySettings } from '../services/companyService'
import { loadOwnEodState } from '../services/eodService'
import { loadTicketWorkspace } from '../services/ticketService'
import {
  createTeamNote,
  loadDashboardExtras,
  loadOperations,
  markGeneralNoteSeen,
  subscribeToOperations,
} from '../services/opsService'

const ticketStatusLabels = { Open: 'Abierto', 'In progress': 'En progreso', Waiting: 'Esperando', Resolved: 'Resuelto', Closed: 'Cerrado' }
const slackChannels = [
  ['#announcements', 'Anuncios generales'],
  ['#daily-comms-hub', 'Comunicación diaria'],
  ['#active-projects', 'Proyectos activos'],
  ['#client-ops', 'Operaciones de clientes'],
  ['#eod-reports', 'Reportes EOD'],
]
const isStale = (client) => Date.now() - new Date(client.updated_at).getTime() > 3 * 86400000
const launchOverdue = (client) => client.target_launch_date && !['ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL'].includes(client.status) && new Date(`${client.target_launch_date}T23:59:59`) < new Date()
const dossierFields = [
  'legal_name', 'owner_name', 'phone', 'email', 'address', 'target_zip_codes', 'legal_business_info',
  'services', 'offer', 'domain', 'website_url', 'gbp_status', 'onboarding_date', 'target_launch_date',
  'ad_strategy', 'ghl_subaccount_link', 'drive_folder_link', 'facebook_business_info', 'meta_assets_info',
  'retell_agent_id', 'make_scenario_link', 'slack_channel_link',
]
const isMissing = (value) => !value || /pendiente|confirmar|verificar|bloquead|rechazad/i.test(String(value))

function ClientStatusCards({ clients }) {
  const { t } = useLanguage()
  const counts = clients.reduce((total, client) => ({ ...total, [client.status]: (total[client.status] || 0) + 1 }), {})
  return <section className="metric-grid status-metrics" aria-label="Clientes por estado"><article className="metric-card blue"><span>Onboarding</span><strong>{counts.ONBOARDING || 0}</strong><small>de {clients.length} clientes</small></article><article className="metric-card amber"><span>A2P Submitted</span><strong>{counts['A2P SUBMITTED'] || 0}</strong><small>verificación enviada</small></article><article className="metric-card green"><span>Ads Live</span><strong>{counts['ADS LIVE'] || 0}</strong><small>campañas activas</small></article><article className="metric-card purple"><span>Ads Paused</span><strong>{counts['ADS PAUSED'] || 0}</strong><small>campañas pausadas</small></article><article className="metric-card teal"><span>{t('Cruise Control')}</span><strong>{counts['CRUISE CONTROL'] || 0}</strong><small>{t('Operación estable')}</small></article></section>
}

function AdminComposer({ clients, onCreated }) {
  const initial = { type: 'general_note', clientId: '', title: '', body: '', slackChannel: '#daily-comms-hub' }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const needsClient = form.type === 'client_note'

  const submit = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || (needsClient && !form.clientId)) return
    setSaving(true); setError('')
    try {
      await createTeamNote({ clientId: needsClient ? form.clientId : null, title: form.title, body: form.body, slackChannel: form.slackChannel })
      setForm(initial)
      onCreated('Nota guardada.')
    } catch (submitError) { setError(submitError.message) }
    finally { setSaving(false) }
  }

  return (
    <section className="content-card admin-composer">
      <div className="section-heading"><div><p className="eyebrow">Nueva nota</p><h3>Notas del equipo</h3></div><span className="muted">Los tickets se gestionan en Tickets</span></div>
      <form onSubmit={submit}>
        <div className="entry-type" role="group" aria-label="Tipo de actualización">
          {[['general_note', 'Nota general'], ['client_note', 'Nota de cliente']].map(([value, label]) => (
            <button className={form.type === value ? 'active' : ''} type="button" onClick={() => setField('type', value)} key={value}>{label}</button>
          ))}
        </div>
        <div className="composer-grid">
          {needsClient && <label>Cliente<select value={form.clientId} onChange={(event) => setField('clientId', event.target.value)} required><option value="">Seleccionar cliente…</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.business_name}</option>)}</select></label>}
          <label>Canal Slack<select value={form.slackChannel} onChange={(event) => setField('slackChannel', event.target.value)}>{slackChannels.map(([value, label]) => <option value={value} key={value}>{value} · {label}</option>)}</select></label>
          <label className="wide">Título<input value={form.title} onChange={(event) => setField('title', event.target.value)} maxLength="160" required placeholder="Título de la nota" /></label>
          <label className="wide">Detalle<textarea value={form.body} onChange={(event) => setField('body', event.target.value)} rows="3" maxLength="5000" placeholder="Contexto, instrucciones o información adicional…" /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button compact-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar nota'}</button>
      </form>
    </section>
  )
}

function GeneralNotes({ notes, members, profile, onUpdated }) {
  const { locale, t } = useLanguage()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const general = notes.filter((note) => !note.client_id)
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  const active = general.filter((note) => !note.receipt || new Date(note.receipt.visible_until).getTime() > clock)
  const history = general.filter((note) => note.receipt && new Date(note.receipt.visible_until).getTime() <= clock)
  const visible = historyOpen ? history : active.slice(0, 8)
  const markSeen = async (note) => {
    setBusy(`seen-${note.id}`); setError('')
    try { await markGeneralNoteSeen(note.id, profile.id); await onUpdated() }
    catch (actionError) { setError(t(actionError.message)) }
    finally { setBusy('') }
  }
  const exportPdf = async () => {
    try { await downloadCommunicationsPdf({ notes: general, viewerName: profile.full_name, company: await loadCompanySettings() }) }
    catch (exportError) { setError(t(exportError.message)) }
  }
  if (!general.length) return null
  return <section className="content-card communications-card"><div className="section-heading"><div><p className="eyebrow">{t('Comunicaciones')}</p><h3>{t(historyOpen ? 'Historial de notas' : 'Notas generales')}</h3><p className="muted">{t('Después de marcar una nota como vista permanecerá aquí durante 24 horas.')}</p></div><div className="section-actions"><button className="secondary-button" type="button" onClick={exportPdf}>{t('Exportar notas PDF')}</button><button className="text-button" type="button" onClick={() => setHistoryOpen((current) => !current)}>{historyOpen ? t('Ver activas') : `${t('Historial')} (${history.length})`}</button></div></div>{error && <p className="form-error">{error}</p>}<div className="note-list">{visible.length === 0 && <p className="muted">{t(historyOpen ? 'No hay notas en el historial.' : 'No hay comunicaciones activas.')}</p>}{visible.map((note) => <article className="note-card communication-note" key={note.id}><div><strong data-no-translate>{note.title}</strong>{note.receipt && !historyOpen && <span className="seen-badge">{t('Visto · visible 24 h')}</span>}</div>{note.body && <LinkifiedText text={note.body} className="formatted-text" />}<small><span data-no-translate>{note.author?.full_name || t('Equipo')}</span> · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small><div className="communication-actions">{!historyOpen && !note.receipt && <button className="secondary-button" type="button" disabled={busy === `seen-${note.id}`} onClick={() => markSeen(note)}>{t(busy === `seen-${note.id}` ? 'Guardando…' : 'Marcar como visto')}</button>}<Link to="/tickets">{t('Seguimiento de tickets')}</Link></div></article>)}</div></section>
}


function attentionReasons({ client, missingCount, clientBlockers, openTickets, blockedComments, suggestions }) {
  const reasons = []
  if (client.status === 'ADS PAUSED') reasons.push(['danger', client.ads_pause_reason ? `⏸ ADS pausados: ${client.ads_pause_reason}` : '⏸ ADS pausados'])
  if (blockedComments) reasons.push(['danger', `⛔ ${blockedComments} bloqueo(s) en bitácora`])
  if (clientBlockers) reasons.push(['danger', `${clientBlockers} bloqueo(s) abiertos`])
  if (launchOverdue(client)) reasons.push(['warning', '⏰ Deadline ADS vencido'])
  if (openTickets) reasons.push(['info', `🎫 ${openTickets} ticket(s)`])
  if (suggestions) reasons.push(['slack', `📥 ${suggestions} dato(s) de Slack`])
  if (!client.intake_form_completed) reasons.push(['muted', 'Formulario pendiente'])
  else if (missingCount > 0) reasons.push(['muted', `${missingCount} campos del dossier`])
  return reasons
}

const LIVE_STATUSES = new Set(['ADS LIVE', 'ADS PAUSED', 'CRUISE CONTROL'])
const shortDate = (date, locale) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)
const mondayOf = (date) => { const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day }

// Chart data shared by both dashboards.
function useDashboardCharts(data, extras, locale) {
  return useMemo(() => {
    const clients = data.clients
    // Leads and appointments in the latest 30-day GHL window, per client with ads.
    const leadRows = clients
      .filter((client) => extras.metrics.has(client.id))
      .map((client) => { const row = extras.metrics.get(client.id); return { label: `${client.code} · ${client.business_name}`, title: `${row.period_start} → ${row.period_end}`, values: [row.leads || 0, row.appointments_booked || 0] } })
      .filter((row) => row.values[0] || row.values[1])
      .sort((a, b) => b.values[0] - a.values[0])
    const leads = leadRows.reduce((sum, row) => sum + row.values[0], 0)
    const appointments = leadRows.reduce((sum, row) => sum + row.values[1], 0)
    // Clients per lifecycle stage, in board order.
    const stageRows = extras.stages.map((stage) => ({
      label: locale.startsWith('en') && stage.name_en ? stage.name_en : stage.name,
      values: [clients.filter((client) => client.board_stage === stage.key).length],
    })).filter((row) => row.values[0] > 0)
    // Tickets opened vs resolved per week (last 8 weeks).
    const thisMonday = mondayOf(new Date())
    const weeks = Array.from({ length: 8 }, (_, index) => { const start = new Date(thisMonday); start.setUTCDate(start.getUTCDate() - 7 * (7 - index)); return start })
    const weekIndex = (value) => { const time = new Date(value).getTime(); for (let index = weeks.length - 1; index >= 0; index -= 1) if (time >= weeks[index].getTime()) return index; return -1 }
    const ticketWeeks = weeks.map((start) => ({ label: shortDate(start, locale), title: `${shortDate(start, locale)} – ${shortDate(new Date(start.getTime() + 6 * 86400000), locale)}`, values: [0, 0] }))
    for (const ticket of data.tickets) {
      const opened = weekIndex(ticket.created_at)
      if (opened >= 0) ticketWeeks[opened].values[0] += 1
      if (!isOpenTicket(ticket) && ticket.resolved_at) { const closed = weekIndex(ticket.resolved_at); if (closed >= 0) ticketWeeks[closed].values[1] += 1 }
    }
    // Client log per day (last 14 days): updates, blockers, done.
    const days = Array.from({ length: 14 }, (_, index) => { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (13 - index)); return day })
    const logDays = days.map((day) => ({ label: String(day.getDate()), title: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(day), values: [0, 0, 0] }))
    const order = { update: 0, blocked: 1, done: 2 }
    for (const comment of extras.comments) {
      const created = new Date(comment.created_at); created.setHours(0, 0, 0, 0)
      const index = days.findIndex((day) => day.getTime() === created.getTime())
      if (index >= 0) logDays[index].values[order[comment.kind] ?? 0] += 1
    }
    // Checklist progress of clients that are not live yet.
    const progressRows = clients.filter((client) => !LIVE_STATUSES.has(client.status)).map((client) => {
      const steps = data.workflowSteps.filter((step) => step.client_id === client.id)
      const done = steps.filter((step) => step.completed).length
      return { label: `${client.code} · ${client.business_name}`, values: [steps.length ? Math.round((done / steps.length) * 100) : 0], title: `${done}/${steps.length}` }
    }).sort((a, b) => b.values[0] - a.values[0])
    return { leadRows, leads, appointments, stageRows, ticketWeeks, logDays, progressRows }
  }, [data, extras, locale])
}

function EodReminder({ eodState }) {
  const { t } = useLanguage()
  if (!eodState?.required) return null
  const missing = eodState.missingHours || []
  if (eodState.submitted && missing.length) {
    return <section className="eod-reminder eod-reminder-hours" role="status">
      <span aria-hidden="true">⏱️</span>
      <div><strong>{missing.length === 1 ? t('Tu EOD del {date} se guardó desde Slack, pero faltan las horas.').replace('{date}', missing[0].reportDate) : t('Tienes {n} EOD guardados desde Slack sin horas.').replace('{n}', missing.length)}</strong><p>{t('Agrega el tiempo de cada actividad en TP OPS.')}</p></div>
      <Link className="primary-button compact-button" to={`/eod-reports?report=${missing[0].id}`}>{t('Agregar horas')}</Link>
    </section>
  }
  if (eodState.submitted) return null
  return <section className="eod-reminder" role="alert">
    <span aria-hidden="true">📝</span>
    <div><strong>{t('Aún no has enviado tu EOD de hoy.')}</strong><p>{t('El día del EOD se cuenta en hora EST (Estados Unidos). Escríbelo en TP OPS o, si ya lo publicaste en #eod-reports, usa “Send to TP OPS” en el mensaje.')}</p></div>
    <Link className="primary-button compact-button" to="/eod-reports">{t('Enviar EOD')}</Link>
  </section>
}

// EST (the team's reference time for EODs) and the user's own time, updated every 30 seconds.
function DualClock({ timeZone }) {
  const { t, locale } = useLanguage()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(timer) }, [])
  const ownZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const format = (zone) => new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit', weekday: 'short' }).format(now)
  const place = (zone) => zone.split('/').pop().replaceAll('_', ' ')
  const sameTime = format('America/New_York') === format(ownZone)
  return <div className="dual-clock" aria-label={t('Hora')}>
    <span><small>{t('Hora EST (EOD)')}</small><strong>{format('America/New_York')}</strong></span>
    {!sameTime && <span><small>{t('Tu hora')} · <span data-no-translate>{place(ownZone)}</span></small><strong>{format(ownZone)}</strong></span>}
  </div>
}

function DashboardChartsGrid({ charts }) {
  return <>
    <section className="dashboard-charts">
      <ChartCard eyebrow="Resultados" title="Leads y citas por cliente" subtitle="Últimos 30 días en GHL">
        <HBarChart rows={charts.leadRows} series={[{ name: 'Leads', color: SERIES.blue }, { name: 'Citas', color: SERIES.orange }]} empty="Aún no hay métricas de GHL." />
      </ChartCard>
      <ChartCard eyebrow="Ciclo de vida" title="Clientes por etapa" action={<Link to="/ciclo">Ciclo de vida</Link>}>
        <HBarChart rows={charts.stageRows} series={[{ name: 'Clientes', color: SERIES.blue }]} />
      </ChartCard>
    </section>
    <section className="dashboard-charts">
      <ChartCard eyebrow="Tickets" title="Tickets por semana" subtitle="Abiertos y resueltos, últimas 8 semanas" action={<Link to="/tickets">Tickets</Link>}>
        <ColumnChart columns={charts.ticketWeeks} series={[{ name: 'Abiertos', color: SERIES.orange }, { name: 'Resueltos', color: SERIES.blue }]} />
      </ChartCard>
      <ChartCard eyebrow="Bitácora" title="Avances y bloqueos" subtitle="Comentarios por día, últimos 14 días">
        <ColumnChart columns={charts.logDays} series={[{ name: 'Avances', color: SERIES.blue }, { name: 'Bloqueos', color: SERIES.orange }, { name: 'Hechos', color: SERIES.aqua }]} stacked />
      </ChartCard>
    </section>
  </>
}

function SuperadminDashboard({ data, blockers, extras, profile, eodState }) {
  const { locale, t } = useLanguage()
  const members = new Map((data.directory || []).map((member) => [member.id, member]))
  const charts = useDashboardCharts(data, extras, locale)
  const blockedComments = recentBlockedComments(extras.comments)
  const openTicketList = data.tickets.filter(isOpenTicket)
  const clientSummaries = data.clients.map((client) => {
    const missingCount = dossierFields.filter((key) => isMissing(client[key])).length
    const openTickets = openTicketList.filter((ticket) => ticket.clients?.some((link) => link.id === client.id && !link.resolvedAt)).length
    const clientBlockers = blockers.filter((blocker) => blocker.client_id === client.id).length
    const pendingSteps = data.workflowSteps.filter((step) => step.client_id === client.id && !step.completed)
    return {
      client, missingCount, openTickets, clientBlockers, pendingSteps,
      blockedComments: blockedComments.filter((comment) => comment.client_id === client.id).length,
      suggestions: extras.suggestions.filter((item) => item.client_id === client.id).length,
    }
  })
  const incomplete = clientSummaries.filter((item) => item.missingCount > 0).length
  const urgent = openTicketList.filter((ticket) => ticket.priority === 'Urgent').length
  const live = data.clients.filter((client) => client.status === 'ADS LIVE').length
  const paused = data.clients.filter((client) => client.status === 'ADS PAUSED').length
  const onboarding = data.clients.filter((client) => !LIVE_STATUSES.has(client.status)).length
  const score = (item) => (item.blockedComments || item.clientBlockers ? 40 : 0) + (item.client.status === 'ADS PAUSED' ? 30 : 0) + (launchOverdue(item.client) ? 20 : 0)
    + item.openTickets * 3 + item.suggestions * 2 + (item.client.intake_form_completed ? 0 : 1)
  const attentionQueue = clientSummaries.filter((item) => score(item) > 0 || item.missingCount > 0)
    .sort((a, b) => score(b) - score(a) || b.missingCount - a.missingCount)
    .slice(0, 7)
  const stats = [
    { label: 'Clientes activos', value: data.clients.length, hint: `${live} ADS LIVE · ${paused} pausados · ${onboarding} en onboarding` },
    { label: 'Leads (30 días)', value: charts.leads, hint: `${charts.appointments} citas agendadas` },
    { label: 'Tickets abiertos', value: openTicketList.length, hint: urgent ? `${urgent} urgente(s)` : 'Slack y TP OPS' },
    { label: 'Bloqueos (7 días)', value: blockedComments.length + blockers.length, hint: 'Bitácora y bloqueos abiertos' },
  ]

  return <>
    <EodReminder eodState={eodState} />
    <StatRow stats={stats} />
    <DashboardChartsGrid charts={charts} />
    <section className="dashboard-charts">
      <ChartCard eyebrow="Checklist" title="Avance de clientes en onboarding" subtitle="Porcentaje del checklist completado">
        <HBarChart rows={charts.progressRows} series={[{ name: 'Avance', color: SERIES.aqua }]} suffix="%" max={100} empty="No hay clientes en onboarding." />
      </ChartCard>
      <div className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Prioridad ejecutiva')}</p><h3>{t('Clientes que requieren atención')}</h3></div><Link to="/ciclo">{t('Ciclo de vida')}</Link></div><div className="attention-list">{attentionQueue.length === 0 && <p className="complete-note">{t('No hay alertas críticas.')}</p>}{attentionQueue.map((item) => <Link to={`/clientes/${item.client.id}`} className="attention-row" key={item.client.id}><div><strong data-no-translate>{item.client.code} · {item.client.business_name}</strong><span className="attention-reasons">{attentionReasons(item).slice(0, 4).map(([tone, text]) => <em key={text} className={`attention-chip ${tone}`}>{t(text)}</em>)}</span></div><span>→</span></Link>)}</div></div>
    </section>
    <section className="dashboard-grid">
      <ClientLogFeed comments={extras.comments} clients={data.clients} members={members} />
      <TicketWatch tickets={data.tickets} members={members} />
    </section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">EOD del equipo</p><h3>Últimos informes</h3></div><Link to="/eod-reports">Abrir historial</Link></div><div className="report-list">{data.eodReports.length === 0 && <p className="muted">Aún no hay informes.</p>}{data.eodReports.slice(0, 4).map((report) => <article className="report-card" key={report.id}><div><strong>{report.profiles?.full_name || 'Usuario'}</strong><small>{report.report_date}</small></div><p>{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades reportadas</p></article>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Actividad del equipo</p><h3>Actualizaciones operativas</h3></div></div><div className="activity-list">{data.activity.filter((item) => item.entity_type !== 'tasks' && item.entity_type !== 'calendar_events').slice(0, 8).map((item) => <article className="activity-row" key={item.id}><div><strong data-no-translate>{item.actor_name}</strong><p>{t(item.action === 'insert' ? 'creó' : item.action === 'update' ? 'actualizó' : 'eliminó')} {t(item.entity_type === 'clients' ? 'un cliente' : item.entity_type === 'notes' ? 'una nota' : 'un registro operativo')}</p></div><small>{new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</small></article>)}</div></section>
    <section className="content-card"><div className="dossier-meta"><span>{data.clients.length} {t('clientes totales')}</span><span>{incomplete} {t('dossiers incompletos')}</span><span className={blockers.length ? 'danger-text' : ''}>{new Set(blockers.map((item) => item.client_id)).size} {t('clientes bloqueados')}</span></div></section>
    <details className="client-grid-toggle">
      <summary className="section-heading"><div><p className="eyebrow">{t('Control por cliente')}</p><h3>{t('Seguimiento por cliente')} <small>({data.clients.length})</small></h3></div><span className="text-button">{t('Mostrar / ocultar')}</span></summary>
      <div className="dossier-grid">{clientSummaries.map(({ client, openTickets, clientBlockers, pendingSteps }) => <Link className={`dossier-card ${clientBlockers || client.status === 'ADS PAUSED' ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
        <div className="client-card-top"><div><span className="client-code">{client.code}</span><h3>{client.business_name}</h3></div><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
        <div className="dossier-meta"><span>{t(client.phase)}</span><span>{openTickets} tickets abiertos</span>{client.status === 'ADS PAUSED' && <span className="pause-text">ADS pausados · {client.ads_pause_reason}</span>}{clientBlockers > 0 && <span className="danger-text">{clientBlockers} bloqueo{clientBlockers === 1 ? '' : 's'}</span>}</div>
        <div className="process-pending"><strong>Siguiente paso del proceso</strong>{pendingSteps.length ? <><p>{pendingSteps[0].title}</p><small>{pendingSteps[0].owner_name}</small></> : <p className="complete-note">Proceso completo · auditoría activa</p>}</div>
        <div className={`client-deadline ${launchOverdue(client) ? 'overdue' : ''}`}><span>Deadline ADS</span><b>{client.target_launch_date || 'Sin fecha'}</b></div><div className="next-step"><span>Próximo paso</span><p>{client.next_action}</p></div><span className="card-link">Ver expediente completo →</span>
      </Link>)}</div>
    </details>
  </>
}

function RoleDashboard({ data, blockers, profile, extras, eodState }) {
  const { t, locale } = useLanguage()
  const members = new Map((data.directory || []).map((member) => [member.id, member]))
  const charts = useDashboardCharts(data, extras, locale)
  const open = data.tickets.filter((x) => x.assigned_to === profile?.id && x.status !== 'Resolved' && x.status !== 'Closed')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: profile?.timezone || 'America/Managua' }).format(new Date())
  const overdue = open.filter((x) => x.next_follow_up && x.next_follow_up < today)
  const waiting = open.filter((x) => x.status === 'Waiting')
  // My checklist work: steps of my role still open in my clients.
  const myPending = data.workflowSteps.filter((step) => step.owner_role === profile?.role && !step.completed)
  const tiles = [
    { key: 'tickets', icon: '🎫', value: open.length, label: 'Mis tickets', hint: overdue.length ? `${overdue.length} seguimiento(s) vencido(s)` : waiting.length ? `${waiting.length} esperando respuesta` : 'Asignados a mí', to: '/tickets', tone: overdue.length ? 'danger' : 'info' },
    { key: 'steps', icon: '✅', value: myPending.length, label: 'Mis pasos del checklist', hint: 'Pendientes en mis clientes', to: '/ciclo', tone: 'info' },
    { key: 'leads', icon: '📈', value: charts.leads, label: 'Leads (30 días)', hint: `${charts.appointments} citas agendadas`, tone: 'info' },
  ]
  return <><EodReminder eodState={eodState} />
    <FocusStrip tiles={tiles} />
    <section className="dashboard-grid">
      <TicketWatch tickets={data.tickets} members={members} onlyMine={profile?.id} title="Mis tickets" />
      <ClientLogFeed comments={extras.comments} clients={data.clients} members={members} limit={6} />
    </section>
    <DashboardChartsGrid charts={charts} />
    <ClientStatusCards clients={data.clients} />
    <div className="dashboard-grid"><section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Seguimiento de clientes')}</p><h3>{t('Mis próximos seguimientos')}</h3></div><Link to="/tickets">{t('Ver todos')}</Link></div><div className="ticket-list">{open.slice(0, 6).map((ticket) => <Link className="ticket-list-row" key={ticket.id} to="/tickets"><span className="ticket-list-main"><b>{ticket.ticket_number}</b><strong>{ticket.title}</strong><small>{ticket.clients.map((client) => client.code).join(', ')}</small></span><span className={'ticket-status-badge status-' + ticket.status.toLowerCase().replaceAll(' ', '-')}>{t(ticketStatusLabels[ticket.status] || ticket.status)}</span><small>{ticket.next_follow_up || t('Sin fecha')}</small></Link>)}{open.length === 0 && <p className="muted">{t('No tienes tickets abiertos asignados.')}</p>}</div></section>
    <section className="content-card alert-card"><p className="eyebrow">{t('Dependencias')}</p><h3>{t('Bloqueos abiertos')}</h3><div className="blocker-list">{blockers.map((item) => <article className="blocker-row" key={item.id}><span className="alert-dot red-dot" /><div><strong>{item.clients?.code} · {item.clients?.business_name}</strong><p>{item.title}</p><small>{t('Responsable')}: {item.owner_name}</small></div></article>)}</div></section></div>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">{t('Pipeline')}</p><h3>{t('Estado de clientes')}</h3></div><Link to="/clientes">{t('Ver clientes')}</Link></div><div className="pipeline-list">{data.clients.map((client) => <Link className="pipeline-row" to={'/clientes/' + client.id} key={client.id}><span className={'lifecycle ' + client.status.toLowerCase().replaceAll(' ', '-')}>{client.status}</span><div><strong>{client.code} · {client.business_name}</strong><small>{client.phase} · ADS {client.target_launch_date || t('Sin deadline')}</small></div><p><b>{t('Siguiente')}:</b> {client.next_action}</p><span className="row-arrow">→</span></Link>)}</div></section>
  </>
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const { locale } = useLanguage()
  const [data, setData] = useState({ clients: [], tickets: [], blockers: [], workflowSteps: [], notes: [], activity: [], eodReports: [], directory: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [eodState, setEodState] = useState(null)
  const [extras, setExtras] = useState({ comments: [], suggestions: [], metrics: new Map(), stages: [], myEodToday: true, eodChecked: false })
  const refresh = useCallback(async () => {
    try {
      const [operations, ticketWorkspace, dashboardExtras] = await Promise.all([
        loadOperations(profile.id),
        loadTicketWorkspace(),
        loadDashboardExtras(profile).catch(() => null),
      ])
      loadOwnEodState(profile).then(setEodState).catch(() => setEodState(null))
      setData({ ...operations, tickets: ticketWorkspace.tickets || [], profile, refresh })
      if (dashboardExtras) setExtras(dashboardExtras)
    } catch (loadError) { setError(loadError.message) }
  }, [profile])

  useEffect(() => { refresh().finally(() => setLoading(false)); return subscribeToOperations(refresh) }, [refresh])
  const activeBlockers = data.blockers.filter((blocker) => !blocker.resolved)
  const isAdmin = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const todayLabel = new Intl.DateTimeFormat(locale, { timeZone: profile?.timezone || 'America/Managua', dateStyle: 'full' }).format(new Date())

  const handleCreated = async (text) => { setMessage(text); await refresh() }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{isAdmin ? 'Superadmin · Control de dossiers' : 'Centro operativo'}</p><h2>Hola, {profile?.full_name || 'equipo'}</h2><p className="dashboard-date">{todayLabel}</p><p className="muted">{isAdmin ? 'Revisa los clientes y da seguimiento a sus tickets.' : 'Tus clientes y seguimientos de tickets asignados.'}</p></div><div className="dashboard-header-side"><DualClock timeZone={profile?.timezone} /><span className="status-pill">Datos en vivo</span></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    {isAdmin ? <SuperadminDashboard data={data} blockers={activeBlockers} extras={extras} profile={profile} eodState={eodState} /> : <RoleDashboard data={data} blockers={activeBlockers} profile={profile} extras={extras} eodState={eodState} />}
  </div>
}
