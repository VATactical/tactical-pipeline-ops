import { runWithSessionRetry, supabase } from '../lib/supabase'

// Media Buyer view: one row per active client with the campaign fields of the Marketing Master
// Sheet (PMS). Every value is the client's dossier field, so edits here show up in the dossier.

const CLIENT_FIELDS = [
  'id', 'code', 'business_name', 'status', 'ads_pause_reason', 'ads_paused_at', 'meta_ad_account_id', 'ad_account_name',
  'conversion_location', 'instant_form_name', 'landing_page_url', 'facebook_page_url', 'daily_budget', 'ads_targeting_address',
  'targeting_radius_miles', 'markets', 'target_zip_codes', 'address', 'ad_creatives_link', 'booking_calendar_link', 'ad_result_status', 'google_docs_url',
  'drive_folder_link', 'updated_at',
].join(', ')

const PAYMENT_ERROR = /^payment error|payment (error|method|declin|fail)|m[eé]todo de pago|tarjeta (rechazada|declinada)|error de pago/i

export const AD_STATUSES = ['Active', 'Paused', 'Payment Error', 'Draft']

// TP OPS status -> the buyer's "Ad Status".
export function adStatusOf(client) {
  if (client.status === 'ADS LIVE' || client.status === 'CRUISE CONTROL') return 'Active'
  if (client.status === 'ADS PAUSED') return PAYMENT_ERROR.test(client.ads_pause_reason || '') ? 'Payment Error' : 'Paused'
  return 'Draft'
}

export async function loadMediaBuyerData(profileId) {
  const [clientsResult, commentsResult, tasksResult, suggestionsResult, signalsResult] = await runWithSessionRetry(() => Promise.all([
    supabase.from('clients').select(CLIENT_FIELDS).eq('archived', false).order('code'),
    supabase.from('client_comments').select('id, client_id, body, kind, created_at').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(400),
    supabase.from('tasks').select('id, client_id, title, comments, priority, due_at, status, clients(code, business_name)')
      .eq('assigned_to', profileId).neq('status', 'Completada').order('due_at', { ascending: true, nullsFirst: false }),
    supabase.from('client_dossier_suggestions').select('id, client_id, field, suggested_value, excerpt, slack_user_name, source_url, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }),
    supabase.from('client_status_signals').select('id, client_id, signal, excerpt, slack_user_name, created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }),
  ]))
  const error = clientsResult.error || commentsResult.error || tasksResult.error
  if (error) throw error
  const latestComment = new Map()
  for (const comment of commentsResult.data || []) if (!latestComment.has(comment.client_id)) latestComment.set(comment.client_id, comment)
  // Newest pending Slack suggestion per client and field.
  const suggestions = new Map()
  for (const item of suggestionsResult.data || []) {
    const key = `${item.client_id}|${item.field}`
    if (!suggestions.has(key)) suggestions.set(key, item)
  }
  const clients = (clientsResult.data || []).map((client) => ({
    ...client, adStatus: adStatusOf(client), lastComment: latestComment.get(client.id) || null,
    signals: (signalsResult.data || []).filter((item) => item.client_id === client.id),
    suggestions: Object.fromEntries([...suggestions.values()].filter((item) => item.client_id === client.id).map((item) => [item.field, item])),
  }))
  return { clients, tasks: tasksResult.data || [] }
}

export async function updateBuyerField(clientId, changes) {
  const { data, error } = await supabase.from('clients').update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', clientId).select(CLIENT_FIELDS).single()
  if (error) throw error
  return { ...data, adStatus: adStatusOf(data) }
}

// Active <-> Paused <-> Payment Error. Pausing needs a reason (the same rule as the dossier).
export async function changeAdStatus(client, next, reason = '') {
  const current = client.adStatus
  if (next === current) return client
  if (next === 'Active') return updateBuyerField(client.id, { status: 'ADS LIVE' })
  const clean = reason.trim()
  if (!clean) throw new Error('Escribe el motivo de la pausa.')
  const fullReason = next === 'Payment Error' && !PAYMENT_ERROR.test(clean) ? `Payment Error: ${clean}` : clean
  if (current === 'Active') {
    if (client.status !== 'ADS LIVE') throw new Error('Solo se pueden pausar clientes en ADS LIVE.')
    return updateBuyerField(client.id, { status: 'ADS PAUSED', ads_pause_reason: fullReason })
  }
  if (current === 'Paused' || current === 'Payment Error') return updateBuyerField(client.id, { ads_pause_reason: fullReason })
  throw new Error('Este cliente aún no tiene anuncios lanzados.')
}

const csvCell = (value) => {
  const text = String(value ?? '')
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// The PMS layout, as a CSV that opens in Excel or Google Sheets.
export function downloadPmsCsv(clients) {
  const header = ['Client Name', 'Onboarding information', 'Ad Account Name', 'Ad Status', 'Reason', 'Result Status', 'Conversion Location',
    'Instant Form name/ Landing page link', 'Facebook Page', 'Daily Ad Spend', 'Targeted Location For Ads', 'Ad Creatives', 'Booking Calendar  Link', 'Notes']
  const rows = clients.map((client) => [
    `${client.code} · ${client.business_name}`, client.google_docs_url || `${window.location.origin}/clientes/${client.id}`,
    client.ad_account_name || client.meta_ad_account_id || '', client.adStatus, client.adStatus === 'Paused' || client.adStatus === 'Payment Error' ? client.ads_pause_reason : '',
    client.ad_result_status, client.conversion_location,
    client.conversion_location === 'Instant Form' ? client.instant_form_name : client.landing_page_url,
    client.facebook_page_url, client.daily_budget ? `$${client.daily_budget}` : '',
    [client.targeting_radius_miles ? `${client.targeting_radius_miles} mi` : '', client.ads_targeting_address || client.markets || client.target_zip_codes].filter(Boolean).join(' · '),
    client.ad_creatives_link, client.booking_calendar_link, client.lastComment?.body || '',
  ])
  const csv = `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `TP_OPS_Media_Buyer_${new Date().toISOString().slice(0, 10)}.csv` })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
