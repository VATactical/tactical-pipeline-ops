import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function updateMyProfile(profileId, changes) {
  try { new Intl.DateTimeFormat('en', { timeZone: changes.timezone }).format() }
  catch { throw new Error('Selecciona una zona horaria válida.') }
  const { data, error } = await supabase.from('profiles').update({
    timezone: changes.timezone.trim(),
    slack_contact: changes.slackContact.trim(),
    whatsapp_contact: changes.whatsappContact.trim(),
    updated_at: new Date().toISOString(),
  }).eq('id', profileId).select('id, timezone, slack_contact, whatsapp_contact').single()
  if (error) throw error
  return data
}

export async function loadTeamDirectory() {
  const { data, error } = await runWithSessionRetry(() => supabase.rpc('get_team_directory'))
  if (error) throw error
  return data || []
}

export function contactLink(value, type) {
  const contact = String(value || '').trim()
  if (!contact) return ''
  if (/^https?:\/\//i.test(contact)) return contact
  if (type === 'whatsapp') {
    const digits = contact.replace(/\D/g, '')
    return digits ? `https://wa.me/${digits}` : ''
  }
  return ''
}
