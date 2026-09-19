import { runWithSessionRetry, supabase } from '../lib/supabase'
import { createAssignedTask } from './opsService'
import { getCalendarDayWindow } from '../utils/timeZone'

const canReviewAll = (profile) => profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
export const DEFAULT_KEVIN_TIME_ZONE = 'America/New_York'

function memberProfile(member) {
  return member ? { full_name: member.full_name, role: member.role, timezone: member.timezone } : null
}

export function getDateInTimeZone(date = new Date(), timeZone = DEFAULT_KEVIN_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function getTimeInTimeZone(date = new Date(), timeZone = DEFAULT_KEVIN_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return { hour: Number(parts.hour), minute: Number(parts.minute), value: `${parts.hour}:${parts.minute}` }
}

export function isPastKevinCutoff(timeZone, date = new Date()) {
  return getTimeInTimeZone(date, timeZone).hour >= 20
}

function resolveKevinTimeZone(members) {
  return members.find((member) => member.role === 'superadmin')?.timezone || DEFAULT_KEVIN_TIME_ZONE
}

export async function loadEodData(profile, { windowStart, windowEnd }) {
  const reviewer = canReviewAll(profile)
  const historyStart = new Date()
  historyStart.setDate(historyStart.getDate() - 120)
  const [reportsResult, tasksResult, reviewsResult, commentsResult, directoryResult, dailyStatusesResult, timeEntriesResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('*').order('report_date', { ascending: false }).order('updated_at', { ascending: false }).limit(120),
    profile.role === 'superadmin'
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('tasks').select('id, title, status_note, completed_at, completed_by, clients(code, business_name)')
          .eq('completed_by', profile.id).gte('completed_at', windowStart).lte('completed_at', windowEnd)
          .order('completed_at', { ascending: false }),
    reviewer ? supabase.from('eod_report_reviews').select('*') : Promise.resolve({ data: [], error: null }),
    supabase.from('eod_report_comments').select('*').order('created_at'),
    supabase.rpc('get_team_directory'),
    supabase.from('eod_daily_status').select('*').order('work_date', { ascending: false }).limit(500),
    supabase.from('time_entries').select('*').gte('work_date', historyStart.toISOString().slice(0, 10)).order('work_date', { ascending: false }),
  ]))

  const error = reportsResult.error || tasksResult.error || reviewsResult.error || commentsResult.error || directoryResult.error || dailyStatusesResult.error || timeEntriesResult.error
  if (error) throw error

  const directory = directoryResult.data || []
  const members = new Map(directory.map((member) => [member.id, member]))
  const reviews = reviewsResult.data || []
  const comments = commentsResult.data || []
  const timeEntries = (timeEntriesResult.data || []).map((entry) => ({ ...entry, profiles: memberProfile(members.get(entry.user_id)) }))
  const reports = (reportsResult.data || []).map((report) => ({
    ...report,
    profiles: memberProfile(members.get(report.user_id)),
    reviews: reviews.filter((review) => review.report_id === report.id).map((review) => ({
      ...review,
      reviewer: memberProfile(members.get(review.reviewer_id)),
    })),
    comments: comments.filter((comment) => comment.report_id === report.id).map((comment) => ({
      ...comment,
      author: memberProfile(members.get(comment.author_id)),
    })),
    time_entries: timeEntries.filter((entry) => entry.eod_report_id === report.id),
  }))

  return {
    reports,
    completedTasks: tasksResult.data || [],
    dailyStatuses: dailyStatusesResult.data || [],
    directory,
    timeEntries,
    kevinTimeZone: resolveKevinTimeZone(directory),
  }
}

export async function loadOwnEodState(profile) {
  if (profile?.role === 'superadmin' || !profile?.permissions?.eod_reports) return { required: false }
  const { data: directory, error: directoryError } = await runWithSessionRetry(() => supabase.rpc('get_team_directory'))
  if (directoryError) throw directoryError
  const kevinTimeZone = resolveKevinTimeZone(directory || [])
  const workDate = getDateInTimeZone(new Date(), kevinTimeZone)
  const workDay = getCalendarDayWindow(new Date(), kevinTimeZone)
  const [reportResult, statusResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('id').eq('user_id', profile.id)
      .gte('submitted_at', workDay.start.toISOString()).lte('submitted_at', workDay.end.toISOString()).limit(1).maybeSingle(),
    supabase.from('eod_daily_status').select('*').eq('user_id', profile.id).eq('work_date', workDate).maybeSingle(),
  ]))
  const error = reportResult.error || statusResult.error
  if (error) throw error
  return {
    required: true,
    submitted: Boolean(reportResult.data),
    status: statusResult.data || null,
    workDate,
    kevinTimeZone,
    afterCutoff: isPastKevinCutoff(kevinTimeZone),
  }
}

