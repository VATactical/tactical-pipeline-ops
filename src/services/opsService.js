import { supabase } from '../lib/supabase'

export async function loadOperations() {
  const [clientsResult, tasksResult, blockersResult] = await Promise.all([
    supabase.from('clients').select('*').order('code'),
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at'),
    supabase.from('blockers').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
  ])

  const error = clientsResult.error || tasksResult.error || blockersResult.error
  if (error) throw error

  return {
    clients: clientsResult.data || [],
    tasks: tasksResult.data || [],
    blockers: blockersResult.data || [],
  }
}

export async function loadClient(clientId) {
  const [clientResult, tasksResult, blockersResult] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at'),
    supabase.from('blockers').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
  ])

  const error = clientResult.error || tasksResult.error || blockersResult.error
  if (error) throw error

  return { client: clientResult.data, tasks: tasksResult.data || [], blockers: blockersResult.data || [] }
}

export async function updateTaskStatus(taskId, status) {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId)
  if (error) throw error
}
