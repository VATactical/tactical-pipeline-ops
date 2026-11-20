import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { COMMENT_KINDS } from './ClientLog'
import LinkifiedText from './LinkifiedText'

// Building blocks for the main dashboard: what needs action today, at a glance.

const CLOSED = new Set(['Resolved', 'Closed'])
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
const DAY = 86400000
export const daysSince = (value) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / DAY))
export const isOpenTicket = (ticket) => !CLOSED.has(ticket.status)

// Completed checklist steps that expect a screenshot and still have none.
export function missingEvidenceSteps(workflowSteps, evidenceStepIds) {
  return workflowSteps.filter((step) => step.completed && step.evidence === 'required' && !evidenceStepIds.has(step.id))
}

export function recentBlockedComments(comments, days = 7) {
  return comments.filter((comment) => comment.kind === 'blocked' && daysSince(comment.created_at) <= days)
}

// Row of clickable counters. Each tile: { key, icon, value, label, hint, to, tone }.
export function FocusStrip({ tiles }) {
  const { t } = useLanguage()
  return <section className="focus-strip" aria-label={t('Lo que necesita atención')}>
    {tiles.map((tile) => {
      const body = <>
        <span className="focus-icon" aria-hidden="true">{tile.icon}</span>
        <strong>{tile.value}</strong>
        <span className="focus-label">{t(tile.label)}</span>
        {tile.hint && <small>{t(tile.hint)}</small>}
      </>
      const className = `focus-tile ${tile.tone || ''} ${tile.value ? '' : 'calm'}`
      if (tile.href) return <a key={tile.key} className={className} href={tile.href}>{body}</a>
      return tile.to ? <Link key={tile.key} className={className} to={tile.to}>{body}</Link> : <div key={tile.key} className={className}>{body}</div>
    })}
  </section>
}

// Open tickets that matter most: urgent first, then the oldest.
export function TicketWatch({ tickets, members, limit = 6, title = 'Tickets que piden atención', onlyMine = null }) {
  const { t } = useLanguage()
  const open = tickets.filter(isOpenTicket).filter((ticket) => !onlyMine || ticket.assigned_to === onlyMine)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || new Date(a.created_at) - new Date(b.created_at))
  const nameOf = (ticket) => ticket.assignee?.full_name || members.get(ticket.assigned_to)?.full_name || ticket.slack_owner_name || t('Sin responsable')
  return <section className="content-card ticket-watch">
    <div className="section-heading"><div><p className="eyebrow">{t('Tickets')}</p><h3>{t(title)}</h3></div><Link to="/tickets">{t('Ver todos')} ({open.length})</Link></div>
    {!open.length && <p className="complete-note">{t('No hay tickets abiertos.')}</p>}
    <div className="ticket-watch-list">{open.slice(0, limit).map((ticket) => {
      const age = daysSince(ticket.created_at)
      return <Link key={ticket.id} className={`ticket-watch-row ${ticket.priority === 'Urgent' ? 'urgent' : ''}`} to={`/tickets?ticket=${ticket.id}`}>
        <span className="ticket-watch-number">{ticket.ticket_number}{ticket.source === 'slack' && <em className="ticket-source-badge">Slack</em>}</span>
        <span className="ticket-watch-main">
          <strong data-no-translate>{ticket.source === 'slack' && ticket.slack_summary ? ticket.slack_summary : ticket.title}</strong>
          <small><span data-no-translate>{ticket.clients?.filter((client) => !client.resolvedAt).map((client) => client.code).join(', ') || ticket.clients?.map((client) => client.code).join(', ') || t('Agencia')}</span> · <span data-no-translate>{nameOf(ticket)}</span></small>
        </span>
        <span className={`ticket-watch-age ${age > 7 ? 'old' : age > 2 ? 'aging' : ''}`}>{age}d</span>
      </Link>
    })}</div>
  </section>
}

// Latest bitácora comments across clients.
export function ClientLogFeed({ comments, clients, members, limit = 7 }) {
  const { t, locale } = useLanguage()
  const byId = new Map(clients.map((client) => [client.id, client]))
  const visible = comments.filter((comment) => byId.has(comment.client_id)).slice(0, limit)
  const when = (value) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  return <section className="content-card log-feed">
    <div className="section-heading"><div><p className="eyebrow">{t('Bitácora')}</p><h3>{t('Últimos avances y bloqueos')}</h3></div><Link to="/ciclo">{t('Ciclo de vida')}</Link></div>
    {!visible.length && <p className="muted">{t('Aún no hay comentarios en la bitácora.')}</p>}
    <ol className="log-feed-list">{visible.map((comment) => {
      const kind = COMMENT_KINDS.find(([key]) => key === comment.kind) || COMMENT_KINDS[0]
      const client = byId.get(comment.client_id)
      return <li key={comment.id} className={comment.kind}>
        <div className="log-feed-meta">
          <span className={`client-log-badge ${comment.kind}`}>{kind[1]} {t(kind[2])}</span>
          <Link to={`/clientes/${client.id}`} data-no-translate>{client.code} · {client.business_name}</Link>
          <small><span data-no-translate>{members.get(comment.author_id)?.full_name || t('Equipo')}</span> · {when(comment.created_at)}{comment.slack_sent_at ? ` · ${t('En Slack')}` : ''}</small>
        </div>
        <LinkifiedText text={comment.body.length > 240 ? `${comment.body.slice(0, 237)}…` : comment.body} className="log-feed-body" />
      </li>
    })}</ol>
  </section>
}

// Clients with checked steps that still wait for their screenshot.
export function EvidenceGaps({ steps, clients }) {
  const { t, locale } = useLanguage()
  const stepTitle = (step) => (locale.startsWith('en') && step.title_en ? step.title_en : step.title)
  const byClient = new Map()
  for (const step of steps) byClient.set(step.client_id, [...(byClient.get(step.client_id) || []), step])
  const rows = clients.filter((client) => byClient.has(client.id))
  return <section className="content-card evidence-gaps" id="capturas-pendientes">
    <div className="section-heading"><div><p className="eyebrow">{t('Checklist')}</p><h3>{t('Capturas pendientes')}</h3><p className="muted">{t('Pasos marcados que se confirman con una captura y aún no la tienen.')}</p></div></div>
    {!rows.length && <p className="complete-note">{t('Todos los pasos que lo requieren tienen su captura.')}</p>}
    <div className="attention-list">{rows.map((client) => {
      const list = byClient.get(client.id).sort((a, b) => a.sort_order - b.sort_order)
      return <Link key={client.id} className="attention-row" to={`/clientes/${client.id}`}>
        <div><strong data-no-translate>{client.code} · {client.business_name}</strong>
          <small>{list.length === 1 ? t('1 paso') : t(`${list.length} pasos`)}: <span data-no-translate>{list.slice(0, 4).map(stepTitle).join(' · ')}{list.length > 4 ? ' …' : ''}</span></small></div>
        <span>📷 {list.length}</span>
      </Link>
    })}</div>
  </section>
}
