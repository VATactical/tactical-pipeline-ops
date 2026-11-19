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
  const [clientsResult, tasksResult, blockersResult, workflowResult, notesResult, activityResult, eodResult, directoryResult, noteReadsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('clients').select('*').eq('archived', false).order('code'),
    supabase.from('tasks').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('blockers').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').order('sort_order'),
    supabase.from('notes').select('*, clients(code, business_name)').order('created_at', { ascending: false }),
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(40),
    supabase.from('eod_reports').select('*').order('report_date', { ascending: false }).limit(8),
    supabase.rpc('get_team_directory'),
    profileId ? supabase.from('note_reads').select('*').eq('user_id', profileId) : Promise.resolve({ data: [], error: null }),
  ]))

  const error = clientsResult.error || tasksResult.error || blockersResult.error || workflowResult.error || notesResult.error || activityResult.error || eodResult.error || directoryResult.error || noteReadsResult.error
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
    directory: directoryResult.data || [],
  }
}

export async function loadClient(clientId) {
  const [clientResult, tasksResult, blockersResult, workflowResult, auditResult, notesResult, adStatusResult, directoryResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('tasks').select('*').eq('client_id', clientId).order('created_at'),
    supabase.from('blockers').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('client_workflow_steps').select('*').eq('client_id', clientId).order('sort_order'),
    supabase.from('client_audit_log').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    supabase.from('notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('client_ad_status_events').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(30),
    supabase.rpc('get_team_directory'),
  ]))

  const error = clientResult.error || tasksResult.error || blockersResult.error || workflowResult.error || auditResult.error || notesResult.error || adStatusResult.error || directoryResult.error
  if (error) throw error

  const members = new Map((directoryResult.data || []).map((member) => [member.id, member]))
  return { client: clientResult.data, tasks: tasksResult.data || [], blockers: blockersResult.data || [], workflowSteps: workflowResult.data || [], auditLog: auditResult.data || [], notes: (notesResult.data || []).map((note) => ({ ...note, author: members.get(note.created_by) || null })), adStatusEvents: adStatusResult.data || [], directory: directoryResult.data || [] }
}

export async function createClientNote({ clientId, profileId, title, body }) {
  const cleanTitle = title.trim()
  if (!cleanTitle) throw new Error('Escribe un título para la nota.')
  const { data, error } = await supabase.from('notes').insert({
    client_id: clientId,
    created_by: profileId,
    title: cleanTitle,
    body: body.trim(),
  }).select('*').single()
  if (error) throw error
  return data
}

export async function updateClientNote(noteId, { title, body }) {
  const cleanTitle = title.trim()
  if (!cleanTitle) throw new Error('Escribe un título para la nota.')
  const { data, error } = await supabase.from('notes')
    .update({ title: cleanTitle, body: body.trim(), updated_at: new Date().toISOString() })
    .eq('id', noteId).select('*').single()
  if (error) throw error
  return data
}

export async function deleteClientNote(noteId) {
  const { error } = await supabase.from('notes').delete().eq('id', noteId)
  if (error) throw error
}

