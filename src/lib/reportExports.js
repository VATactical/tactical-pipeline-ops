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

export async function downloadEodPayrollPdf({ reports, startDate, endDate, company, geminiSummary = '' }) {
  const doc = await makeDocument({
    title: 'EOD PAYROLL SUMMARY',
    subtitle: 'Work dates: ' + startDate + ' — ' + endDate,
    company,
  })
  const right = 202
  const contentWidth = 188
  const bottom = 263
  const submittedAtFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  let y = 48

  const drawContinuationHeader = () => {
    doc.setFillColor(...navy)
    doc.rect(0, 0, 216, 29, 'F')
    doc.setTextColor(230, 242, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text('EOD PAYROLL SUMMARY', 14, 13)
    doc.setTextColor(...cyan)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text('Work dates: ' + startDate + ' — ' + endDate, 14, 21)
    y = 36
  }

  const addPayrollPage = () => {
    doc.addPage()
    drawContinuationHeader()
  }

  const ensurePayrollSpace = (needed = 10) => {
    if (y + needed <= bottom) return
    addPayrollPage()
  }

  const drawSection = (label) => {
    ensurePayrollSpace(14)
    doc.setFillColor(232, 246, 252)
    doc.roundedRect(14, y, contentWidth, 9, 2, 2, 'F')
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(label, 18, y + 6)
    y += 13
  }

  const writeWrapped = (value, { x = 18, width = 180, size = 8.5, color = ink, bold = false, lineHeight = 4.3 } = {}) => {
    const text = String(value || '').trim()
    if (!text) return
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(text, width)
    for (const line of lines) {
      ensurePayrollSpace(lineHeight + 1)
      doc.setTextColor(...color)
      doc.text(line, x, y)
      y += lineHeight
    }
    y += 1
  }

  const drawTeamTableHeader = (continued = false) => {
    ensurePayrollSpace(12)
    doc.setFillColor(20, 43, 62)
    doc.roundedRect(14, y, contentWidth, 8, 1.5, 1.5, 'F')
    doc.setTextColor(235, 245, 252)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text(continued ? 'TEAM MEMBER (CONTINUED)' : 'TEAM MEMBER', 18, y + 5.4)
    doc.text('HOURS', right - 4, y + 5.4, { align: 'right' })
    y += 10
  }

  const entries = reports.flatMap((report) => (report.time_entries || []).map((entry) => {
    const numericHours = Number(entry.hours)
    return {
      date: report.report_date,
      userId: report.user_id || '',
      user: report.profiles?.full_name || 'Team member',
      hours: Number.isFinite(numericHours) ? numericHours : 0,
      memo: String(entry.memo || '').trim(),
      submittedAt: report.submitted_at || report.updated_at,
    }
  })).sort((a, b) => a.date.localeCompare(b.date) || a.user.localeCompare(b.user))

  const members = new Map()
  for (const report of reports) {
    const id = report.user_id || report.profiles?.full_name || 'unknown'
    const name = report.profiles?.full_name || 'Team member'
    if (!members.has(id)) members.set(id, name)
  }

  const totalsByUser = new Map()
  for (const entry of entries) {
    const id = entry.userId || entry.user
    const current = totalsByUser.get(id) || { name: entry.user, hours: 0 }
    current.hours += entry.hours
    totalsByUser.set(id, current)
  }

  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const kpis = [
    { label: 'SUBMITTED EOD REPORTS', value: String(reports.length) },
    { label: 'TEAM MEMBERS', value: String(members.size) },
    { label: 'TOTAL REPORTED HOURS', value: totalHours.toFixed(2) + ' h' },
  ]
  const cardWidth = 60
  const cardGap = 4
  kpis.forEach((kpi, index) => {
    const x = 14 + index * (cardWidth + cardGap)
    doc.setFillColor(247, 250, 252)
    doc.setDrawColor(213, 225, 234)
    doc.roundedRect(x, y, cardWidth, 24, 2, 2, 'FD')
    doc.setTextColor(...muted)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.text(kpi.label, x + 3, y + 5)
    doc.setTextColor(...ink)
    doc.setFontSize(13)
    doc.text(kpi.value, x + 3, y + 15)
  })
  y += 29

  if (geminiSummary) {
    drawSection('WORK SUMMARY')
    const summaryLines = String(geminiSummary).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    for (const line of summaryLines) {
      const cleanLine = line.replace(/^[-*•]\s*/, '')
      doc.setFillColor(...cyan)
      doc.circle(18, y - 0.8, 0.7, 'F')
      writeWrapped(cleanLine, { x: 21, width: 178, size: 8.5, lineHeight: 4.3 })
    }
    y += 2
  }

  drawSection('HOURS BY TEAM MEMBER')
  drawTeamTableHeader()
  const teamRows = [...totalsByUser.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (!teamRows.length) {
    writeWrapped('No time entries were recorded in this date range.', { size: 8.5 })
  } else {
    teamRows.forEach((member, index) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      const nameLines = doc.splitTextToSize(member.name, 150)
      const rowHeight = Math.max(8, nameLines.length * 4.2 + 3)
      if (y + rowHeight > bottom) {
        addPayrollPage()
        drawSection('HOURS BY TEAM MEMBER')
        drawTeamTableHeader(true)
      }
      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 253)
        doc.rect(14, y - 1, contentWidth, rowHeight, 'F')
      }
      doc.setTextColor(...ink)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(nameLines, 18, y + 4.4)
      doc.setFont('helvetica', 'bold')
      doc.text(member.hours.toFixed(2), right - 4, y + 4.4, { align: 'right' })
      doc.setDrawColor(225, 233, 239)
      doc.line(14, y + rowHeight - 1, right, y + rowHeight - 1)
      y += rowHeight
    })
    if (y + 11 > bottom) {
      addPayrollPage()
      drawSection('HOURS BY TEAM MEMBER')
      drawTeamTableHeader(true)
    }
    doc.setFillColor(232, 246, 252)
    doc.roundedRect(14, y, contentWidth, 9, 1.5, 1.5, 'F')
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('TOTAL', 18, y + 6)
    doc.text(totalHours.toFixed(2) + ' h', right - 4, y + 6, { align: 'right' })
    y += 14
  }

  drawSection('DAILY TIME ENTRIES')
  if (!entries.length) {
    writeWrapped('No time entries were recorded in this date range.', { size: 8.5 })
  } else {
    const groupedByDate = new Map()
    for (const entry of entries) {
      if (!groupedByDate.has(entry.date)) groupedByDate.set(entry.date, [])
      groupedByDate.get(entry.date).push(entry)
    }

    for (const [date, dayEntries] of groupedByDate) {
      ensurePayrollSpace(16)
      const dayHours = dayEntries.reduce((sum, entry) => sum + entry.hours, 0)
      doc.setFillColor(20, 43, 62)
      doc.roundedRect(14, y, contentWidth, 9, 1.5, 1.5, 'F')
      doc.setTextColor(235, 245, 252)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text(date, 18, y + 6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.text(dayEntries.length + ' entries · ' + dayHours.toFixed(2) + ' h', right - 4, y + 6, { align: 'right' })
      y += 12

      for (const entry of dayEntries) {
        ensurePayrollSpace(14)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8.5)
        const userLines = doc.splitTextToSize(entry.user, 154)
        doc.setTextColor(...ink)
        doc.text(userLines, 18, y + 4)
        doc.text(entry.hours.toFixed(2) + ' h', right - 4, y + 4, { align: 'right' })
        y += Math.max(7, userLines.length * 4.2 + 2)

        if (entry.submittedAt) {
          const submittedDate = new Date(entry.submittedAt)
          if (!Number.isNaN(submittedDate.getTime())) {
            writeWrapped('EOD submitted · ' + submittedAtFormatter.format(submittedDate) + ' ET', {
              x: 21, width: 177, size: 7, color: muted, lineHeight: 3.8,
            })
          }
        }
        if (entry.memo) {
          writeWrapped(entry.memo, { x: 21, width: 177, size: 8, lineHeight: 4.1 })
        } else {
          writeWrapped('No work description provided.', { x: 21, width: 177, size: 8, color: muted, lineHeight: 4.1 })
        }
        doc.setDrawColor(225, 233, 239)
        doc.line(18, y, right, y)
        y += 4
      }
      y += 2
    }
  }

  const generatedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET'
  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setFillColor(255, 255, 255)
    doc.rect(0, 264, 216, 15, 'F')
    doc.setDrawColor(220, 230, 237)
    doc.line(14, 266, 202, 266)
    doc.setTextColor(...muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('Page ' + page + ' of ' + pageCount, 108, 271, { align: 'center' })
    doc.setFontSize(6.5)
    doc.text((company?.company_name || 'Tactical Pipeline') + ' · ' + (company?.company_email || ''), 14, 276)
    doc.text('Generated ' + generatedAt, 202, 276, { align: 'right' })
  }

  doc.save('TP-Ops-EOD-Payroll-' + startDate + '-to-' + endDate + '.pdf')
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
