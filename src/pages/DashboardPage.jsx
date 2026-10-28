import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { useLanguage } from '../i18n/LanguageContext'
import { downloadCommunicationsPdf } from '../lib/reportExports'
import { loadCompanySettings } from '../services/companyService'
import { loadEodComplianceSummary } from '../services/eodService'
import { loadTicketWorkspace } from '../services/ticketService'
import {
  createTeamNote,
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
  return <section className="content-card communications-card"><div className="section-heading"><div><p className="eyebrow">{t('Comunicaciones')}</p><h3>{t(historyOpen ? 'Historial de notas' : 'Notas generales')}</h3><p className="muted">{t('Después de marcar una nota como vista permanecerá aquí durante 24 horas.')}</p></div><div className="section-actions"><button className="secondary-button" type="button" onClick={exportPdf}>{t('Exportar notas PDF')}</button><button className="text-button" type="button" onClick={() => setHistoryOpen((current) => !current)}>{historyOpen ? t('Ver activas') : `${t('Historial')} (${history.length})`}</button></div></div>{error && <p className="form-error">{error}</p>}<div className="note-list">{visible.length === 0 && <p className="muted">{t(historyOpen ? 'No hay notas en el historial.' : 'No hay comunicaciones activas.')}</p>}{visible.map((note) => <article className="note-card communication-note" key={note.id}><div><strong data-no-translate>{note.title}</strong>{note.receipt && !historyOpen && <span className="seen-badge">{t('Visto · visible 24 h')}</span>}</div>{note.body && <p data-no-translate>{note.body}</p>}<small><span data-no-translate>{note.author?.full_name || t('Equipo')}</span> · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small><div className="communication-actions">{!historyOpen && !note.receipt && <button className="secondary-button" type="button" disabled={busy === `seen-${note.id}`} onClick={() => markSeen(note)}>{t(busy === `seen-${note.id}` ? 'Guardando…' : 'Marcar como visto')}</button>}<Link to="/tickets">{t('Seguimiento de tickets')}</Link></div></article>)}</div></section>
}

function EodComplianceCard({ summary }) {
  if (!summary) return null
  return <section className="content-card dashboard-eod-compliance"><div className="section-heading"><div><p className="eyebrow">Reportes diarios</p><h3>EOD de hoy</h3><p className="muted">{summary.workDate} · Envío dentro de TP OPS al finalizar el turno.</p></div><Link to="/eod-reports">Ver detalle</Link></div><div className="eod-compliance-counts"><span className="submitted">{summary.counts.submitted} enviados</span><span className="pending">{summary.counts.pending} pendientes</span></div><div className="dashboard-eod-users">{summary.rows.map((row) => <span className={row.state} key={row.member.id}>{row.member.full_name}: {row.state === 'submitted' ? 'Enviado' : 'Pendiente'}</span>)}</div></section>
}

