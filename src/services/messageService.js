import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadMessageCenter(profileId) {
  const [directoryResult, messagesResult] = await runWithSessionRetry(() => Promise.all([
    supabase.rpc('get_team_directory'),
    supabase.from('team_messages').select('*').order('created_at', { ascending: false }).limit(100),
  ]))
  const error = directoryResult.error || messagesResult.error
  if (error) throw error
  const members = directoryResult.data || []
  const names = Object.fromEntries(members.map((member) => [member.id, member.full_name || member.email]))
  const messages = (messagesResult.data || []).map((message) => ({
    ...message,
    sender_name: names[message.sender_id] || 'Usuario',
    recipient_name: names[message.recipient_id] || 'Usuario',
    mine: message.sender_id === profileId,
  }))
  return { members, messages }
}

export async function sendTeamMessage(senderId, recipientId, body) {
  const text = body.trim()
  if (!recipientId) throw new Error('Selecciona un destinatario.')
  if (!text) throw new Error('Escribe un mensaje.')
  if (text.length > 500) throw new Error('El mensaje no puede superar 500 caracteres.')
  const { data, error } = await supabase.from('team_messages').insert({
    sender_id: senderId,
    recipient_id: recipientId,
    body: text,
  }).select('*').single()
  if (error) throw error
  return data
}

export async function markTeamMessageRead(messageId, profileId) {
  const { error } = await supabase.from('team_messages').update({ read_at: new Date().toISOString() })
    .eq('id', messageId).eq('recipient_id', profileId)
  if (error) throw error
}

export async function loadUnreadMessageCount(profileId) {
  if (!profileId) return 0
  const { count, error } = await runWithSessionRetry(() => supabase.from('team_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', profileId).is('read_at', null))
  if (error) throw error
  return count || 0
}

export function subscribeToTeamMessages(profileId, onChange) {
  if (!profileId) return () => {}
  const channel = supabase.channel(`team-messages-${profileId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_messages', filter: `recipient_id=eq.${profileId}` }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
