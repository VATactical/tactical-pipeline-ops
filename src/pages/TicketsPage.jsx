import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { addTicketUpdate, createTicket, loadTicketWorkspace, updateTicket } from '../services/ticketService'

const statuses = ['Open', 'In progress', 'Waiting', 'Resolved', 'Closed']
const priorities = ['Low', 'Medium', 'High', 'Urgent']
const statusLabels = {
  Open: 'Abierto',
  'In progress': 'En progreso',
  Waiting: 'Esperando',
  Resolved: 'Resuelto',
  Closed: 'Cerrado',
}
const priorityLabels = {
  Low: 'Baja',
  Medium: 'Media',
  High: 'Alta',
  Urgent: 'Urgente',
}
const terminalStatuses = new Set(['Resolved', 'Closed'])
const emptyDraft = {
  ticket_number: '',
  title: '',
  description: '',
  status: 'Open',
  priority: 'Medium',
  assigned_to: '',
  next_follow_up: '',
  needs_confirmation: false,
}

function getNextTicketNumber(tickets) {
  const largest = tickets.reduce((current, ticket) => {
    const match = ticket.ticket_number.match(/^TKT-(\d+)$/i)
    return match ? Math.max(current, Number(match[1])) : current
  }, 0)
  return 'TKT-' + String(largest + 1).padStart(3, '0')
}

function dateKeyInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return values.year + '-' + values.month + '-' + values.day
}

function formatDate(value, locale) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value + 'T12:00:00'))
}

