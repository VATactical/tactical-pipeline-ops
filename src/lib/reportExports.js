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

  const drawMetricCards = (metrics) => {
    const gap = 2.5
    const cardWidth = (contentWidth - gap * (metrics.length - 1)) / metrics.length
    const cardHeight = 21
    metrics.forEach((metric, index) => {
      const x = 14 + index * (cardWidth + gap)
      doc.setFillColor(247, 250, 252)
      doc.setDrawColor(213, 225, 234)
      doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD')
      doc.setTextColor(...muted)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.3)
      doc.text(metric.label, x + 2.5, y + 5)
      doc.setTextColor(...ink)
      doc.setFontSize(metric.value.length > 11 ? 9 : 11)
      doc.text(metric.value, x + 2.5, y + 14)
    })
    y += cardHeight + 4
  }

  const drawTeamTableHeader = (continued = false) => {
    ensurePayrollSpace(12)
    doc.setFillColor(20, 43, 62)
    doc.roundedRect(14, y, contentWidth, 8, 1.5, 1.5, 'F')
    doc.setTextColor(235, 245, 252)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.text(continued ? 'TEAM MEMBER (CONT.)' : 'TEAM MEMBER', 18, y + 5.4)
    doc.text('REPORTS', 112, y + 5.4, { align: 'right' })
    doc.text('ENTRIES', 140, y + 5.4, { align: 'right' })
    doc.text('HOURS', 170, y + 5.4, { align: 'right' })
    doc.text('SHARE', 198, y + 5.4, { align: 'right' })
    y += 10
  }

  const drawDailyTableHeader = (continued = false) => {
    ensurePayrollSpace(12)
    doc.setFillColor(20, 43, 62)
    doc.roundedRect(14, y, contentWidth, 8, 1.5, 1.5, 'F')
    doc.setTextColor(235, 245, 252)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.8)
    doc.text(continued ? 'WORK DATE (CONT.)' : 'WORK DATE', 18, y + 5.4)
    doc.text('REPORTS', 106, y + 5.4, { align: 'right' })
    doc.text('ENTRIES', 136, y + 5.4, { align: 'right' })
    doc.text('HOURS', 166, y + 5.4, { align: 'right' })
    doc.text('AVG / REPORT', 198, y + 5.4, { align: 'right' })
    y += 10
  }

  const drawHoursChart = (title, rows, labelFor, valueFor, limit) => {
    drawSection(title)
    const visibleRows = rows.slice().sort((a, b) => valueFor(b) - valueFor(a)).slice(0, limit)
    if (!visibleRows.length || visibleRows.every((row) => valueFor(row) <= 0)) {
      writeWrapped('No reported hours are available to chart.', { size: 8, color: muted })
      return
    }
    const maximum = Math.max(...visibleRows.map(valueFor))
    for (const row of visibleRows) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      const labelLines = doc.splitTextToSize(labelFor(row), 48)
      const rowHeight = Math.max(9, labelLines.length * 3.5 + 3)
      if (y + rowHeight > bottom) {
        addPayrollPage()
        drawSection(title + ' (CONTINUED)')
      }
      const barY = y + Math.min(rowHeight / 2, 5)
      doc.setTextColor(...ink)
      doc.text(labelLines, 18, y + 3.5)
      doc.setFillColor(235, 241, 245)
      doc.roundedRect(70, barY - 1.5, 108, 3.5, 1.5, 1.5, 'F')
      const width = Math.max(0.8, 108 * valueFor(row) / maximum)
      doc.setFillColor(...cyan)
      doc.roundedRect(70, barY - 1.5, width, 3.5, 1.5, 1.5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.text(valueFor(row).toFixed(2) + ' h', 198, y + 3.5, { align: 'right' })
      y += rowHeight + 1
    }
    if (rows.length > limit) {
      y += 1
      writeWrapped('Chart shows the ' + limit + ' highest-hour records; the tables include the full period.', {
        size: 7, color: muted, lineHeight: 3.7,
      })
    }
    y += 2
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
  const dailyStats = new Map()
  for (const report of reports) {
    const id = report.user_id || report.profiles?.full_name || 'unknown'
    const name = report.profiles?.full_name || 'Team member'
    const member = members.get(id) || { id, name, reports: 0, entries: 0, hours: 0 }
    member.reports += 1
    members.set(id, member)

    const day = dailyStats.get(report.report_date) || { date: report.report_date, reports: 0, entries: 0, hours: 0 }
    day.reports += 1
    dailyStats.set(report.report_date, day)
  }

  for (const entry of entries) {
    const id = entry.userId || entry.user
    const member = members.get(id) || { id, name: entry.user, reports: 0, entries: 0, hours: 0 }
    member.entries += 1
    member.hours += entry.hours
    members.set(id, member)

    const day = dailyStats.get(entry.date) || { date: entry.date, reports: 0, entries: 0, hours: 0 }
    day.entries += 1
    day.hours += entry.hours
    dailyStats.set(entry.date, day)
  }

  const teamRows = [...members.values()].sort((a, b) => a.name.localeCompare(b.name))
  const days = [...dailyStats.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const averagePerReport = reports.length ? totalHours / reports.length : 0
  const averagePerMember = members.size ? totalHours / members.size : 0
  const busiestDay = days.slice().sort((a, b) => b.hours - a.hours)[0]

  drawMetricCards([
    { label: 'SUBMITTED EOD REPORTS', value: String(reports.length) },
    { label: 'TEAM MEMBERS', value: String(members.size) },
    { label: 'TOTAL REPORTED HOURS', value: totalHours.toFixed(2) + ' h' },
  ])

  drawSection('PERIOD ANALYSIS')
  drawMetricCards([
    { label: 'TIME ENTRIES', value: String(entries.length) },
    { label: 'ACTIVE REPORT DAYS', value: String(days.length) },
    { label: 'AVG HOURS / EOD REPORT', value: averagePerReport.toFixed(2) + ' h' },
    { label: 'AVG HOURS / MEMBER', value: averagePerMember.toFixed(2) + ' h' },
  ])
  if (busiestDay) {
    writeWrapped('Highest reported day: ' + busiestDay.date + ' · ' + busiestDay.hours.toFixed(2) + ' h across ' + busiestDay.entries + ' time entries.', {
      size: 8, color: muted,
    })
  }

  if (geminiSummary) {
    drawSection('QUALITATIVE WORK SUMMARY · GEMINI')
    writeWrapped('The hours and payroll metrics in this report are calculated from submitted EOD time entries. Gemini provides a qualitative summary only.', {
      size: 7, color: muted, lineHeight: 3.7,
    })
    const summaryLines = String(geminiSummary).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    for (const line of summaryLines) {
      const cleanLine = line.replace(/^[-*•]\s*/, '')
      writeWrapped('• ' + cleanLine, { x: 18, width: 180, size: 8.3, lineHeight: 4.2 })
    }
    y += 2
  }

  drawHoursChart(
    'REPORTED HOURS BY TEAM MEMBER',
    teamRows,
    (member) => member.name,
    (member) => member.hours,
    8,
  )
  drawHoursChart(
    'TOP DAYS BY REPORTED HOURS',
    days,
    (day) => day.date,
    (day) => day.hours,
    10,
  )

  drawSection('TEAM MEMBER PAYROLL TABLE')
  drawTeamTableHeader()
  if (!teamRows.length) {
    writeWrapped('No submitted EOD reports were found in this date range.', { size: 8.5 })
  } else {
    teamRows.forEach((member, index) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      const nameLines = doc.splitTextToSize(member.name, 78)
      const rowHeight = Math.max(8, nameLines.length * 4.1 + 3)
      if (y + rowHeight > bottom) {
        addPayrollPage()
        drawSection('TEAM MEMBER PAYROLL TABLE (CONTINUED)')
        drawTeamTableHeader(true)
      }
      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 253)
        doc.rect(14, y - 1, contentWidth, rowHeight, 'F')
      }
      const share = totalHours > 0 ? (member.hours / totalHours) * 100 : 0
      doc.setTextColor(...ink)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(nameLines, 18, y + 4.2)
      doc.text(String(member.reports), 112, y + 4.2, { align: 'right' })
      doc.text(String(member.entries), 140, y + 4.2, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.text(member.hours.toFixed(2), 170, y + 4.2, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.text(share.toFixed(1) + '%', 198, y + 4.2, { align: 'right' })
      doc.setDrawColor(225, 233, 239)
      doc.line(14, y + rowHeight - 1, right, y + rowHeight - 1)
      y += rowHeight
    })

    if (y + 11 > bottom) {
      addPayrollPage()
      drawSection('TEAM MEMBER PAYROLL TABLE (CONTINUED)')
      drawTeamTableHeader(true)
    }
    doc.setFillColor(232, 246, 252)
    doc.roundedRect(14, y, contentWidth, 9, 1.5, 1.5, 'F')
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('TOTAL', 18, y + 6)
    doc.text(String(reports.length), 112, y + 6, { align: 'right' })
    doc.text(String(entries.length), 140, y + 6, { align: 'right' })
    doc.text(totalHours.toFixed(2) + ' h', 170, y + 6, { align: 'right' })
    doc.text(totalHours > 0 ? '100.0%' : '0.0%', 198, y + 6, { align: 'right' })
    y += 14
  }

  drawSection('DAILY PAYROLL SUMMARY')
  drawDailyTableHeader()
  if (!days.length) {
    writeWrapped('No submitted EOD reports were found in this date range.', { size: 8.5 })
  } else {
    days.forEach((day, index) => {
      if (y + 8 > bottom) {
        addPayrollPage()
        drawSection('DAILY PAYROLL SUMMARY (CONTINUED)')
        drawDailyTableHeader(true)
      }
      if (index % 2 === 0) {
        doc.setFillColor(248, 251, 253)
        doc.rect(14, y - 1, contentWidth, 8, 'F')
      }
      doc.setTextColor(...ink)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(day.date, 18, y + 4.4)
      doc.text(String(day.reports), 106, y + 4.4, { align: 'right' })
      doc.text(String(day.entries), 136, y + 4.4, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.text(day.hours.toFixed(2), 166, y + 4.4, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.text(day.reports ? (day.hours / day.reports).toFixed(2) + ' h' : '—', 198, y + 4.4, { align: 'right' })
      doc.setDrawColor(225, 233, 239)
      doc.line(14, y + 7, right, y + 7)
      y += 8
    })

    if (y + 11 > bottom) {
      addPayrollPage()
      drawSection('DAILY PAYROLL SUMMARY (CONTINUED)')
      drawDailyTableHeader(true)
    }
    doc.setFillColor(232, 246, 252)
    doc.roundedRect(14, y, contentWidth, 9, 1.5, 1.5, 'F')
    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('TOTAL', 18, y + 6)
    doc.text(String(reports.length), 106, y + 6, { align: 'right' })
    doc.text(String(entries.length), 136, y + 6, { align: 'right' })
    doc.text(totalHours.toFixed(2) + ' h', 166, y + 6, { align: 'right' })
    doc.text(reports.length ? averagePerReport.toFixed(2) + ' h' : '—', 198, y + 6, { align: 'right' })
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