function SuperadminDashboard({ data, blockers, onCreated, eodCompliance }) {
  const { locale, t } = useLanguage()
  const clientSummaries = data.clients.map((client) => {
    const missingCount = dossierFields.filter((key) => isMissing(client[key])).length
    const openTickets = data.tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status) && ticket.clients?.some((link) => link.id === client.id)).length
    const clientBlockers = blockers.filter((blocker) => blocker.client_id === client.id).length
    const pendingSteps = data.workflowSteps.filter((step) => step.client_id === client.id && !step.completed)
    return { client, missingCount, openTickets, clientBlockers, pendingSteps }
  })
  const incomplete = clientSummaries.filter((item) => item.missingCount > 0).length
  const overdueTickets = data.tickets.filter((ticket) => !['Resolved', 'Closed'].includes(ticket.status) && ticket.next_follow_up && new Date(ticket.next_follow_up + 'T23:59:59') < new Date())
  const stale = data.clients.filter(isStale)
  const lateLaunches = data.clients.filter(launchOverdue)
  const attentionQueue = clientSummaries.filter(({ client, missingCount, clientBlockers }) => clientBlockers || client.status === 'ADS PAUSED' || launchOverdue(client) || !client.intake_form_completed || missingCount > 0)
    .sort((a, b) => Number(Boolean(b.clientBlockers)) - Number(Boolean(a.clientBlockers)) || Number(b.client.status === 'ADS PAUSED') - Number(a.client.status === 'ADS PAUSED') || Number(launchOverdue(b.client)) - Number(launchOverdue(a.client)))
    .slice(0, 6)

  return <>
    <ClientStatusCards clients={data.clients} />
    <EodComplianceCard summary={eodCompliance} />
    <section className="metric-grid compact" aria-label="Alertas operativas">
      <article className="metric-card red"><span>{t('Seguimientos vencidos')}</span><strong>{overdueTickets.length}</strong><small>{t('Requieren seguimiento')}</small></article>
      <article className="metric-card amber"><span>Sin actualización</span><strong>{stale.length}</strong><small>más de 3 días</small></article>
      <article className="metric-card red"><span>Deadlines ADS vencidos</span><strong>{lateLaunches.length}</strong><small>campañas sin lanzar</small></article>
    </section>
    <section className="dashboard-grid">
      <div className="content-card"><div className="section-heading"><div><p className="eyebrow">Prioridad ejecutiva</p><h3>Clientes que requieren atención</h3></div><Link to="/clientes">Ver filtros</Link></div><div className="attention-list">{attentionQueue.length === 0 && <p className="complete-note">No hay alertas críticas.</p>}{attentionQueue.map(({ client, missingCount, clientBlockers }) => <Link to={`/clientes/${client.id}`} className="attention-row" key={client.id}><div><strong>{client.code} · {client.business_name}</strong><small>{client.status === 'ADS PAUSED' ? `ADS pausados: ${client.ads_pause_reason}` : !client.intake_form_completed ? 'Formulario pendiente' : clientBlockers ? `${clientBlockers} bloqueo(s)` : launchOverdue(client) ? 'Deadline ADS vencido' : `${missingCount} campos pendientes`}</small></div><span>→</span></Link>)}</div></div>
    </section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">EOD del equipo</p><h3>Últimos informes</h3></div><Link to="/eod-reports">Abrir historial</Link></div><div className="report-list">{data.eodReports.length === 0 && <p className="muted">Aún no hay informes.</p>}{data.eodReports.slice(0, 4).map((report) => <article className="report-card" key={report.id}><div><strong>{report.profiles?.full_name || 'Usuario'}</strong><small>{report.report_date}</small></div><p>{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades reportadas</p></article>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Actividad del equipo</p><h3>Actualizaciones operativas</h3></div></div><div className="activity-list">{data.activity.filter((item) => item.entity_type !== 'tasks' && item.entity_type !== 'calendar_events').slice(0, 8).map((item) => <article className="activity-row" key={item.id}><div><strong data-no-translate>{item.actor_name}</strong><p>{t(item.action === 'insert' ? 'creó' : item.action === 'update' ? 'actualizó' : 'eliminó')} {t(item.entity_type === 'clients' ? 'un cliente' : item.entity_type === 'notes' ? 'una nota' : 'un registro operativo')}</p></div><small>{new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</small></article>)}</div></section>
    <section className="content-card"><div className="dossier-meta"><span>{data.clients.length} clientes totales</span><span>{incomplete} dossiers incompletos</span><span className={blockers.length ? 'danger-text' : ''}>{new Set(blockers.map((item) => item.client_id)).size} clientes bloqueados</span></div></section>
    <section>
      <div className="section-heading"><div><p className="eyebrow">Control por cliente</p><h3>Seguimiento por cliente</h3></div><Link to="/clientes">Abrir pipeline</Link></div>
      <div className="dossier-grid">{clientSummaries.map(({ client, openTickets, clientBlockers, pendingSteps }) => <Link className={`dossier-card ${clientBlockers || client.status === 'ADS PAUSED' ? 'has-alert' : ''}`} to={`/clientes/${client.id}`} key={client.id}>
        <div className="client-card-top"><div><span className="client-code">{client.code}</span><h3>{client.business_name}</h3></div><span className={`lifecycle ${client.status.toLowerCase().replaceAll(' ', '-')}`}>{client.status}</span></div>
        <div className="dossier-meta"><span>{client.phase}</span><span>{openTickets} tickets abiertos</span>{client.status === 'ADS PAUSED' && <span className="pause-text">ADS pausados · {client.ads_pause_reason}</span>}{clientBlockers > 0 && <span className="danger-text">{clientBlockers} bloqueo{clientBlockers === 1 ? '' : 's'}</span>}</div>
        <div className="process-pending"><strong>Siguiente paso del proceso</strong>{pendingSteps.length ? <><p>{pendingSteps[0].title}</p><small>{pendingSteps[0].owner_name}</small></> : <p className="complete-note">Proceso completo · auditoría activa</p>}</div>
        <div className={`client-deadline ${launchOverdue(client) ? 'overdue' : ''}`}><span>Deadline ADS</span><b>{client.target_launch_date || 'Sin fecha'}</b></div><div className="next-step"><span>Próximo paso</span><p>{client.next_action}</p></div><span className="card-link">Ver expediente completo →</span>
      </Link>)}</div>
    </section>
  </>
}