export async function deleteClientTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}
export async function deleteArchivedClient(clientId) {
  const { data, error } = await supabase.from('clients')
    .delete()
    .eq('id', clientId)
    .eq('archived', true)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Solo se pueden eliminar clientes archivados.')
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

export async function updateTaskDetails(taskId, { clientId, title, details = '', assignedTo, assigneeName, assigneeRole, priority, dueAt, status, nextStep = '' }) {
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
    next_step: nextStep.trim(),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('tasks').update(changes).eq('id', taskId).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function createAssignedTask({ clientId, title, details = '', body = '', priority, assignedTo, assigneeName, assigneeRole, ownerRole, ownerName, dueAt, nextStep = '' }) {
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
    next_step: nextStep.trim(),
    comments: (details || body).trim(),
    phase: 'Asignada por administración',
    status: 'Pendiente',
  }
  const { data, error } = await supabase.from('tasks').insert(payload).select('*, clients(code, business_name)').single()
  if (error) throw error
  return data
}

export async function createTeamNote({ clientId, title, body, slackChannel = '#daily-comms-hub' }) {
  const { data, error } = await supabase.from('notes').insert({
    client_id: clientId || null,
    title: title.trim(),
    body: body.trim(),
    slack_channel: slackChannel,
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

export async function loadUnreadCommunicationCount(profileId) {
  if (!profileId) return 0
  const [notesResult, readsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('notes').select('id'),
    supabase.from('note_reads').select('note_id').eq('user_id', profileId),
  ]))
  const error = notesResult.error || readsResult.error
  if (error) throw error
  const readIds = new Set((readsResult.data || []).map((item) => item.note_id))
  return (notesResult.data || []).filter((note) => !readIds.has(note.id)).length
}

export function subscribeToOperations(onChange) {
  const channel = supabase.channel(`operations-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => onChange(payload))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (payload) => onChange(payload))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

export async function createClient(client) {
  const payload = {
    ...client,
    id: crypto.randomUUID(),
    code: client.code.trim().toUpperCase(),
    business_name: client.business_name.trim(),
    legal_name: client.legal_name?.trim() || '',
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

export async function reassignClientCode(clientId, code) {
  const { data, error } = await supabase.rpc('reassign_client_code', { p_client_id: clientId, p_new_code: code })
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

export async function recordDossierEvent(clientId, action, profileId, occurredAt = new Date().toISOString()) {
  const { error } = await supabase.from('client_dossier_events').insert({ client_id: clientId, action })
  if (error) throw error
  if (action === 'copied_google_docs') {
    const { error: updateError } = await supabase.from('clients').update({
      dossier_copied_at: occurredAt,
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

export async function loadClientGhlMetrics(clientId) {
  const { data, error } = await supabase.from('client_ghl_metrics').select('*').eq('client_id', clientId).order('period_start', { ascending: false }).limit(24)
  if (error) throw error
  return data || []
}

export async function isClientGhlTokenConfigured(clientId) {
  const { data, error } = await supabase.rpc('client_ghl_token_configured', { p_client_id: clientId })
  if (error) throw error
  return Boolean(data)
}

export async function saveClientGhlToken(clientId, token) {
  const { error } = await supabase.rpc('save_client_ghl_token', { p_client_id: clientId, p_token: token.trim() })
  if (error) throw error
}

// options: { history: N } stores the last N billing cycles; { from, to } returns live counts for a range.
export async function syncClientGhlMetrics(clientId, options = {}) {
  const { data, error } = await supabase.functions.invoke('ghl-metrics-sync', { body: clientId ? { clientId, ...options } : {} })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}

export async function setClientPeriodSpend(clientId, periodStart, periodEnd, amount) {
  const { error } = await supabase.rpc('set_client_period_spend', {
    p_client_id: clientId, p_period_start: periodStart, p_period_end: periodEnd, p_amount: amount,
  })
  if (error) throw error
}

export function fetchClientGhlRange(clientId, from, to) {
  return syncClientGhlMetrics(clientId, { from, to })
}

// Checklist evidence: screenshots stored privately in the step-evidence bucket.
const EVIDENCE_BUCKET = 'step-evidence'
const EVIDENCE_MAX_SIDE = 1600

// Downscale and convert to WebP in the browser so a screenshot weighs ~150-250 KB.
async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, EVIDENCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
  if (!blob) throw new Error('No se pudo procesar la imagen.')
  return { blob, width, height }
}

export async function loadStepEvidence(clientId) {
  const { data, error } = await supabase.from('client_step_evidence').select('*').eq('client_id', clientId).order('created_at')
  if (error) throw error
  const rows = data || []
  if (!rows.length) return []
  const { data: signed, error: signError } = await supabase.storage.from(EVIDENCE_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), 60 * 60)
  if (signError) throw signError
  const urls = new Map((signed || []).map((item) => [item.path, item.signedUrl]))
  return rows.map((row) => ({ ...row, url: urls.get(row.storage_path) || null }))
}

export async function uploadStepEvidence({ clientId, stepId, file }) {
  if (!file?.type?.startsWith('image/')) throw new Error('Solo se pueden subir imágenes.')
  if (file.size > 15 * 1024 * 1024) throw new Error('La imagen pesa más de 15 MB.')
  const { blob, width, height } = await compressImage(file)
  const path = `${clientId}/${stepId}/${crypto.randomUUID()}.webp`
  const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (uploadError) throw uploadError
  const { error } = await supabase.from('client_step_evidence').insert({
    step_id: stepId, client_id: clientId, storage_path: path,
    file_name: (file.name || 'captura').slice(0, 200), size_bytes: blob.size, width, height,
  })
  if (error) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path])
    throw error
  }
}

export async function deleteStepEvidence(evidence) {
  const { data, error } = await supabase.from('client_step_evidence').delete().eq('id', evidence.id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Solo quien subió la captura o un administrador de operaciones puede eliminarla.')
  await supabase.storage.from(EVIDENCE_BUCKET).remove([evidence.storage_path])
}

// Lifecycle board (Trello replacement): columns, client cards and moves.
export async function loadLifecycleBoard() {
  const [stagesResult, clientsResult, stepsResult, commentsResult, ticketsResult, suggestionsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('lifecycle_board_stages').select('*').eq('archived', false).order('sort_order'),
    supabase.from('clients')
      .select('id, code, business_name, owner_name, status, phase, daily_budget, board_stage, board_position, board_stage_changed_at, target_launch_date, ads_pause_reason, updated_at')
      .eq('archived', false),
    supabase.from('client_workflow_steps').select('client_id, completed'),
    supabase.from('client_comments').select('client_id').is('deleted_at', null),
    supabase.from('ticket_clients').select('client_id, tickets!inner(status)').not('tickets.status', 'in', '("Resolved","Closed")'),
    supabase.from('client_dossier_suggestions').select('client_id').eq('status', 'pending'),
  ]))
  const error = stagesResult.error || clientsResult.error || stepsResult.error
  if (error) throw error
  const progress = new Map()
  for (const step of stepsResult.data || []) {
    const item = progress.get(step.client_id) || { done: 0, total: 0 }
    item.total += 1
    if (step.completed) item.done += 1
    progress.set(step.client_id, item)
  }
  // Comments and tickets only add badges: if those tables fail, the board still loads.
  const commentCount = new Map()
  for (const row of commentsResult.data || []) commentCount.set(row.client_id, (commentCount.get(row.client_id) || 0) + 1)
  const ticketCount = new Map()
  for (const row of ticketsResult.data || []) if (row.client_id) ticketCount.set(row.client_id, (ticketCount.get(row.client_id) || 0) + 1)
  const suggestionCount = new Map()
  for (const row of suggestionsResult?.data || []) suggestionCount.set(row.client_id, (suggestionCount.get(row.client_id) || 0) + 1)
  return {
    stages: stagesResult.data || [],
    clients: (clientsResult.data || []).map((client) => ({
      ...client,
      progress: progress.get(client.id) || { done: 0, total: 0 },
      commentCount: commentCount.get(client.id) || 0,
      openTickets: ticketCount.get(client.id) || 0,
      slackSuggestions: suggestionCount.get(client.id) || 0,
    })),
  }
}

export async function moveClientOnBoard(clientId, stage, position) {
  const { data, error } = await supabase.rpc('move_client_on_board', { p_client_id: clientId, p_stage: stage, p_position: position })
  if (error) throw error
  return data
}

export async function createBoardClient({ businessName, stage, code }) {
  const { data, error } = await supabase.rpc('create_board_client', { p_business_name: businessName, p_stage: stage, p_code: code || null })
  if (error) throw error
  return data
}

export async function saveBoardStage(stage) {
  const payload = {
    name: stage.name.trim(),
    name_en: (stage.name_en || '').trim(),
    owner_hint: (stage.owner_hint || '').trim(),
    sort_order: stage.sort_order,
    color: stage.color || 'slate',
    archived: Boolean(stage.archived),
    updated_at: new Date().toISOString(),
  }
  const query = stage.isNew
    ? supabase.from('lifecycle_board_stages').insert({ ...payload, key: stage.key })
    : supabase.from('lifecycle_board_stages').update(payload).eq('key', stage.key)
  const { error } = await query
  if (error) throw error
}

// Client log ("bitácora"): quick comments on a client.
export async function loadClientComments(clientId) {
  const [commentsResult, directoryResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('client_comments').select('*').eq('client_id', clientId).is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
    supabase.rpc('get_team_directory'),
  ]))
  if (commentsResult.error) throw commentsResult.error
  const members = new Map((directoryResult.data || []).map((member) => [member.id, member]))
  return (commentsResult.data || []).map((comment) => ({ ...comment, author: members.get(comment.author_id) || null }))
}

export async function addClientComment({ clientId, profileId, kind, body, sendToSlack = false }) {
  const clean = body.trim()
  if (!clean) throw new Error('Escribe el comentario.')
  const { error } = await supabase.from('client_comments').insert({ client_id: clientId, author_id: profileId, kind, body: clean, send_to_slack: Boolean(sendToSlack) })
  if (error) throw error
}

export async function updateClientComment(commentId, { kind, body }) {
  const clean = body.trim()
  if (!clean) throw new Error('Escribe el comentario.')
  const { data, error } = await supabase.from('client_comments').update({ kind, body: clean }).eq('id', commentId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Solo quien escribió el comentario o un administrador de operaciones puede editarlo.')
}

export async function deleteClientComment(commentId) {
  const { data, error } = await supabase.from('client_comments').update({ deleted_at: new Date().toISOString() }).eq('id', commentId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Solo quien escribió el comentario o un administrador de operaciones puede eliminarlo.')
}

// Tickets of one client (TOPS Tickets module, including the ones synced from Slack).
const CLOSED_TICKET_STATUSES = ['Resolved', 'Closed']
export async function loadClientTickets(clientId) {
  const { data, error } = await supabase.from('ticket_clients')
    .select('ticket_id, tickets(id, ticket_number, title, status, priority, source, slack_summary, slack_owner_name, source_url, created_at, updated_at, assigned_to)')
    .eq('client_id', clientId)
  if (error) throw error
  return (data || []).map((row) => row.tickets).filter(Boolean)
    .sort((a, b) => Number(CLOSED_TICKET_STATUSES.includes(a.status)) - Number(CLOSED_TICKET_STATUSES.includes(b.status)) || a.ticket_number.localeCompare(b.ticket_number, undefined, { numeric: true }))
}

export async function syncSlackTickets() {
  const { data, error } = await supabase.functions.invoke('slack-ticket-sync', { body: {} })
  if (error) {
    const detail = await error.context?.json?.().catch(() => null)
    throw new Error(detail?.error || error.message)
  }
  return data
}

// Dossier values found in the client's Slack channel, waiting for someone to apply or dismiss them.
export async function loadDossierSuggestions(clientId) {
  const { data, error } = await supabase.from('client_dossier_suggestions')
    .select('*').eq('client_id', clientId).eq('status', 'pending').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function resolveDossierSuggestion(suggestionId, apply) {
  const { data, error } = await supabase.rpc('resolve_dossier_suggestion', { p_id: suggestionId, p_apply: Boolean(apply) })
  if (error) throw error
  return data
}
