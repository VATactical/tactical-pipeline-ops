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

export async function updateTaskAssignment(taskId, ownerRole) {
  const ownerNames = { onboarding_media: 'Diego', automation_funnels: 'Daniel', superadmin: 'Kevin' }
  const { error } = await supabase.from('tasks').update({ owner_role: ownerRole, owner_name: ownerNames[ownerRole] }).eq('id', taskId)
  if (error) throw error
}

export async function createClient(client) {
  const payload = {
    ...client,
    id: crypto.randomUUID(),
    code: client.code.trim().toUpperCase(),
    business_name: client.business_name.trim(),
    daily_budget: Number(client.daily_budget || 0),
  }
  const { data, error } = await supabase.from('clients').insert(payload).select('id').single()
  if (error) throw error
  return data
}