function RoleDashboard({ data, blockers, profile }) {
  const { t } = useLanguage()
  const open = data.tickets.filter((x) => x.assigned_to === profile?.id && x.status !== 'Resolved' && x.status !== 'Closed')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: profile?.timezone || 'America/Managua' }).format(new Date())
  const overdue = open.filter((x) => x.next_follow_up && x.next_follow_up < today)
  const waiting = open.filter((x) => x.status === 'Waiting')
  return <><ClientStatusCards clients={data.clients} />
    <section className="metric-grid" aria-label="Resumen operativo"><article className="metric-card blue"><span>{t('Tickets abiertos')}</span><strong>{open.length}</strong><small>{t('Asignados a mí')}</small></article><article className="metric-card amber"><span>{t('Esperando respuesta')}</span><strong>{waiting.length}</strong><small>{t('Seguimientos programados')}</small></article><article className="metric-card red"><span>{t('Seguimientos vencidos')}</span><strong>{overdue.length}</strong><small>{t('Requieren seguimiento')}</small></article></section>
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
  const [eodCompliance, setEodCompliance] = useState(null)
  const refresh = useCallback(async () => {
    try {
      const [operations, compliance, ticketWorkspace] = await Promise.all([
        loadOperations(profile.id),
        loadEodComplianceSummary(profile),
        loadTicketWorkspace(),
      ])
      setData({ ...operations, tickets: ticketWorkspace.tickets || [], profile, refresh })
      setEodCompliance(compliance)
    } catch (loadError) { setError(loadError.message) }
  }, [profile])

  useEffect(() => { refresh().finally(() => setLoading(false)); return subscribeToOperations(refresh) }, [refresh])
  const activeBlockers = data.blockers.filter((blocker) => !blocker.resolved)
  const isAdmin = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const todayLabel = new Intl.DateTimeFormat(locale, { timeZone: profile?.timezone || 'America/Managua', dateStyle: 'full' }).format(new Date())

  const handleCreated = async (text) => { setMessage(text); await refresh() }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">{isAdmin ? 'Superadmin · Control de dossiers' : 'Centro operativo'}</p><h2>Hola, {profile?.full_name || 'equipo'}</h2><p className="dashboard-date">{todayLabel}</p><p className="muted">{isAdmin ? 'Revisa los clientes y da seguimiento a sus tickets.' : 'Tus clientes y seguimientos de tickets asignados.'}</p></div><span className="status-pill">Datos en vivo</span></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    {isAdmin ? <SuperadminDashboard data={data} blockers={activeBlockers} onCreated={handleCreated} eodCompliance={eodCompliance} /> : <RoleDashboard data={data} blockers={activeBlockers} profile={profile} />}
  </div>
}
