import { runWithSessionRetry, supabase } from '../lib/supabase'

const number = (value) => Math.max(0, Number(value || 0))
const ratio = (numerator, denominator, multiplier = 1) => denominator > 0 ? Number(((numerator / denominator) * multiplier).toFixed(2)) : 0

export async function loadAdsReports(clientId) {
  const [reportsResult, directoryResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('ad_performance_reports').select('*').eq('client_id', clientId).order('report_date', { ascending: false }),
    supabase.rpc('get_team_directory'),
  ]))
  const error = reportsResult.error || directoryResult.error
  if (error) throw error
  const members = new Map((directoryResult.data || []).map((member) => [member.id, member]))
  return (reportsResult.data || []).map((report) => ({ ...report, author: members.get(report.created_by) || null }))
}

export async function saveAdsReport(clientId, profileId, values) {
  const spend = number(values.spend)
  const impressions = number(values.impressions)
  const reach = number(values.reach)
  const clicks = number(values.clicks)
  const leads = number(values.leads)
  const appointments = number(values.appointments)
  const payload = {
    client_id: clientId,
    report_date: values.reportDate,
    period_start: values.periodStart,
    period_end: values.periodEnd,
    report_status: values.reportStatus,
    spend,
    impressions,
    reach,
    clicks,
    ctr: ratio(clicks, impressions, 100),
    cpc: ratio(spend, clicks),
    leads,
    cpl: ratio(spend, leads),
    appointments,
    cost_per_appointment: ratio(spend, appointments),
    summary: values.summary.trim(),
    wins: values.wins.trim(),
    issues: values.issues.trim(),
    next_steps: values.nextSteps.trim(),
    created_by: profileId,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('ad_performance_reports').upsert(payload, { onConflict: 'client_id,report_date' }).select('*').single()
  if (error) throw error
  return data
}
