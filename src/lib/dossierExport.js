const pending = (value) => {
  if (value == null || value === '') return 'Pending'
  return String(value)
}
const yesNo = (value) => value ? 'YES' : 'NO'
const money = (value) => value == null || value === '' ? 'Pending' : `$${Number(value).toLocaleString('en-US')}`
const date = (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : 'Pending'
const dateTime = (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Pending'

export function buildDossierText(client, updatedBy = 'Pending') {
  return `==================================================
TACTICAL PIPELINE — ACTIVE CLIENT DOSSIER
==================================================

[WHO — CLIENT PROFILE & COMPLIANCE]

• Client Code: ${pending(client.code)}
• Business Name: ${pending(client.business_name)}
• Legal Business Name: ${pending(client.legal_name)}
• Owner Name: ${pending(client.owner_name)}
• Business Phone: ${pending(client.phone)}
• Business Email: ${pending(client.email)}
• Physical Business Address: ${pending(client.address)}
• Primary Market: ${pending(client.markets)}
• Target ZIP Codes / Radius: ${pending(client.target_zip_codes)}
• Excluded Areas: ${pending(client.exclusions)}
• EIN / Tax ID Status: ${pending(client.legal_business_info)}
• Persona / KYC Status: ${pending(client.kyc_status)}

[WHAT — OFFER, SERVICES & TARGETS]

• Core Services: ${pending(client.services)}
• Core Consumer Offer: ${pending(client.offer)}
• Project Type: ${pending(client.project_type)}
• Target Customer Profile: ${pending(client.ideal_customer_profile)}
• Target Monthly KPI: ${pending(client.kpi)}
• Target Daily Ad Spend: ${money(client.daily_budget)} / day
• Minimum Target Project Size: ${money(client.minimum_project)}

[ASSET DIAGNOSTICS & INFRASTRUCTURE]

• Website / Funnel Required: ${client.needs_website_funnel == null ? 'Pending' : yesNo(client.needs_website_funnel)}
• Existing Domain: ${pending(client.domain)}
• Website / Funnel URL: ${pending(client.website_url)}
• Google Business Profile Status: ${pending(client.gbp_status)}
• Google Business Profile Link: ${pending(client.gbp_link)}
• Google Drive Folder: ${pending(client.drive_folder_link)}
• Available Assets: ${pending(client.available_assets)}

[WHEN — TIMELINE & STATUS]

• Onboarding Date: ${date(client.onboarding_date)}
• Target Ad Launch Date: ${date(client.target_launch_date)}
• Current Lifecycle Status: ${pending(client.status)}
• A2P Status: ${pending(client.a2p_status)}
• Meta Ads Status: ${pending(client.meta_status)}
• Last Dossier Update: ${dateTime(client.updated_at)}
• Updated By: ${pending(updatedBy)}

[WHERE — SYSTEM LINKS & ACCESS]

• GoHighLevel Sub-Account: ${pending(client.ghl_subaccount_link)}
• Facebook Page: ${pending(client.facebook_page_url)}
• Instagram Account: ${pending(client.instagram_url)}
• Meta Business Portfolio ID: ${pending(client.meta_business_portfolio_id)}
• Meta Ad Account ID: ${pending(client.meta_ad_account_id)}
• Meta Pixel / Dataset ID: ${pending(client.meta_pixel_id)}
• Google Docs Dossier: ${pending(client.google_docs_url)}
• Landing Page: ${pending(client.landing_page_url)}

[OPERATIONAL COMPLETION STATUS]

• Onboarding Completed: ${yesNo(client.onboarding_completed)}
• GHL Access Confirmed: ${yesNo(client.ghl_access_confirmed)}
• Facebook Access Confirmed: ${yesNo(client.facebook_access_confirmed)}
• Ad Account Access Confirmed: ${yesNo(client.ad_account_access_confirmed)}
• Pixel Access Confirmed: ${yesNo(client.pixel_access_confirmed)}
• Domain Access Confirmed: ${yesNo(client.domain_access_confirmed)}
• Payment Method Confirmed: ${yesNo(client.payment_method_confirmed)}
• Persona / KYC Completed: ${yesNo(client.kyc_completed)}
• A2P Submitted: ${yesNo(client.a2p_submitted)}
• Funnel Live: ${yesNo(client.funnel_live)}
• Meta Campaign Live: ${yesNo(client.meta_campaign_live)}

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

  const safeName = `${client.code}-${client.business_name}`.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-')
  pdf.save(`${safeName}-WWWW.pdf`)
}
