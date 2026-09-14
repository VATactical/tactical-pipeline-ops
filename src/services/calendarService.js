import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadCalendarData() {
  const [eventsResult, clientsResult, notificationsResult, directoryResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('calendar_events').select('*, clients(code, business_name)').order('start_at'),
    supabase.from('clients').select('id, code, business_name, timezone').eq('archived', false).order('code'),
    supabase.from('notifications').select('*').is('read_at', null).lte('notify_at', new Date().toISOString()).order('notify_at'),
    supabase.rpc('get_team_directory'),
  ]))
  const error = eventsResult.error || clientsResult.error || notificationsResult.error || directoryResult.error
  if (error) throw error
  return { events: eventsResult.data || [], clients: clientsResult.data || [], notifications: notificationsResult.data || [], members: directoryResult.data || [] }
}

export async function createCalendarEvent(event, profileId) {
  const zonedToIso = (value, timeZone) => {
    if (!value) return null
    const [date, time] = value.split('T')
    const [year, month, day] = date.split('-').map(Number)
    const [hour, minute] = time.split(':').map(Number)
    const desired = Date.UTC(year, month - 1, day, hour, minute)
    let instant = desired
    for (let pass = 0; pass < 2; pass += 1) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
      const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
      instant += desired - shown
    }
    return new Date(instant).toISOString()
  }
  const { data, error } = await supabase.from('calendar_events').insert({
    client_id: event.clientId || null,
    title: event.title.trim(),
    event_type: event.eventType,
    start_at: zonedToIso(event.startAt, event.timezone),
    end_at: zonedToIso(event.endAt, event.timezone),
    timezone: event.timezone,
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
