import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { loadClientTickets } from '../services/opsService'
import LinkifiedText from './LinkifiedText'

// Tickets of one client from the Tickets module, including those Viktor tracks in Slack
// (synced every hour). Open tickets first; resolved ones on demand.

const CLOSED = new Set(['Resolved', 'Closed'])
const STATUS_LABELS = { Open: 'Abierto', 'In progress': 'En progreso', Waiting: 'Esperando', Resolved: 'Resuelto', Closed: 'Cerrado' }
const ageDays = (value) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000))

function TicketItem({ ticket }) {
  const { t } = useLanguage()
  const closed = CLOSED.has(ticket.status)
  const age = ageDays(ticket.created_at)
  return <li className={`client-ticket ${closed ? 'closed' : age > 2 ? 'stale' : ''}`}>
    <div className="client-ticket-head">
      <Link className="client-ticket-code" to={`/tickets?ticket=${ticket.id}`} data-no-translate>{ticket.ticket_number}</Link>
      <span className={`ticket-status-badge status-${ticket.status.toLowerCase().replaceAll(' ', '-')}`}>{t(STATUS_LABELS[ticket.status] || ticket.status)}</span>
      {ticket.priority === 'Urgent' && <span className="client-ticket-urgent">{t('Urgente')}</span>}
      {!closed && <span className="client-ticket-age">{age} {t(age === 1 ? 'día' : 'días')}</span>}
      {ticket.source === 'slack' && <span className="client-ticket-source">Slack</span>}
    </div>
    <LinkifiedText text={ticket.source === 'slack' && ticket.slack_summary ? ticket.slack_summary : ticket.title} />
    {ticket.resolvedForClient && <small className="client-ticket-partial">✅ {t('Resuelto para este cliente; el ticket sigue abierto para otros clientes.')}</small>}
    {(ticket.slack_owner_name || ticket.source_url) && <div className="client-ticket-foot">
      {ticket.slack_owner_name && <span>👤 <span data-no-translate>{ticket.slack_owner_name}</span></span>}
      {ticket.source_url && <a href={ticket.source_url} target="_blank" rel="noreferrer">{t('Ver en Slack')} ↗</a>}
    </div>}
  </li>
}

export default function ClientTickets({ clientId }) {
  const { t } = useLanguage()
  const [tickets, setTickets] = useState(null)
  const [error, setError] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setTickets(null); setError('')
    loadClientTickets(clientId)
      .then((rows) => { if (!cancelled) setTickets(rows) })
      .catch((loadError) => { if (!cancelled) setError(t(loadError.message)) })
    return () => { cancelled = true }
  }, [clientId, t])

  if (error) return <p className="form-error">{error}</p>
  if (!tickets) return <p className="muted">{t('Cargando…')}</p>
  const open = tickets.filter((ticket) => !CLOSED.has(ticket.status))
  const closed = tickets.filter((ticket) => CLOSED.has(ticket.status))
  return <div className="client-tickets">
    {!open.length && <p className="muted">{t('Sin tickets abiertos.')}</p>}
    {open.length > 0 && <ul className="client-ticket-list">{open.map((ticket) => <TicketItem key={ticket.id} ticket={ticket} />)}</ul>}
    {closed.length > 0 && <>
      <button type="button" className="text-button" onClick={() => setShowClosed((value) => !value)}>
        {showClosed ? t('Ocultar resueltos') : `${t('Ver resueltos')} (${closed.length})`}</button>
      {showClosed && <ul className="client-ticket-list">{closed.map((ticket) => <TicketItem key={ticket.id} ticket={ticket} />)}</ul>}
    </>}
  </div>
}
