import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadEodData(profile, { windowStart, windowEnd }) {
  const [reportsResult, tasksResult] = await runWithSessionRetry(() => Promise.all([
    supabase
      .from('eod_reports')
      .select('*, profiles(full_name, role)')
      .order('report_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(120),
    profile.role === 'superadmin'
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('tasks')
          .select('id, title, completed_at, completed_by, clients(code, business_name)')
          .eq('completed_by', profile.id)
          .gte('completed_at', windowStart)
          .lte('completed_at', windowEnd)
          .order('completed_at', { ascending: false }),
  ]))
  const error = reportsResult.error || tasksResult.error
  if (error) throw error
  return { reports: reportsResult.data || [], completedTasks: tasksResult.data || [] }
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
  }, { onConflict: 'user_id,report_date' }).select('*, profiles(full_name, role)').single()
  if (error) throw error
  return data
}
