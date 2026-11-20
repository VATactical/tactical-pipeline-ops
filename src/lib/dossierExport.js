const pending = (value) => {
  if (value == null || value === '' || /^(null|undefined|n\/?a|none)$/i.test(String(value).trim())) return 'Pending'
  return String(value)
}
const yesNo = (value) => value ? 'YES' : 'NO'
const money = (value) => value == null || value === '' || Number(value) <= 0 ? 'Pending' : `${Number(value).toLocaleString('en-US')}`
const date = (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : 'Pending'
const dateTime = (value) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(value)) : 'Pending'

const radius = (value) => value == null || value === '' ? 'Pending' : `${value} miles`
const yesNoPending = (value) => value == null ? 'Pending' : yesNo(value)
const checklistPhases = [
  ['prep', 'SALE & PREPARATION'], ['call', 'ONBOARDING CALL'], ['build', 'BUILD'], ['launch', 'QA & LAUNCH'], ['post', 'AFTER LAUNCH'],
]

function checklistText(workflowSteps = []) {
  if (!workflowSteps.length) return ''
  const done = workflowSteps.filter((step) => step.completed).length
  const blocks = checklistPhases.map(([phase, label]) => {
    const steps = workflowSteps.filter((step) => step.phase === phase)
    if (!steps.length) return ''
    return `${label} (${steps.filter((step) => step.completed).length}/${steps.length})\n` +
      steps.map((step) => `  [${step.completed ? 'x' : ' '}] ${step.title_en || step.title}`).join('\n')
  }).filter(Boolean)
  return `\n[LAUNCH CHECKLIST — ${done}/${workflowSteps.length} COMPLETE]\n\n${blocks.join('\n\n')}\n`
}

// Sections mirror the dossier: onboarding form first, then the call, then each platform.
export function buildDossierText(client, updatedBy = 'Pending', { lastUpdatedAt = client.updated_at, copiedAt = null, workflowSteps = [] } = {}) {
  return `==================================================
TACTICAL PIPELINE — ACTIVE CLIENT DOSSIER
==================================================

[BUSINESS & CONTACT]

• Client Code: ${pending(client.code)}
• Registered Business Name: ${pending(client.legal_name)}
• Business Name: ${pending(client.business_name)}
• Contact Name: ${pending(client.owner_name)}
• Contact Phone: ${pending(client.contact_phone)}
• Contact Email: ${pending(client.contact_email)}
• Business Phone: ${pending(client.phone)}
• Business Email: ${pending(client.email)}
• Business Address: ${pending(client.address)}
• Timezone: ${pending(client.timezone)}
• Preferred Onboarding-Call Language: ${pending(client.onboarding_call_language)}
• Business Hours / Availability: ${pending(client.appointment_availability)}
• EIN / Tax ID Status: ${pending(client.legal_business_info)}

[OFFER & MARKET]

• Services: ${pending(client.services)}
• Offers / Discounts: ${pending(client.offer)}
• Price Range / Minimum Project: ${money(client.minimum_project)}
• Ideal Customer Profile: ${pending(client.ideal_customer_profile)}

[AD TARGETING]

• Targeting Center Address: ${pending(client.ads_targeting_address)}
• Targeting Radius: ${radius(client.targeting_radius_miles)}
• Cities / Service Areas: ${pending(client.markets)}
• Target ZIP Codes: ${pending(client.target_zip_codes)}
• Excluded Areas: ${pending(client.exclusions)}

[STRATEGY & LAUNCH]

• Ad Strategy: ${pending(client.ad_strategy)}
• Daily Ad Spend: ${money(client.daily_budget)} / day
• Monthly KPI Target: ${pending(client.kpi)}
• Onboarding Date: ${date(client.onboarding_date)}
• Target Ad Launch Date: ${date(client.target_launch_date)}
• Client Status: ${pending(client.status)}
• Current Phase: ${pending(client.phase)}
• Next Action: ${pending(client.next_action)}

[GOHIGHLEVEL]

• Sub-Account: ${pending(client.ghl_subaccount_link)}

[META — FACEBOOK & INSTAGRAM]

• Facebook Page: ${pending(client.facebook_page_url)}
• Business Portfolio ID: ${pending(client.meta_business_portfolio_id)}
• Ad Account ID: ${pending(client.meta_ad_account_id)}
• Pixel / Dataset ID: ${pending(client.meta_pixel_id)}
• Instagram: ${pending(client.instagram_url)}
• Meta Notes: ${pending(client.facebook_business_info)}

[GOOGLE BUSINESS PROFILE]

• GBP Email: ${pending(client.gbp_email)}
• GBP Link: ${pending(client.gbp_link)}
• GBP Status: ${pending(client.gbp_status)}

[WEBSITE & LANDING PAGE]

• Current Website: ${pending(client.website_url)}
• Website Included Requested: ${yesNoPending(client.needs_website_funnel)}
• Requested Website Details: ${pending(client.website_build_request)}
• Domain: ${pending(client.domain)}
• Landing Page: ${pending(client.landing_page_url)}

[CAMPAIGNS (MEDIA BUYER)]

• Ad Account Name: ${pending(client.ad_account_name)}
• Conversion Location: ${pending(client.conversion_location)}
• Instant Form: ${pending(client.instant_form_name)}
• Ad Creatives: ${pending(client.ad_creatives_link)}
• Booking Calendar: ${pending(client.booking_calendar_link)}
• Campaign Result: ${pending(client.ad_result_status)}

[FILES & AUTOMATIONS]

• Google Drive Folder: ${pending(client.drive_folder_link)}
• Brand Assets / Media: ${pending(client.available_assets)}
• Slack Channel: ${pending(client.slack_channel_link)}
• Google Docs Dossier: ${pending(client.google_docs_url)}
• Retell AI Agent ID: ${pending(client.retell_agent_id)}
• Make.com Scenarios: ${pending(client.make_scenario_link)}
${checklistText(workflowSteps)}
==================================================
[DOCUMENT FOOTER]
Last updated: ${dateTime(lastUpdatedAt)}
Updated by: ${pending(updatedBy)}${copiedAt ? '\nCopied for Google Docs: ' + dateTime(copiedAt) : ''}
==================================================`
}

export async function copyDossier(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const input = document.createElement('textarea')
  input.value = text
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export async function downloadDossierPdf(client, text) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const margin = 44
  const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2
  const pageHeight = pdf.internal.pageSize.getHeight()
  let y = 48

  for (const sourceLine of text.split('\n')) {
    const lines = sourceLine ? pdf.splitTextToSize(sourceLine, maxWidth) : ['']
    for (const line of lines) {
      if (y > pageHeight - 44) {
        pdf.addPage()
        y = 48
      }
      pdf.text(line, margin, y)
      y += 13
    }
  }

  const dossierName = pending(client.business_name) === 'Pending'
    ? (pending(client.legal_name) === 'Pending' ? 'Client' : client.legal_name)
    : client.business_name
  const safeName = `${client.code}-${dossierName}`.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-')
  pdf.save(`${safeName}-WWWW.pdf`)
}
