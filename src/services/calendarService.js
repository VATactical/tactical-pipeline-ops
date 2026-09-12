import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadCalendarData() {
  const [eventsResult, clientsResult, notificationsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('calendar_events').select('*, clients(code, business_name)').order('start_at'),
    supabase.from('clients').select('id, code, business_name').order('code'),
    supabase.from('notifications').select('*').is('read_at', null).lte('notify_at', new Date().toISOString()).order('notify_at'),
  ]))
  const error = eventsResult.error || clientsResult.error || notificationsResult.error
  if (error) throw error
  return { events: eventsResult.data || [], clients: clientsResult.data || [], notifications: notificationsResult.data || [] }
}

export async function createCalendarEvent(event, profileId) {
  const { data, error } = await supabase.from('calendar_events').insert({
    client_id: event.clientId || null,
    title: event.title.trim(),
    event_type: event.eventType,
    start_at: new Date(event.startAt).toISOString(),
    end_at: event.endAt ? new Date(event.endAt).toISOString() : null,
    meeting_url: event.meetingUrl.trim(),
    notes: event.notes.trim(),
    reminder_minutes: event.reminders,
    created_by: profileId,
  }).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function loadDueNotificationCount() {
  const { count, error } = await runWithSessionRetry(() => supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .lte('notify_at', new Date().toISOString()))
  if (error) throw error
  return count || 0
}
