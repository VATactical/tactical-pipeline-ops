import { runWithSessionRetry, supabase } from '../lib/supabase'

function throwIfError(result) {
  if (result.error) throw result.error
  return result.data
}

export async function loadTicketWorkspace() {
  const [ticketsResult, linksResult, updatesResult, clientsResult, profilesResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('tickets').select('*').order('updated_at', { ascending: false }),
    supabase.from('ticket_clients').select('ticket_id,client_id,client_code_snapshot,business_name_snapshot'),
    supabase.from('ticket_updates').select('id,ticket_id,author_name,body,status_after,created_at').order('created_at', { ascending: false }).limit(500),
    supabase.from('clients').select('id,code,business_name,archived').order('code'),
    supabase.from('profiles').select('id,full_name,active').eq('active', true).order('full_name'),
  ]))

  const tickets = throwIfError(ticketsResult) || []
  const links = throwIfError(linksResult) || []
  const updates = throwIfError(updatesResult) || []
  const clients = throwIfError(clientsResult) || []
  const profiles = throwIfError(profilesResult) || []
  const clientById = new Map(clients.map((client) => [client.id, client]))
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const linksByTicket = new Map()
  const updatesByTicket = new Map()

  links.forEach((link) => {
    const client = clientById.get(link.client_id)
    const row = {
      id: link.client_id,
      code: client?.code || link.client_code_snapshot,
      businessName: client?.business_name || link.business_name_snapshot,
      archived: client?.archived ?? false,
    }
    const existing = linksByTicket.get(link.ticket_id) || []
    existing.push(row)
    linksByTicket.set(link.ticket_id, existing)
  })

  updates.forEach((update) => {
    const existing = updatesByTicket.get(update.ticket_id) || []
    existing.push(update)
    updatesByTicket.set(update.ticket_id, existing)
  })

  return {
    tickets: tickets.map((ticket) => ({
      ...ticket,
      assignee: profileById.get(ticket.assigned_to) || null,
      clients: linksByTicket.get(ticket.id) || [],
      updates: updatesByTicket.get(ticket.id) || [],
    })),
    clients,
    profiles,
  }
}

export async function createTicket(ticket, clientIds, profile) {
  const { data, error } = await runWithSessionRetry(() => supabase.rpc('create_ticket_with_clients', {
    p_ticket_number: ticket.ticket_number.trim(),
    p_title: ticket.title.trim(),
    p_description: ticket.description.trim(),
    p_status: ticket.status,
    p_priority: ticket.priority,
    p_assigned_to: ticket.assigned_to || null,
    p_next_follow_up: ticket.next_follow_up || null,
    p_needs_confirmation: Boolean(ticket.needs_confirmation),
    p_client_ids: clientIds,
  }))
  if (error) throw error
  return data
}

export async function updateTicket(ticketId, changes, profileId) {
  const { data, error } = await runWithSessionRetry(() => supabase
    .from('tickets')
    .update({
      ...changes,
      updated_at: new Date().toISOString(),
      updated_by: profileId,
    })
    .eq('id', ticketId)
    .select('*')
    .single())
  if (error) throw error
  return data
}

export async function addTicketUpdate(ticket, body, profile) {
  const { data, error } = await runWithSessionRetry(() => supabase
    .from('ticket_updates')
    .insert({
      ticket_id: ticket.id,
      author_id: profile.id,
      author_name: profile.full_name || profile.email || 'Team member',
      body: body.trim(),
      status_after: ticket.status,
    })
    .select('*')
    .single())
  if (error) throw error
  return data
}
