import { runWithSessionRetry, supabase } from '../lib/supabase'

const ownerNames = { onboarding_media: 'Diego', automation_funnels: 'Daniel', user_admin: 'User Admin', superadmin: 'Kevin' }

const priorityAliases = {
  Baja: 'Baja',
  Low: 'Baja',
  Media: 'Media',
  Medium: 'Media',
  Alta: 'Alta',
  High: 'Alta',
  Urgente: 'Urgente',
  Urgent: 'Urgente',
}

const statusAliases = {
  Pendiente: 'Pendiente',
  Pending: 'Pendiente',
  'En progreso': 'En progreso',
  'In progress': 'En progreso',
  Bloqueada: 'Bloqueada',
  Blocked: 'Bloqueada',
  Completada: 'Completada',
  Completed: 'Completada',
}

function normalizePriority(priority) {
  const normalized = priorityAliases[priority]
  if (!normalized) throw new Error('La prioridad seleccionada no es válida.')
  return normalized
}

function normalizeStatus(status) {
  const normalized = statusAliases[status]
  if (!normalized) throw new Error('El estado seleccionado no es válido.')
  return normalized
}

export async function loadOperations(profileId) {
  const [clientsResult, tasksResult, blockersResult, workflowResult, notesResult, activityResult, eodResult, eventsResult, directoryResult, noteReadsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('clients').select('*').eq('archived', false).order('code'),
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('blockers').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').order('sort_order'),
    supabase.from('notes').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(40),
    supabase.from('eod_reports').select('*').order('report_date', { ascending: false }).limit(8),
    supabase.from('calendar_events').select('*, clients(code, business_name)').gte('start_at', new Date().toISOString()).order('start_at').limit(6),
    supabase.rpc('get_team_directory'),
    profileId ? supabase.from('note_reads').select('*').eq('user_id', profileId) : Promise.resolve({ data: [], error: null }),
  ]))

  const error = clientsResult.error || tasksResult.error || blockersResult.error || workflowResult.error || notesResult.error || activityResult.error || eodResult.error || eventsResult.error || directoryResult.error || noteReadsResult.error
  if (error) throw error

  const clients = clientsResult.data || []
  const activeClientIds = new Set(clients.map((client) => client.id))
  const members = new Map((directoryResult.data || []).map((member) => [member.id, member]))
  const noteReads = new Map((noteReadsResult.data || []).map((receipt) => [receipt.note_id, receipt]))
  const belongsToActiveClient = (item) => !item.client_id || activeClientIds.has(item.client_id)

  return {
    clients,
    tasks: (tasksResult.data || []).filter(belongsToActiveClient),
    blockers: (blockersResult.data || []).filter(belongsToActiveClient),
    workflowSteps: (workflowResult.data || []).filter(belongsToActiveClient),
    notes: (notesResult.data || []).filter(belongsToActiveClient).map((note) => ({ ...note, receipt: noteReads.get(note.id) || null, author: members.get(note.created_by) || null })),
    activity: activityResult.data || [],
    eodReports: (eodResult.data || []).map((report) => {
      const member = members.get(report.user_id)
      return { ...report, profiles: member ? { full_name: member.full_name, role: member.role } : null }
    }),
    upcomingEvents: (eventsResult.data || []).filter(belongsToActiveClient),
    directory: directoryResult.data || [],
  }
}

export async function loadClient(clientId) {
  const [clientResult, tasksResult, blockersResult, workflowResult, auditResult, notesResult, adStatusResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at'),
    supabase.from('blockers').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').eq('client_id', clientId).order('sort_order'),
    supabase.from('client_audit_log').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('client_ad_status_events').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
  ]))

  const error = clientResult.error || tasksResult.error || blockersResult.error || workflowResult.error || auditResult.error || notesResult.error || adStatusResult.error
  if (error) throw error

  return { client: clientResult.data, tasks: tasksResult.data || [], blockers: blockersResult.data || [], workflowSteps: workflowResult.data || [], auditLog: auditResult.data || [], notes: notesResult.data || [], adStatusEvents: adStatusResult.data || [] }
}

export async function updateTaskStatus(taskId, status) {
  const { error } = await supabase.from('tasks').update({ status: normalizeStatus(status) }).eq('id', taskId)
  if (error) throw error
}

