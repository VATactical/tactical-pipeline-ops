import { supabase } from '../lib/supabase'

const ownerNames = { onboarding_media: 'Diego', automation_funnels: 'Daniel', superadmin: 'Kevin' }

export async function loadOperations() {
  const [clientsResult, tasksResult, blockersResult, workflowResult, notesResult] = await Promise.all([
    supabase.from('clients').select('*').order('code'),
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('blockers').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').order('sort_order'),
    supabase.from('notes').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
  ])

  const error = clientsResult.error || tasksResult.error || blockersResult.error || workflowResult.error || notesResult.error
  if (error) throw error

  return {
    clients: clientsResult.data || [],
    tasks: tasksResult.data || [],
    blockers: blockersResult.data || [],
    workflowSteps: workflowResult.data || [],
    notes: notesResult.data || [],
  }
}

export async function loadClient(clientId) {
  const [clientResult, tasksResult, blockersResult, workflowResult, auditResult, notesResult] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at'),
    supabase.from('blockers').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').eq('client_id', clientId).order('sort_order'),
    supabase.from('client_audit_log').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
  ])

  const error = clientResult.error || tasksResult.error || blockersResult.error || workflowResult.error || auditResult.error || notesResult.error
  if (error) throw error

  return { client: clientResult.data, tasks: tasksResult.data || [], blockers: blockersResult.data || [], workflowSteps: workflowResult.data || [], auditLog: auditResult.data || [], notes: notesResult.data || [] }
}

export async function updateTaskStatus(taskId, status) {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId)
  if (error) throw error
}

export async function updateTaskAssignment(taskId, ownerRole) {
  const { error } = await supabase.from('tasks').update({ owner_role: ownerRole, owner_name: ownerNames[ownerRole] }).eq('id', taskId)
  if (error) throw error
}

export async function createAssignedTask({ clientId, title, details, priority, ownerRole, dueLabel }) {
  const payload = {
    id: crypto.randomUUID(),
    client_id: clientId,
    title: title.trim(),
    evidence: details.trim(),
    priority,
    owner_role: ownerRole,
    owner_name: ownerNames[ownerRole],
    due_label: dueLabel.trim() || 'Nueva asignación',
    phase: 'Asignada por Kevin',
    status: 'Pendiente',
  }
  const { data, error } = await supabase.from('tasks').insert(payload).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function createTeamNote({ clientId, title, body }) {
  const { data, error } = await supabase.from('notes').insert({
    client_id: clientId || null,
    title: title.trim(),
    body: body.trim(),
  }).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function markTasksSeen(profileId) {
  const seenAt = new Date().toISOString()
  const { error } = await supabase.from('profiles').update({ last_task_seen_at: seenAt }).eq('id', profileId)
  if (error) throw error
  return seenAt
}

export function subscribeToOperations(onChange) {
  const channel = supabase.channel(`operations-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, () => onChange())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, () => onChange())
    .subscribe()
  return () => { supabase.removeChannel(channel) }
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

export async function updateClient(clientId, changes) {
  const { data, error } = await supabase.from('clients').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', clientId).select('*').single()
  if (error) throw error
  return data
}

export async function updateWorkflowStep(stepId, completed) {
  const { error } = await supabase.from('client_workflow_steps').update({
    completed,
    completed_at: completed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', stepId)
  if (error) throw error
}