export async function loadEodComplianceSummary(profile) {
  if (!canReviewAll(profile)) return null
  const { data: directory, error: directoryError } = await runWithSessionRetry(() => supabase.rpc('get_team_directory'))
  if (directoryError) throw directoryError
  const members = (directory || []).filter((member) => member.role !== 'superadmin')
  const kevinTimeZone = resolveKevinTimeZone(directory || [])
  const day = getCalendarDayWindow(new Date(), kevinTimeZone)
  const workDate = day.reportDate
  const [reportsResult, statusesResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('user_id, submitted_at, updated_at')
      .gte('submitted_at', day.start.toISOString()).lte('submitted_at', day.end.toISOString()),
    supabase.from('eod_daily_status').select('*').eq('work_date', workDate),
  ]))
  const error = reportsResult.error || statusesResult.error
  if (error) throw error
  const reports = reportsResult.data || []
  const statuses = statusesResult.data || []
  const rows = members.map((member) => {
    const submitted = reports.some((report) => report.user_id === member.id)
    const status = statuses.find((item) => item.user_id === member.id)
    return { member, status, state: submitted ? 'submitted' : status?.status === 'working_late' ? 'working_late' : 'pending' }
  })
  const counts = rows.reduce((totals, row) => ({ ...totals, [row.state]: totals[row.state] + 1 }), { submitted: 0, working_late: 0, pending: 0 })
  return { workDate, kevinTimeZone, rows, counts }
}

export async function saveLateWorkStatus({ profileId, workDate, currentTask, expectedReportTime }) {
  const cleanTask = currentTask.trim()
  const slackNotice = `Still working on ${cleanTask || '[Task]'}, EOD report coming at ${expectedReportTime || '[Time]'} Kevin time.`
  const { data, error } = await supabase.from('eod_daily_status').upsert({
    user_id: profileId,
    work_date: workDate,
    status: 'working_late',
    current_task: cleanTask,
    expected_report_time: expectedReportTime || null,
    slack_notice: slackNotice,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,work_date' }).select('*').single()
  if (error) throw error
  return data
}

export async function loadUnreadEodCount(profile) {
  if (!canReviewAll(profile)) return 0
  const [reportsResult, reviewsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('id, updated_at').limit(200),
    supabase.from('eod_report_reviews').select('report_id, viewed_at').eq('reviewer_id', profile.id),
  ]))
  const error = reportsResult.error || reviewsResult.error
  if (error) throw error
  const viewed = new Map((reviewsResult.data || []).map((review) => [review.report_id, review.viewed_at]))
  return (reportsResult.data || []).filter((report) => {
    const viewedAt = viewed.get(report.id)
    return !viewedAt || new Date(viewedAt) < new Date(report.updated_at)
  }).length
}

export async function saveEodReport({ profileId, reportDate, complianceDate = reportDate, periodStart, periodEnd, completedTasks, manualTasks, timeEntries, notes }) {
  const submittedAt = new Date().toISOString()
  const startedEntries = timeEntries.filter((entry) => entry.hours || entry.memo.trim())
  if (startedEntries.some((entry) => !(Number(entry.hours) > 0) || !entry.memo.trim())) throw new Error('Cada registro de tiempo necesita horas y memo.')
  const cleanEntries = startedEntries.map((entry) => ({
    user_id: profileId,
    work_date: reportDate,
    hours: Number(entry.hours),
    memo: entry.memo.trim(),
  }))
  if (cleanEntries.reduce((sum, entry) => sum + entry.hours, 0) > 24) throw new Error('Las horas del día no pueden superar 24.')
  const { data, error } = await supabase.from('eod_reports').upsert({
    user_id: profileId,
    report_date: reportDate,
    period_start: periodStart,
    period_end: periodEnd,
    submitted_at: submittedAt,
    completed_tasks: completedTasks,
    manual_tasks: manualTasks.filter((item) => item.trim()).map((title) => ({ title: title.trim() })),
    notes: notes.trim(),
    updated_at: submittedAt,
  }, { onConflict: 'user_id,report_date' }).select('*').single()
  if (error) throw error
  const { error: timeError } = await supabase.rpc('replace_eod_time_entries', {
    p_report_id: data.id,
    p_work_date: reportDate,
    p_entries: cleanEntries.map(({ hours, memo }) => ({ hours, memo })),
  })
  if (timeError) throw timeError
  const { error: statusError } = await supabase.from('eod_daily_status').upsert({
    user_id: profileId,
    work_date: complianceDate,
    status: 'submitted',
    updated_at: submittedAt,
  }, { onConflict: 'user_id,work_date' })
  if (statusError) throw statusError
  return data
}

export async function saveEodReview({ reportId, reviewerId, status }) {
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('eod_report_reviews').upsert({
    report_id: reportId,
    reviewer_id: reviewerId,
    status,
    viewed_at: now,
    reviewed_at: status === 'Visto' ? null : now,
    updated_at: now,
  }, { onConflict: 'report_id,reviewer_id' }).select('*').single()
  if (error) throw error
  return data
}

export async function addEodComment({ reportId, authorId, body }) {
  const { data, error } = await supabase.from('eod_report_comments').insert({
    report_id: reportId,
    author_id: authorId,
    body: body.trim(),
  }).select('*').single()
  if (error) throw error
  return data
}

export async function convertEodCommentToTask({ report, comment }) {
  const assignee = report.profiles
  const task = await createAssignedTask({
    clientId: null,
    title: comment.body.slice(0, 160),
    details: `Seguimiento del reporte EOD de ${assignee?.full_name || 'usuario'} correspondiente a ${report.report_date}.`,
    priority: 'Alta',
    assignedTo: report.user_id,
    assigneeRole: assignee?.role || null,
    assigneeName: assignee?.full_name || 'Equipo',
    dueAt: null,
  })
  const { error } = await supabase.from('eod_report_comments').update({
    task_id: task.id,
    updated_at: new Date().toISOString(),
  }).eq('id', comment.id)
  if (error) throw error
  return task
}