export async function updateTaskProgress(taskId, { status, statusNote, profileId }) {
  const note = statusNote.trim()
  const changes = {
    status: normalizeStatus(status),
    status_note: note,
    status_note_updated_at: note ? new Date().toISOString() : null,
    status_note_updated_by: note ? profileId : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('tasks').update(changes).eq('id', taskId).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function updateTaskAssignment(taskId, ownerRole) {
  const { error } = await supabase.from('tasks').update({ owner_role: ownerRole, owner_name: ownerNames[ownerRole] }).eq('id', taskId)
  if (error) throw error
}

export async function updateTaskManagement(taskId, { assignedTo, assigneeName, assigneeRole, priority, dueAt }) {
  const changes = {
    assigned_to: assignedTo || null,
    owner_role: assigneeRole || null,
    owner_name: assigneeName || 'Todos',
    priority: normalizePriority(priority),
    due_at: dueAt || null,
    due_label: dueAt || 'Sin fecha',
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('tasks').update(changes).eq('id', taskId)
  if (error) throw error
}

export async function updateTaskDetails(taskId, { clientId, title, details = '', assignedTo, assigneeName, assigneeRole, priority, dueAt, status }) {
  const changes = {
    client_id: clientId || null,
    title: title.trim(),
    evidence: details.trim(),
    comments: details.trim(),
    assigned_to: assignedTo || null,
    owner_role: assigneeRole || null,
    owner_name: assigneeName || 'Todos',
    priority: normalizePriority(priority),
    due_at: dueAt || null,
    due_label: dueAt || 'Sin fecha',
    status: normalizeStatus(status),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('tasks').update(changes).eq('id', taskId).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function createAssignedTask({ clientId, title, details = '', body = '', priority, assignedTo, assigneeName, assigneeRole, ownerRole, ownerName, dueAt }) {
  const resolvedRole = assigneeRole || ownerRole || null
  const resolvedName = assigneeName || ownerName || (resolvedRole ? ownerNames[resolvedRole] : 'Todos')
  const payload = {
    id: crypto.randomUUID(),
    client_id: clientId || null,
    title: title.trim(),
    evidence: (details || body).trim(),
    priority: normalizePriority(priority),
    assigned_to: assignedTo || null,
    owner_role: resolvedRole,
    owner_name: resolvedName,
    due_at: dueAt || null,
    due_label: dueAt || 'Sin fecha',
    comments: (details || body).trim(),
    phase: 'Asignada por administración',
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

export async function markGeneralNoteSeen(noteId, profileId) {
  const seenAt = new Date()
  const { data, error } = await supabase.from('note_reads').upsert({
    note_id: noteId,
    user_id: profileId,
    seen_at: seenAt.toISOString(),
    visible_until: new Date(seenAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'note_id,user_id' }).select('*').single()
  if (error) throw error
  return data
}

export async function convertGeneralNoteToTask({ note, assignee, profileId }) {
  const task = await createAssignedTask({
    clientId: note.client_id || null,
    title: note.title,
    details: note.body || 'Converted from team communications.',
    priority: 'Media',
    assignedTo: assignee?.id || null,
    assigneeName: assignee?.full_name || 'Todos',
    assigneeRole: assignee?.role || null,
    dueAt: null,
  })
  const { error } = await supabase.from('notes').update({
    task_id: task.id,
    converted_at: new Date().toISOString(),
    converted_by: profileId,
    updated_at: new Date().toISOString(),
  }).eq('id', note.id)
  if (error) throw error
  return task
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => onChange())
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
    assigned_role: client.assigned_role || 'onboarding_media',
  }
  const { data, error } = await supabase.from('clients').insert(payload).select('*').single()
  if (error) throw error
  return data
}

export async function updateClient(clientId, changes) {
  const { data, error } = await supabase.from('clients').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', clientId).select('*').single()
  if (error) throw error
  return data
}

export async function revealClientMetaToken(clientId) {
  const { data, error } = await supabase.rpc('reveal_client_meta_token', { p_client_id: clientId })
  if (error) throw error
  return data || ''
}

export async function saveClientMetaToken(clientId, token) {
  const { error } = await supabase.rpc('save_client_meta_token', { p_client_id: clientId, p_token: token.trim() })
  if (error) throw error
}

export async function recordDossierEvent(clientId, action, profileId) {
  const { error } = await supabase.from('client_dossier_events').insert({ client_id: clientId, action })
  if (error) throw error
  if (action === 'copied_google_docs') {
    const { error: updateError } = await supabase.from('clients').update({
      dossier_copied_at: new Date().toISOString(),
      dossier_copied_by: profileId,
    }).eq('id', clientId)
    if (updateError) throw updateError
  }
}

export async function markGoogleDocsUpdated(clientId, profileId) {
  const timestamp = new Date().toISOString()
  const { data, error } = await supabase.from('clients').update({
    google_docs_updated_at: timestamp,
    google_docs_updated_by: profileId,
    updated_at: timestamp,
  }).eq('id', clientId).select('*').single()
  if (error) throw error
  await recordDossierEvent(clientId, 'marked_google_docs_updated', profileId)
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
