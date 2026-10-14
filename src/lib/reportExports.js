import { jsPDF } from 'jspdf'
import { resolveCompanyLogo } from '../services/companyService'
import { formatHoursAndMinutes } from '../utils/timeDuration'

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
  y = paragraph(doc, `Total hours: ${formatHoursAndMinutes(total)}`, y, { bold: true, size: 13 })
  y = sectionTitle(doc, 'MANUAL TIME ENTRIES', y + 3)
  if (!entries.length) y = paragraph(doc, 'No time entries were recorded for this week.', y)
  entries.forEach((entry) => {
    y = ensureSpace(doc, y, 16)
    doc.setDrawColor(210, 222, 232); doc.line(18, y, 198, y)
    y += 6
    y = paragraph(doc, `${entry.work_date} · ${formatHoursAndMinutes(Number(entry.hours))} · ${entry.profiles?.full_name || userLabel}`, y, { bold: true })
    y = paragraph(doc, entry.memo, y)
  })
  doc.save(`TP-Ops-Hours-${cleanFileName(userLabel)}-${weekStart}.pdf`)
}

export async function downloadEodPayrollPdf({ reports = [], startDate, endDate, company, geminiSummary = '' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 16
  const right = pageWidth - 16
  const width = right - left
  const contentBottom = pageHeight - 19
  const green = [20, 138, 0]
  const dark = [32, 39, 38]
  const gray = [101, 112, 108]
  const line = [221, 228, 224]
  const pale = [244, 248, 245]
  const paleGreen = [239, 247, 236]
  const submittedAtFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const generatedAt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date()) + ' ET'
  const logo = await imageDataUrl(company?.logo_url)
  let y = 0

  const drawPageHeader = (continued = false) => {
    if (!continued) {
      doc.setFillColor(...green)
      doc.rect(0, 0, pageWidth, 2, 'F')
      if (logo) {
        const format = logo.startsWith('data:image/jpeg') ? 'JPEG' : logo.startsWith('data:image/webp') ? 'WEBP' : 'PNG'
        try { doc.addImage(logo, format, left, 12, 17, 17, undefined, 'FAST') } catch { /* text header remains readable */ }
      }
      const titleX = logo ? left + 23 : left
      doc.setTextColor(...dark)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(19)
      doc.text('EOD Hours Report', titleX, 18)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...gray)
      doc.text('PAYROLL REPORT', titleX, 25)
      doc.setDrawColor(...line)
      doc.line(left, 34, right, 34)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...gray)
      doc.text('REPORTING PERIOD', left, 42)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...dark)
      doc.text(startDate + ' to ' + endDate, left, 48)
      doc.setFontSize(8)
      doc.setTextColor(...gray)
      doc.text('Generated ' + generatedAt, right, 48, { align: 'right' })
      doc.text(company?.company_name || 'Tactical Pipeline', left, 55)
      y = 63
      return
    }

    doc.setFillColor(...green)
    doc.rect(0, 0, pageWidth, 1.5, 'F')
    doc.setTextColor(...dark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('EOD HOURS REPORT', left, 10)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...gray)
    doc.text(startDate + ' to ' + endDate, right, 10, { align: 'right' })
    doc.setDrawColor(...line)
    doc.line(left, 14, right, 14)
    y = 21
  }

  const addPage = () => {
    doc.addPage()
    drawPageHeader(true)
  }

  const ensureSpace = (needed) => {
    if (y + needed <= contentBottom) return
    addPage()
  }

  const drawSection = (title) => {
    ensureSpace(13)
    doc.setTextColor(...dark)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(title, left, y + 4)
    doc.setDrawColor(...green)
    doc.setLineWidth(0.45)
    doc.line(left, y + 7, right, y + 7)
    doc.setLineWidth(0.2)
    y += 12
  }

  const writeParagraph = (value, { x = left, textWidth = width, size = 8.5, color = dark, bold = false, lineHeight = 4.2, gapAfter = 2 } = {}) => {
    const text = String(value || '').trim()
    if (!text) return
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    const lines = doc.splitTextToSize(text, textWidth)
    for (const textLine of lines) {
      ensureSpace(lineHeight + 1)
      doc.setTextColor(...color)
      doc.text(textLine, x, y + lineHeight - 1)
      y += lineHeight
    }
    y += gapAfter
  }

  const drawMetricCards = (metrics) => {
    const gap = 3
    const cardWidth = (width - gap * (metrics.length - 1)) / metrics.length
    const cardHeight = 20
    ensureSpace(cardHeight + 4)
    metrics.forEach((metric, index) => {
      const x = left + index * (cardWidth + gap)
      doc.setFillColor(...paleGreen)
      doc.setDrawColor(...[221, 232, 218])
      doc.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.8)
      doc.setTextColor(...gray)
      doc.text(metric.label, x + 3, y + 5)
      doc.setFontSize(metric.value.length > 12 ? 12 : 14)
      doc.setTextColor(...dark)
      doc.text(metric.value, x + 3, y + 14)
    })
    y += cardHeight + 4
  }

  const drawTableHeader = (columns) => {
    ensureSpace(11)
    doc.setFillColor(...pale)
    doc.rect(left, y, width, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...gray)
    columns.forEach((column) => {
      const tx = column.align === 'right' ? column.x + column.width - 2 : column.x + 2
      doc.text(column.label, tx, y + 5.3, { align: column.align || 'left' })
    })
    y += 9
  }

  const drawTableRow = (columns, values, rowHeight, shade = false, boldColumns = []) => {
    ensureSpace(rowHeight + 1)
    if (shade) {
      doc.setFillColor(250, 252, 250)
      doc.rect(left, y - 1, width, rowHeight, 'F')
    }
    values.forEach((value, index) => {
      const column = columns[index]
      doc.setFont('helvetica', boldColumns.includes(index) ? 'bold' : 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...dark)
      const tx = column.align === 'right' ? column.x + column.width - 2 : column.x + 2
      doc.text(String(value), tx, y + 4.2, { align: column.align || 'left' })
    })
    doc.setDrawColor(...line)
    doc.line(left, y + rowHeight - 0.5, right, y + rowHeight - 0.5)
    y += rowHeight
  }

  const entries = reports.flatMap((report) => (report.time_entries || []).map((entry) => {
    const parsedHours = Number(entry.hours)
    return {
      date: report.report_date || '',
      userId: report.user_id || '',
      user: report.profiles?.full_name || 'Team member',
      hours: Number.isFinite(parsedHours) ? parsedHours : 0,
      memo: String(entry.memo || '').trim(),
      submittedAt: report.submitted_at || report.updated_at || '',
    }
  })).sort((a, b) => a.date.localeCompare(b.date) || a.user.localeCompare(b.user))

  const members = new Map()
  const days = new Map()
  reports.forEach((report) => {
    const id = report.user_id || report.profiles?.full_name || 'unknown'
    const name = report.profiles?.full_name || 'Team member'
    const member = members.get(id) || { id, name, reports: 0, entries: 0, hours: 0 }
    member.reports += 1
    members.set(id, member)
    const day = days.get(report.report_date) || { date: report.report_date, reports: 0, entries: 0, hours: 0 }
    day.reports += 1
    days.set(report.report_date, day)
  })
  entries.forEach((entry) => {
    const id = entry.userId || entry.user
    const member = members.get(id) || { id, name: entry.user, reports: 0, entries: 0, hours: 0 }
    member.entries += 1
    member.hours += entry.hours
    members.set(id, member)
    const day = days.get(entry.date) || { date: entry.date, reports: 0, entries: 0, hours: 0 }
    day.entries += 1
    day.hours += entry.hours
    days.set(entry.date, day)
  })

  const teamRows = [...members.values()].sort((a, b) => a.name.localeCompare(b.name))
  const dayRows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0)
  const averagePerReport = reports.length ? totalHours / reports.length : 0
  const averagePerMember = members.size ? totalHours / members.size : 0
  const busiestDay = dayRows.slice().sort((a, b) => b.hours - a.hours)[0]
  const leadingMember = teamRows.slice().sort((a, b) => b.hours - a.hours)[0]

  drawPageHeader()
  drawMetricCards([
    { label: 'TOTAL HOURS', value: formatHoursAndMinutes(totalHours) },
    { label: 'EOD REPORTS', value: String(reports.length) },
    { label: 'TEAM MEMBERS', value: String(members.size) },
  ])

  drawSection('REPORT ANALYSIS')
  writeParagraph(
    (busiestDay
      ? 'Peak day: ' + busiestDay.date + ' with ' + busiestDay.hours.toFixed(2) + ' hours across ' + busiestDay.entries + ' entries. '
      : 'No submitted time entries were found in this date range. ') +
    'Average: ' + averagePerReport.toFixed(2) + ' hours per EOD report and ' +
    formatHoursAndMinutes(averagePerMember) + ' per team member.' +
    (leadingMember && totalHours > 0 ? ' Highest contributor: ' + leadingMember.name + ' at ' + (leadingMember.hours / totalHours * 100).toFixed(1) + '% of reported hours.' : ''),
    { size: 8.5, color: dark },
  )

  if (geminiSummary) {
    drawSection('WORK SUMMARY')
    writeParagraph('AI-generated summary based on submitted work descriptions. Payroll hours below are calculated directly from EOD time entries.', {
      size: 7.5, color: gray, lineHeight: 3.8, gapAfter: 1,
    })
    String(geminiSummary).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      writeParagraph('- ' + item.replace(/^[-*•]\s*/, ''), { size: 8.2, lineHeight: 4.1, gapAfter: 0.5 })
    })
  }

  if (teamRows.length) {
    drawSection('HOURS BY TEAM MEMBER')
    const chartRows = teamRows.slice().sort((a, b) => b.hours - a.hours).slice(0, 8)
    const maxHours = Math.max(...chartRows.map((item) => item.hours), 0)
    chartRows.forEach((member) => {
      ensureSpace(9)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...dark)
      doc.text(doc.splitTextToSize(member.name, 48).slice(0, 1), left + 1, y + 4.4)
      const trackX = left + 53
      const trackWidth = width - 76
      doc.setFillColor(235, 240, 236)
      doc.roundedRect(trackX, y + 1.5, trackWidth, 3.5, 1.5, 1.5, 'F')
      if (maxHours > 0) {
        doc.setFillColor(...green)
        doc.roundedRect(trackX, y + 1.5, Math.max(0.8, trackWidth * member.hours / maxHours), 3.5, 1.5, 1.5, 'F')
      }
      doc.setFont('helvetica', 'bold')
      doc.text(formatHoursAndMinutes(member.hours), right, y + 4.4, { align: 'right' })
      y += 8
    })
    if (teamRows.length > chartRows.length) {
      writeParagraph('Chart shows the eight highest totals. The table below includes all team members.', {
        size: 7, color: gray, lineHeight: 3.6, gapAfter: 1,
      })
    }
  }

  drawSection('TEAM MEMBER SUMMARY')
  const teamColumns = [
    { label: 'TEAM MEMBER', x: left, width: 88 },
    { label: 'REPORTS', x: left + 88, width: 27, align: 'right' },
    { label: 'ENTRIES', x: left + 115, width: 27, align: 'right' },
    { label: 'HOURS', x: left + 142, width: 26, align: 'right' },
    { label: 'SHARE', x: left + 168, width: 16, align: 'right' },
  ]
  drawTableHeader(teamColumns)
  if (!teamRows.length) {
    writeParagraph('No submitted EOD reports were found in this date range.', { size: 8.5 })
  } else {
    teamRows.forEach((member, index) => {
      const nameLines = doc.splitTextToSize(member.name, 82)
      const rowHeight = Math.max(8, nameLines.length * 4 + 2)
      if (y + rowHeight + 1 > contentBottom) {
        addPage()
        drawSection('TEAM MEMBER SUMMARY (CONTINUED)')
        drawTableHeader(teamColumns)
      }
      const share = totalHours ? (member.hours / totalHours * 100).toFixed(1) + '%' : '0.0%'
      drawTableRow(teamColumns, [nameLines, String(member.reports), String(member.entries), formatHoursAndMinutes(member.hours), share], rowHeight, index % 2 === 0, [3])
    })
    ensureSpace(11)
    doc.setFillColor(...paleGreen)
    doc.rect(left, y, width, 8.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...dark)
    doc.text('TOTAL', left + 2, y + 5.5)
    doc.text(String(reports.length), left + 88 + 25, y + 5.5, { align: 'right' })
    doc.text(String(entries.length), left + 115 + 25, y + 5.5, { align: 'right' })
    doc.text(totalHours.toFixed(2) + ' h', left + 142 + 24, y + 5.5, { align: 'right' })
    doc.text(totalHours ? '100%' : '0%', right - 2, y + 5.5, { align: 'right' })
    y += 12
  }

  drawSection('DAILY SUMMARY')
  const dayColumns = [
    { label: 'WORK DATE', x: left, width: 88 },
    { label: 'EOD REPORTS', x: left + 88, width: 30, align: 'right' },
    { label: 'ENTRIES', x: left + 118, width: 26, align: 'right' },
    { label: 'HOURS', x: left + 144, width: 24, align: 'right' },
    { label: 'AVG / REPORT', x: left + 168, width: 16, align: 'right' },
  ]
  drawTableHeader(dayColumns)
  if (!dayRows.length) {
    writeParagraph('No submitted EOD reports were found in this date range.', { size: 8.5 })
  } else {
    dayRows.forEach((day, index) => {
      if (y + 9 > contentBottom) {
        addPage()
        drawSection('DAILY SUMMARY (CONTINUED)')
        drawTableHeader(dayColumns)
      }
      const average = day.reports ? formatHoursAndMinutes(day.hours / day.reports) : '0 min'
      drawTableRow(dayColumns, [day.date, String(day.reports), String(day.entries), formatHoursAndMinutes(day.hours), average], 8, index % 2 === 0, [3])
    })
    if (y + 11 > contentBottom) {
      addPage()
      drawSection('DAILY SUMMARY (CONTINUED)')
      drawTableHeader(dayColumns)
    }
    doc.setFillColor(...paleGreen)
    doc.rect(left, y, width, 8.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...dark)
    doc.text('TOTAL', left + 2, y + 5.5)
    doc.text(String(reports.length), left + 88 + 28, y + 5.5, { align: 'right' })
    doc.text(String(entries.length), left + 118 + 24, y + 5.5, { align: 'right' })
    doc.text(totalHours.toFixed(2) + ' h', left + 144 + 22, y + 5.5, { align: 'right' })
    doc.text(reports.length ? formatHoursAndMinutes(averagePerReport) : '0.00 h', right - 2, y + 5.5, { align: 'right' })
    y += 12
  }

  drawSection('DETAILED TIME ENTRIES')
  if (!entries.length) {
    writeParagraph('No time entries were recorded for this period.', { size: 8.5 })
  } else {
    let currentDate = ''
    entries.forEach((entry) => {
      const submittedDate = entry.submittedAt ? new Date(entry.submittedAt) : null
      const submittedText = submittedDate && !Number.isNaN(submittedDate.getTime())
        ? submittedAtFormatter.format(submittedDate) + ' ET'
        : 'Submission time unavailable'
      const memoLines = doc.splitTextToSize(entry.memo || 'No work description provided.', width - 4)
      const rowHeight = 13 + memoLines.length * 3.8
      if (y + Math.min(rowHeight, contentBottom - y + 1) > contentBottom) addPage()
      if (currentDate !== entry.date) {
        if (y + 13 > contentBottom) addPage()
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8.5)
        doc.setTextColor(...green)
        doc.text(entry.date, left, y + 4)
        const dateTotal = dayRows.find((day) => day.date === entry.date)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...gray)
        if (dateTotal) doc.text(formatHoursAndMinutes(dateTotal.hours) + ' total hours', right, y + 4, { align: 'right' })
        doc.setDrawColor(...line)
        doc.line(left, y + 6.5, right, y + 6.5)
        y += 9
        currentDate = entry.date
      }
      if (y + 10 > contentBottom) addPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...dark)
      doc.text(entry.user, left + 2, y + 3.8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...gray)
      doc.setFontSize(7)
      doc.text(submittedText, right - 25, y + 3.8, { align: 'right' })
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...dark)
      doc.setFontSize(8)
      doc.text(formatHoursAndMinutes(entry.hours), right, y + 3.8, { align: 'right' })
      y += 6.5
      writeParagraph(entry.memo || 'No work description provided.', { x: left + 2, textWidth: width - 4, size: 8, color: gray, lineHeight: 3.8, gapAfter: 2 })
      doc.setDrawColor(...line)
      doc.line(left + 2, y, right, y)
      y += 3
    })
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(...line)
    doc.line(left, pageHeight - 13, right, pageHeight - 13)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...gray)
    doc.text((company?.company_name || 'Tactical Pipeline') + ' | EOD Payroll', left, pageHeight - 8)
    doc.text('Page ' + page + ' of ' + pageCount, right, pageHeight - 8, { align: 'right' })
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
