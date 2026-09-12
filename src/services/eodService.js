import { runWithSessionRetry, supabase } from '../lib/supabase'

export async function loadEodData(profile, reportDate) {
  const start = `${reportDate}T00:00:00`
  const end = `${reportDate}T23:59:59.999`
  const [reportsResult, tasksResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('eod_reports').select('*, profiles(full_name, role)').order('report_date', { ascending: false }).limit(30),
    supabase.from('tasks').select('id, title, completed_at, clients(code, business_name)').or(`owner_role.eq.${profile.role},completed_by.eq.${profile.id}`).gte('completed_at', start).lte('completed_at', end).order('completed_at'),
  ]))
  const error = reportsResult.error || tasksResult.error
  if (error) throw error
  return { reports: reportsResult.data || [], completedTasks: tasksResult.data || [] }
}

export async function saveEodReport({ profileId, reportDate, completedTasks, manualTasks, notes }) {
  const { data, error } = await supabase.from('eod_reports').upsert({
    user_id: profileId,
    report_date: reportDate,
    completed_tasks: completedTasks,
    manual_tasks: manualTasks.filter((item) => item.trim()).map((title) => ({ title: title.trim() })),
    notes: notes.trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,report_date' }).select('*, profiles(full_name, role)').single()
  if (error) throw error
  return data
}
