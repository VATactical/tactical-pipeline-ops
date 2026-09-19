import { jsPDF } from 'jspdf'
import { resolveCompanyLogo } from '../services/companyService'

const cyan = [33, 198, 244]
const navy = [7, 20, 34]
const ink = [28, 45, 62]
const muted = [91, 111, 130]

const cleanFileName = (value) => String(value || 'report').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '')
const money = (value) => `$${Number(value || 0).toFixed(2)}`

async function imageDataUrl(url) {
  try {
    const response = await fetch(resolveCompanyLogo(url))
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

async function makeDocument({ title, subtitle, company }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const logo = await imageDataUrl(company?.logo_url)
  doc.setFillColor(...navy); doc.rect(0, 0, 216, 38, 'F')
  if (logo) {
    const format = logo.startsWith('data:image/jpeg') ? 'JPEG' : logo.startsWith('data:image/webp') ? 'WEBP' : 'PNG'
    try { doc.addImage(logo, format, 14, 8, 22, 22, undefined, 'FAST') } catch { /* keep text header */ }
  }
  doc.setTextColor(230, 242, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(title, logo ? 43 : 14, 17)
  doc.setTextColor(...cyan); doc.setFontSize(9); doc.text(subtitle, logo ? 43 : 14, 25)
  doc.setTextColor(...muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text(`${company?.company_name || 'Tactical Pipeline'} · ${company?.company_email || ''}`, 14, 276)
  doc.text(`Generated ${new Date().toLocaleString()}`, 202, 276, { align: 'right' })
  return doc
}

function ensureSpace(doc, y, needed = 18) {
  if (y + needed <= 266) return y
  doc.addPage(); return 18
}

function sectionTitle(doc, label, y) {
  y = ensureSpace(doc, y, 14)
  doc.setFillColor(232, 246, 252); doc.roundedRect(14, y, 188, 9, 2, 2, 'F')
  doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(label, 18, y + 6)
  return y + 14
}

function paragraph(doc, text, y, options = {}) {
  if (!text) return y
  const lines = doc.splitTextToSize(String(text), options.width || 180)
  y = ensureSpace(doc, y, lines.length * 5 + 3)
  doc.setTextColor(...ink); doc.setFont('helvetica', options.bold ? 'bold' : 'normal'); doc.setFontSize(options.size || 9)
  doc.text(lines, options.x || 18, y)
  return y + lines.length * 5 + 2
}

export async function downloadWeeklyHoursPdf({ entries, weekStart, weekEnd, userLabel, company }) {
  const doc = await makeDocument({ title: 'WEEKLY TIME REPORT', subtitle: `${weekStart} — ${weekEnd}`, company })
  let y = 48
  y = paragraph(doc, `Team member: ${userLabel}`, y, { bold: true, size: 11 })
  const total = entries.reduce((sum, item) => sum + Number(item.hours || 0), 0)
  y = paragraph(doc, `Total hours: ${total.toFixed(2)}`, y, { bold: true, size: 13 })
  y = sectionTitle(doc, 'MANUAL TIME ENTRIES', y + 3)
  if (!entries.length) y = paragraph(doc, 'No time entries were recorded for this week.', y)
  entries.forEach((entry) => {
    y = ensureSpace(doc, y, 16)
    doc.setDrawColor(210, 222, 232); doc.line(18, y, 198, y)
    y += 6
    y = paragraph(doc, `${entry.work_date} · ${Number(entry.hours).toFixed(2)} hours · ${entry.profiles?.full_name || userLabel}`, y, { bold: true })
    y = paragraph(doc, entry.memo, y)
  })
  doc.save(`TP-Ops-Hours-${cleanFileName(userLabel)}-${weekStart}.pdf`)
}

export async function downloadCommunicationsPdf({ notes, viewerName, company }) {
  const doc = await makeDocument({ title: 'TEAM COMMUNICATIONS', subtitle: `Exported for ${viewerName}`, company })
  let y = 48
  y = paragraph(doc, `${notes.length} communication${notes.length === 1 ? '' : 's'}`, y, { bold: true, size: 12 })
  notes.forEach((note) => {
    y = sectionTitle(doc, note.title, y + 2)
    y = paragraph(doc, note.body || 'No additional detail.', y)
    y = paragraph(doc, `${note.author?.full_name || 'Team'} · ${new Date(note.created_at).toLocaleString()}${note.task_id ? ' · Converted to task' : ''}`, y, { size: 8 })
  })
  doc.save(`TP-Ops-Communications-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export async function downloadAdsReportPdf({ report, client, authorName, company }) {
  const doc = await makeDocument({ title: 'META ADS PERFORMANCE REPORT', subtitle: `${client.code} · ${client.business_name}`, company })
  let y = 47
  y = paragraph(doc, `Reporting period: ${report.period_start} — ${report.period_end}`, y, { bold: true, size: 11 })
  y = paragraph(doc, `Report date: ${report.report_date} · Prepared by: ${authorName}`, y)
  y = paragraph(doc, `Campaign status: ${report.report_status}`, y, { bold: true })
  y = sectionTitle(doc, 'PERFORMANCE AT A GLANCE', y + 3)
  const metrics = [
    ['Spend', money(report.spend)], ['Impressions', Number(report.impressions).toLocaleString()], ['Reach', Number(report.reach).toLocaleString()],
    ['Clicks', Number(report.clicks).toLocaleString()], ['CTR', `${Number(report.ctr).toFixed(2)}%`], ['CPC', money(report.cpc)],
    ['Leads', report.leads], ['CPL', money(report.cpl)], ['Appointments', report.appointments], ['Cost / appointment', money(report.cost_per_appointment)],
  ]
  metrics.forEach(([label, value], index) => {
    const col = index % 2; const row = Math.floor(index / 2); const x = 18 + col * 92; const top = y + row * 12
    doc.setTextColor(...muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(label, x, top)
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(String(value), x, top + 5)
  })
  y += Math.ceil(metrics.length / 2) * 12 + 5
  for (const [label, value] of [['EXECUTIVE SUMMARY', report.summary], ['WINS', report.wins], ['ISSUES / RISKS', report.issues], ['NEXT STEPS', report.next_steps]]) {
    y = sectionTitle(doc, label, y)
    y = paragraph(doc, value || 'No update provided.', y)
  }
  doc.save(`${cleanFileName(client.code)}-ADS-Report-${report.report_date}.pdf`)
}
