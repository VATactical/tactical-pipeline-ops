import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadTeam() {
  const { data, error } = await runWithSessionRetry(() => supabase
    .from('profiles')
    .select('id, email, full_name, role, permissions, active, timezone, created_at')
    .order('created_at'))
  if (error) throw error
  return data || []
}

export async function manageTeamUser(payload) {
  const { data, error } = await supabase.functions.invoke('manage-team-user', { body: payload })
  if (error) {
    try {
      const details = await error.context?.json()
      throw new Error(details?.error || error.message)
    } catch (contextError) {
      throw contextError instanceof Error && contextError.message !== 'Unexpected end of JSON input' ? contextError : error
    }
  }
  if (data?.error) throw new Error(data.error)
  return data.profile
}
