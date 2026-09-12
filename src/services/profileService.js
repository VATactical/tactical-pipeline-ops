import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function updateMyProfile(profileId, changes) {
  try { new Intl.DateTimeFormat('en', { timeZone: changes.timezone }).format() }
  catch { throw new Error('Selecciona una zona horaria válida.') }
  const allowedAvatars = ['crimson', 'emerald', 'gold', 'ice', 'rose', 'midnight', 'steel', 'bronze', 'ruby', 'matrix', 'magma', 'prism']
  if (!allowedAvatars.includes(changes.avatarId)) throw new Error('Selecciona un avatar válido.')
  if (!['es', 'en'].includes(changes.preferredLanguage)) throw new Error('Selecciona un idioma válido.')
  const { data, error } = await supabase.from('profiles').update({
    timezone: changes.timezone.trim(),
    slack_contact: changes.slackContact.trim(),
    whatsapp_contact: changes.whatsappContact.trim(),
    avatar_url: changes.avatarId,
    preferred_language: changes.preferredLanguage,
  }).eq('id', profileId).select('id, timezone, slack_contact, whatsapp_contact, avatar_url, preferred_language').single()
  if (error) throw error
  return data
}

export async function changeMyPassword(email, currentPassword, newPassword) {
  if (newPassword.length < 10) throw new Error('La nueva contraseña debe tener al menos 10 caracteres.')
  if (currentPassword === newPassword) throw new Error('La nueva contraseña debe ser diferente a la actual.')

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (signInError) throw new Error('La contraseña actual no es correcta.')

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) throw updateError
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
