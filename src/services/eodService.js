import { runWithSessionRetry, supabase } from '../lib/supabase'
import { createAssignedTask } from './opsService'

const canReviewAll = (profile) => profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)

function memberProfile(member) {
  return member ? { full_name: member.full_name, role: member.role, timezone: member.timezone } : null
}

export async function loadEodData(profile, { windowStart, windowEnd }) {
  const reviewer = canReviewAll(profile)
  const [reportsResult, tasksResult, reviewsResult, commentsResult, directoryResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('*').order('report_date', { ascending: false }).order('updated_at', { ascending: false }).limit(120),
    profile.role === 'superadmin'
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('tasks').select('id, title, completed_at, completed_by, clients(code, business_name)')
          .eq('completed_by', profile.id).gte('completed_at', windowStart).lte('completed_at', windowEnd)
          .order('completed_at', { ascending: false }),
    reviewer ? supabase.from('eod_report_reviews').select('*') : Promise.resolve({ data: [], error: null }),
    supabase.from('eod_report_comments').select('*').order('created_at'),
    supabase.rpc('get_team_directory'),
  ]))

  const error = reportsResult.error || tasksResult.error || reviewsResult.error || commentsResult.error || directoryResult.error
  if (error) throw error

  const members = new Map((directoryResult.data || []).map((member) => [member.id, member]))
  const reviews = reviewsResult.data || []
  const comments = commentsResult.data || []
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
  }))

  return { reports, completedTasks: tasksResult.data || [] }
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

export async function saveEodReport({ profileId, reportDate, periodStart, periodEnd, completedTasks, manualTasks, notes }) {
  const submittedAt = new Date().toISOString()
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
    ownerRole: assignee?.role || null,
    ownerName: assignee?.full_name || 'Equipo',
    dueAt: null,
  })
  const { error } = await supabase.from('eod_report_comments').update({
    task_id: task.id,
    updated_at: new Date().toISOString(),
  }).eq('id', comment.id)
  if (error) throw error
  return task
}