export default function TicketsPage() {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [tickets, setTickets] = useState([])
  const [clients, setClients] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTicket, setNewTicket] = useState(emptyDraft)
  const [newClientIds, setNewClientIds] = useState([])
  const [updateBody, setUpdateBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async (keepSelection = true) => {
    setError('')
    try {
      const result = await loadTicketWorkspace()
      setTickets(result.tickets)
      setClients(result.clients)
      setProfiles(result.profiles)
      if (!keepSelection || !selectedId) setSelectedId(result.tickets[0]?.id || '')
      else if (!result.tickets.some((ticket) => ticket.id === selectedId)) setSelectedId(result.tickets[0]?.id || '')
    } catch (loadError) {
      setError(loadError.message || t('No fue posible cargar los tickets.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh(false) }, [])

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedId) || null

  useEffect(() => {
    if (!selectedTicket) { setDraft(null); return }
    setDraft({
      title: selectedTicket.title || '',
      description: selectedTicket.description || '',
      status: selectedTicket.status,
      priority: selectedTicket.priority,
      assigned_to: selectedTicket.assigned_to || '',
      next_follow_up: selectedTicket.next_follow_up || '',
      needs_confirmation: Boolean(selectedTicket.needs_confirmation),
    })
  }, [selectedTicket?.id, selectedTicket?.updated_at])

  const today = dateKeyInZone(new Date(), profile?.timezone || 'America/Managua')
  const counts = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'Open' || ticket.status === 'In progress').length,
    waiting: tickets.filter((ticket) => ticket.status === 'Waiting').length,
    overdue: tickets.filter((ticket) => !terminalStatuses.has(ticket.status) && ticket.next_follow_up && ticket.next_follow_up < today).length,
  }), [tickets, today])

  const filtered = useMemo(() => tickets.filter((ticket) => {
    const matchesStatus = filter === 'All' || ticket.status === filter
    const haystack = [
      ticket.ticket_number,
      ticket.title,
      ticket.description,
      ...ticket.clients.map((client) => client.code + ' ' + client.businessName),
    ].join(' ').toLowerCase()
    return matchesStatus && haystack.includes(query.trim().toLowerCase())
  }), [tickets, filter, query])

  const openCreate = () => {
    setError('')
    setNotice('')
    setNewTicket({ ...emptyDraft, ticket_number: getNextTicketNumber(tickets), assigned_to: profile?.id || '' })
    setNewClientIds([])
    setShowCreate(true)
  }

  const toggleClient = (id) => setNewClientIds((current) => current.includes(id)
    ? current.filter((clientId) => clientId !== id)
    : [...current, id])

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (!newClientIds.length) throw new Error(t('Selecciona al menos un cliente.'))
      if (newTicket.needs_confirmation && terminalStatuses.has(newTicket.status)) throw new Error(t('Confirma los detalles antes de cerrar el ticket.'))
      await createTicket(newTicket, newClientIds, profile)
      await refresh(false)
      setShowCreate(false)
      setNotice(t('Ticket creado.'))
    } catch (saveError) {
      setError(saveError.message || t('No fue posible guardar el ticket.'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!selectedTicket || !draft) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (draft.needs_confirmation && terminalStatuses.has(draft.status)) throw new Error(t('Confirma los detalles antes de cerrar el ticket.'))
      const changes = []
      if (draft.title !== selectedTicket.title) changes.push('title')
      if (draft.description !== selectedTicket.description) changes.push('details')
      if (draft.status !== selectedTicket.status) changes.push('status')
      if (draft.priority !== selectedTicket.priority) changes.push('priority')
      if (draft.assigned_to !== (selectedTicket.assigned_to || '')) changes.push('owner')
      if (draft.next_follow_up !== (selectedTicket.next_follow_up || '')) changes.push('next follow-up')
      if (draft.needs_confirmation !== Boolean(selectedTicket.needs_confirmation)) changes.push('verification flag')
      const updated = await updateTicket(selectedTicket.id, {
        title: draft.title.trim(),
        description: draft.description.trim(),
        status: draft.status,
        priority: draft.priority,
        assigned_to: draft.assigned_to || null,
        next_follow_up: draft.next_follow_up || null,
        needs_confirmation: draft.needs_confirmation,
      }, profile.id)
      if (changes.length) {
        await addTicketUpdate(updated, 'Updated: ' + changes.join(', ') + '.', profile)
      }
      await refresh(true)
      setNotice(t('Ticket actualizado.'))
    } catch (saveError) {
      setError(saveError.message || t('No fue posible guardar el ticket.'))
    } finally {
      setSaving(false)
    }
  }

  const handleAddUpdate = async (event) => {
    event.preventDefault()
    if (!selectedTicket || !updateBody.trim()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await addTicketUpdate(selectedTicket, updateBody, profile)
      setUpdateBody('')
      await refresh(true)
      setNotice(t('Seguimiento registrado.'))
    } catch (saveError) {
      setError(saveError.message || t('No fue posible guardar el seguimiento.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen />

  return <div className="page-stack tickets-page">
    <header className="page-header">
      <div><p className="eyebrow">{t('Seguimiento de clientes')}</p><h2>{t('Tickets')}</h2><p className="muted">{t('Registra el responsable, estado y próximo seguimiento de cada ticket.')}</p></div>
      <button className="primary-button" type="button" onClick={openCreate}>{t('Nuevo ticket')}</button>
    </header>

    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}

    <div className="ticket-summary-grid">
      <article className="metric-card blue"><span>{t('Tickets')}</span><strong>{counts.total}</strong></article>
      <article className="metric-card teal"><span>{t('Abiertos y en progreso')}</span><strong>{counts.open}</strong></article>
      <article className="metric-card amber"><span>{t('Esperando respuesta')}</span><strong>{counts.waiting}</strong></article>
      <article className="metric-card red"><span>{t('Seguimientos vencidos')}</span><strong>{counts.overdue}</strong></article>
    </div>

    {showCreate && <section className="content-card ticket-create-card">
      <div className="section-heading"><div><p className="eyebrow">{t('Tickets')}</p><h3>{t('Nuevo ticket')}</h3></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>{t('Cancelar')}</button></div>
      <form className="ticket-create-form" onSubmit={handleCreate}>
        <label>{t('Número de ticket')}<input required value={newTicket.ticket_number} onChange={(event) => setNewTicket({ ...newTicket, ticket_number: event.target.value.toUpperCase() })} /></label>
        <label>{t('Asunto')}<input required maxLength={240} value={newTicket.title} onChange={(event) => setNewTicket({ ...newTicket, title: event.target.value })} /></label>
        <label className="ticket-form-wide">{t('Descripción')}<textarea rows="3" value={newTicket.description} onChange={(event) => setNewTicket({ ...newTicket, description: event.target.value })} /></label>
        <label>{t('Estado')}<select value={newTicket.status} onChange={(event) => setNewTicket({ ...newTicket, status: event.target.value })}>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
        <label>{t('Prioridad')}<select value={newTicket.priority} onChange={(event) => setNewTicket({ ...newTicket, priority: event.target.value })}>{priorities.map((priority) => <option key={priority} value={priority}>{t(priorityLabels[priority])}</option>)}</select></label>
        <label>{t('Responsable')}<select value={newTicket.assigned_to} onChange={(event) => setNewTicket({ ...newTicket, assigned_to: event.target.value })}><option value="">{t('Sin asignar')}</option>{profiles.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>
        <label>{t('Próximo seguimiento')}<input type="date" value={newTicket.next_follow_up} onChange={(event) => setNewTicket({ ...newTicket, next_follow_up: event.target.value })} /></label>
        <fieldset className="ticket-client-picker ticket-form-wide"><legend>{t('Clientes vinculados')}</legend><div>{clients.filter((client) => !client.archived).map((client) => <label key={client.id}><input type="checkbox" checked={newClientIds.includes(client.id)} onChange={() => toggleClient(client.id)} /><span>{client.code} · {client.business_name}</span></label>)}</div></fieldset>
        <label className="ticket-confirmation-flag ticket-form-wide"><input type="checkbox" checked={newTicket.needs_confirmation} onChange={(event) => setNewTicket({ ...newTicket, needs_confirmation: event.target.checked })} />{t('Detalles por confirmar')}</label>
        <div className="ticket-form-actions ticket-form-wide"><button className="primary-button" type="submit" disabled={saving}>{saving ? t('Guardando…') : t('Crear ticket')}</button></div>
      </form>
    </section>}

    <section className="content-card ticket-workspace">
      <div className="ticket-toolbar">
        <label className="ticket-search">{t('Buscar ticket o cliente')}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="TKT-023, C19, Meta…" /></label>
        <label>{t('Estado')}<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="All">{t('Todos los estados')}</option>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
      </div>

      {filtered.length === 0
        ? <div className="ticket-empty-state"><strong>{tickets.length ? t('No hay tickets que coincidan.') : t('Aún no hay tickets registrados.')}</strong><p>{tickets.length ? t('Ajusta la búsqueda o el filtro de estado.') : t('Crea un ticket para comenzar el seguimiento del cliente.')}</p></div>
        : <div className="ticket-layout">
          <div className="ticket-list" role="list" aria-label={t('Lista de tickets')}>
            {filtered.map((ticket) => <button type="button" role="listitem" className={'ticket-list-row' + (ticket.id === selectedId ? ' active' : '')} key={ticket.id} onClick={() => { setSelectedId(ticket.id); setError(''); setNotice('') }}>
              <span className="ticket-list-main"><b>{ticket.ticket_number}</b><strong>{ticket.title}</strong><small>{ticket.clients.map((client) => client.code).join(', ') || t('Sin cliente vinculado')}</small></span>
              <span className={'ticket-status-badge status-' + ticket.status.toLowerCase().replaceAll(' ', '-')}>{t(statusLabels[ticket.status])}</span>
              {ticket.needs_confirmation && <span className="ticket-verify-badge">{t('Por confirmar')}</span>}
            </button>)}
          </div>

          {selectedTicket && draft && <aside className="ticket-detail-panel">
            <div className="ticket-detail-heading"><div><p className="eyebrow">{selectedTicket.ticket_number}</p><h3>{selectedTicket.title}</h3></div><span className={'ticket-status-badge status-' + selectedTicket.status.toLowerCase().replaceAll(' ', '-')}>{t(statusLabels[selectedTicket.status])}</span></div>
            <div className="ticket-client-links">{selectedTicket.clients.map((client) => client.id
              ? <Link key={client.id} to={'/clientes/' + client.id}>{client.code} · {client.businessName}</Link>
              : <span key={client.code}>{client.code} · {client.businessName}</span>)}</div>

            <form className="ticket-detail-form" onSubmit={handleSave}>
              <label>{t('Asunto')}<input required maxLength={240} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>{t('Descripción')}<textarea rows="4" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <div className="ticket-field-row">
                <label>{t('Estado')}<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>{statuses.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label>
                <label>{t('Prioridad')}<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>{priorities.map((priority) => <option key={priority} value={priority}>{t(priorityLabels[priority])}</option>)}</select></label>
              </div>
              <div className="ticket-field-row">
                <label>{t('Responsable')}<select value={draft.assigned_to} onChange={(event) => setDraft({ ...draft, assigned_to: event.target.value })}><option value="">{t('Sin asignar')}</option>{profiles.map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>
                <label>{t('Próximo seguimiento')}<input type="date" value={draft.next_follow_up} onChange={(event) => setDraft({ ...draft, next_follow_up: event.target.value })} /></label>
              </div>
              <label className="ticket-confirmation-flag"><input type="checkbox" checked={draft.needs_confirmation} onChange={(event) => setDraft({ ...draft, needs_confirmation: event.target.checked })} />{t('Detalles por confirmar')}</label>
              {draft.needs_confirmation && <p className="ticket-warning-note">{t('Confirma los detalles antes de cerrar el ticket.')}</p>}
              <button className="primary-button" type="submit" disabled={saving}>{saving ? t('Guardando…') : t('Guardar cambios')}</button>
            </form>

            <form className="ticket-update-form" onSubmit={handleAddUpdate}>
              <label>{t('Registrar seguimiento')}<textarea rows="3" required maxLength={5000} value={updateBody} onChange={(event) => setUpdateBody(event.target.value)} placeholder={t('Escribe una nota de seguimiento…')} /></label>
              <small>{t('Escribe las notas en inglés para que todo el equipo pueda seguirlas.')}</small>
              <button className="secondary-button" type="submit" disabled={saving || !updateBody.trim()}>{saving ? t('Guardando…') : t('Agregar al historial')}</button>
            </form>

            <div className="ticket-history"><h4>{t('Historial')}</h4>
              {selectedTicket.updates.length === 0 && <p className="muted">{t('Sin actualizaciones registradas.')}</p>}
              {selectedTicket.updates.map((update) => <article key={update.id}><div><strong>{update.author_name}</strong><time dateTime={update.created_at}>{formatDate(update.created_at.slice(0, 10), locale)}</time></div><p>{update.body}</p>{update.status_after && <small>{t('Estado')}: {t(statusLabels[update.status_after])}</small>}</article>)}
            </div>
          </aside>}
        </div>}
    </section>
  </div>
}
