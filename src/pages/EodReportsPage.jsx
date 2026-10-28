import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { downloadEodPayrollPdf } from '../lib/reportExports'
import { supabase } from '../lib/supabase'
import LoadingScreen from '../components/LoadingScreen'
import WeeklyHoursPanel from '../components/WeeklyHoursPanel'
import { useLanguage } from '../i18n/LanguageContext'
import {
  addEodComment,
  convertEodCommentToTask,
  getDateInTimeZone,
  loadEodData,
  loadEodPayrollReports,
  saveEodReport,
  saveEodReview,
} from '../services/eodService'
import { getCalendarDayWindow } from '../utils/timeZone'
import { loadCompanySettings } from '../services/companyService'
import { formatHoursAndMinutes, normalizeHoursAndMinutes } from '../utils/timeDuration'

function formatMoment(value, timeZone, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function emptyEodStructure() {
  return { priorityStatus: '', priorityDetails: '', wins: '', lesson: '', carryover: '', productivityScore: '' }
}

const reportSectionHeadings = [
  'Did you complete your top 3 priorities?',
  'Wins from today',
  'One lesson or improvement',
  'Any issues to carry into tomorrow?',
  'Productivity Score:',
  'Hours logged',
]

function isStructuredEodReport(value) {
  const text = String(value || '')
  return text.startsWith('EOD Report for - ') && text.includes('Did you complete your top 3 priorities?') && text.includes('Hours logged')
}

function parseEodReportNotes(value) {
  const text = String(value || '').trim()
  if (!isStructuredEodReport(text)) return { ...emptyEodStructure(), wins: text }
  const getSection = (heading) => {
    const marker = heading + '\n'
    const headingIndex = text.indexOf(marker)
    if (headingIndex < 0) return ''
    const start = headingIndex + marker.length
    const nextHeadings = reportSectionHeadings
      .map((item) => text.indexOf(item + '\n', start))
      .filter((index) => index >= 0)
    const inlineScore = text.indexOf('Productivity Score:', start)
    if (inlineScore >= 0) nextHeadings.push(inlineScore)
    const end = nextHeadings.length ? Math.min(...nextHeadings) : text.length
    return text.slice(start, end).trim()
  }
  const priorityBlock = getSection('Did you complete your top 3 priorities?')
  const priorityResult = priorityBlock.match(/^Priority result: (Yes, mostly|Yes|Mostly|Partially|No)$/m)?.[1] || ''
  const priorityStatus = priorityResult === 'Yes, mostly' ? 'Mostly' : priorityResult
  const priorityDetails = priorityBlock.replace(/^Priority result:.*(?:\r?\n)Priority details:\n?/, '').trim()
  const score = text.match(/Productivity Score: (\d+)\/(?:5|10)/)?.[1] || ''
  return {
    priorityStatus,
    priorityDetails,
    wins: getSection('Wins from today'),
    lesson: getSection('One lesson or improvement'),
    carryover: getSection('Any issues to carry into tomorrow?'),
    productivityScore: score,
  }
}

function buildEodReportText({ reportDate, reportStructure, manualSections, totalHours }) {
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }).format(new Date(reportDate + 'T12:00:00Z'))
  const outcome = { Yes: 'Yes', Mostly: 'Yes, mostly', Partially: 'Partially', No: 'No' }[reportStructure.priorityStatus] || 'Pending'
  const workLog = manualSections
    .filter((section) => section.title.trim() || section.description.trim() || section.hours || section.minutes)
    .map((section) => '- ' + section.title.trim() + ' — ' + formatHoursAndMinutes(sectionDurationHours(section)) + '\n  ' + section.description.trim())
  return [
    'EOD Report for - ' + dateLabel,
    'Did you complete your top 3 priorities?\nPriority result: ' + outcome + '\nPriority details:\n' + reportStructure.priorityDetails.trim(),
    'Wins from today\n' + reportStructure.wins.trim(),
    'One lesson or improvement\n' + reportStructure.lesson.trim(),
    'Any issues to carry into tomorrow?\n' + reportStructure.carryover.trim(),
    'Productivity Score: ' + (reportStructure.productivityScore || '—') + '/5',
    'Hours logged\nTotal: ' + formatHoursAndMinutes(totalHours) + '\n' + (workLog.join('\n') || '-'),
  ].join('\n\n')
}

function reportPreview(value, limit = 200) {
  const text = String(value || '').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

function decimalHoursToInputs(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return { hours: hours ? String(hours) : '', minutes: minutes ? String(minutes) : '' }
}

function normalizeHoursInput(section) {
  if (Object.prototype.hasOwnProperty.call(section || {}, 'minutes')) {
    return { ...section, hours: String(section.hours ?? ''), minutes: String(section.minutes ?? '') }
  }
  return { ...section, ...decimalHoursToInputs(section?.hours) }
}

function sectionDurationHours(section) {
  return (Number(section.hours) || 0) + (Number(section.minutes) || 0) / 60
}

function normalizeManualSection(item) {
  return typeof item === 'string'
    ? { title: item, description: '', hours: null }
    : { title: item?.title || '', description: item?.description || '', hours: item?.hours }
}

function getReviewState(report, reviewerId) {
  const review = (report.reviews || []).find((item) => item.reviewer_id === reviewerId)
  const unread = !review || new Date(review.viewed_at) < new Date(report.updated_at)
  return { review, unread, label: unread ? 'Nuevo' : review.status }
}

function shiftDate(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function getSemiMonthlyRange(month, period) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return period === 'first'
    ? { start: `${month}-01`, end: `${month}-13` }
    : { start: `${month}-14`, end: `${month}-${String(lastDay).padStart(2, '0')}` }
}

export default function EodReportsPage() {
  const { profile } = useAuth()
  const { locale, t } = useLanguage()
  const timeZone = 'America/New_York'
  const isSuperadmin = profile?.role === 'superadmin'
  const canReviewAll = isSuperadmin || Boolean(profile?.permissions?.operations_admin)
  const canSubmit = !isSuperadmin && Boolean(profile?.permissions?.eod_reports)
  const [cycleReference, setCycleReference] = useState(() => new Date())
  const cycle = useMemo(() => getCalendarDayWindow(cycleReference, timeZone), [cycleReference, timeZone])
  const reportDate = cycle.reportDate
  const currentReportDate = getDateInTimeZone(new Date(), timeZone)
  const [payrollMonth, setPayrollMonth] = useState(() => getDateInTimeZone(new Date(), timeZone).slice(0, 7))
  const [payrollPeriod, setPayrollPeriod] = useState(() => Number(getDateInTimeZone(new Date(), timeZone).slice(8, 10)) < 14 ? 'first' : 'second')
  const { start: payrollStart, end: payrollEnd } = useMemo(() => getSemiMonthlyRange(payrollMonth, payrollPeriod), [payrollMonth, payrollPeriod])
  const [payrollReports, setPayrollReports] = useState([])
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [geminiConsent, setGeminiConsent] = useState(false)
  const [geminiSummary, setGeminiSummary] = useState('')
  const [geminiLoading, setGeminiLoading] = useState(false)
  const geminiRequestId = useRef(0)
  const payrollRequestId = useRef(0)
  const [reports, setReports] = useState([])
  const [directory, setDirectory] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [complianceDate, setComplianceDate] = useState(() => getDateInTimeZone(new Date(), timeZone))
  const [manualSections, setManualSections] = useState([{ title: '', description: '', hours: '', minutes: '' }])
  const [reportStructure, setReportStructure] = useState(emptyEodStructure)
  const [lateReason, setLateReason] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState('Todos')
  const [reportGroupMode, setReportGroupMode] = useState('member')
  const [commentDrafts, setCommentDrafts] = useState({})
  const [expandedReport, setExpandedReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionKey, setActionKey] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [draftHydrated, setDraftHydrated] = useState(false)
  const draftKey = profile?.id && reportDate ? `tp-ops-eod-draft-${profile.id}-${reportDate}` : ''
  const refresh = useCallback(async () => {
    setDraftHydrated(false)
    const data = await loadEodData(profile, { windowStart: cycle.start.toISOString(), windowEnd: cycle.end.toISOString() })
    setReports(data.reports)
    setDirectory(data.directory)
    setTimeEntries(data.timeEntries)
    setComplianceDate((current) => current || getDateInTimeZone(new Date(), timeZone))
    if (!isSuperadmin) {
      const existing = data.reports.find((item) => item.user_id === profile.id && item.report_date === reportDate)
      if (existing) {
        if (draftKey) window.localStorage.removeItem(draftKey)
        const existingEntries = existing.time_entries || []
        setManualSections(existing.manual_tasks?.length
          ? existing.manual_tasks.map((item, index) => ({
            title: typeof item === 'string' ? item : item.title || '',
            description: typeof item === 'string' ? existingEntries[index]?.memo || '' : item.description || existingEntries[index]?.memo || '',
            ...decimalHoursToInputs(typeof item === 'object' && item.hours != null ? item.hours : existingEntries[index]?.hours || ''),
          }))
          : [{ title: '', description: '', hours: '', minutes: '' }])
        setReportStructure(parseEodReportNotes(existing.notes))
        setLateReason(existing.late_reason || '')
      } else {
        let savedDraft = null
        try { savedDraft = draftKey ? JSON.parse(window.localStorage.getItem(draftKey) || 'null') : null } catch { savedDraft = null }
        setManualSections(savedDraft?.manualSections?.length
          ? savedDraft.manualSections.map(normalizeHoursInput)
          : [{ title: '', description: '', hours: '', minutes: '' }])
        setReportStructure(savedDraft?.reportStructure || parseEodReportNotes(savedDraft?.notes))
        setLateReason(savedDraft?.lateReason || '')
      }
      setDraftHydrated(true)
    }
    return data
  }, [cycle, draftKey, isSuperadmin, profile, reportDate])

  useEffect(() => {
    setLoading(true)
    setError('')
    refresh().catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (!draftHydrated || !composerOpen || !draftKey || isSuperadmin) return
    window.localStorage.setItem(draftKey, JSON.stringify({ manualSections, reportStructure, lateReason, savedAt: new Date().toISOString() }))
  }, [composerOpen, draftHydrated, draftKey, isSuperadmin, manualSections, reportStructure, lateReason])

  useEffect(() => {
    if (!expandedReport) return undefined
    const closeOnEscape = (event) => event.key === 'Escape' && setExpandedReport(null)
    document.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [expandedReport])

  const complianceRows = useMemo(() => directory
    .filter((member) => member.role !== 'superadmin')
    .map((member) => {
      const report = reports.find((item) => item.user_id === member.id && item.report_date === complianceDate)
      return { member, report, state: report ? 'submitted' : 'pending' }
    })
    .sort((a, b) => a.member.full_name.localeCompare(b.member.full_name)), [complianceDate, directory, reports])

  const complianceCounts = useMemo(() => complianceRows.reduce((counts, row) => {
    counts[row.state] += 1
    return counts
  }, { submitted: 0, pending: 0 }), [complianceRows])

  const reportCounts = useMemo(() => canReviewAll ? reports.reduce((counts, report) => {
    const state = getReviewState(report, profile.id)
    counts.total += 1
    if (state.unread) counts.new += 1
    else if (state.label === 'Revisado') counts.reviewed += 1
    else if (state.label === 'Requiere seguimiento') counts.followUp += 1
    return counts
  }, { total: 0, new: 0, reviewed: 0, followUp: 0 }) : null, [canReviewAll, profile.id, reports])

  const refreshPayroll = useCallback(async () => {
    const requestId = ++payrollRequestId.current
    if (!canReviewAll || payrollStart > payrollEnd) {
      setPayrollReports([])
      setPayrollLoading(false)
      return
    }
    setPayrollLoading(true)
    try {
      const result = await loadEodPayrollReports(profile, payrollStart, payrollEnd)
      if (requestId === payrollRequestId.current) setPayrollReports(result)
    } finally {
      if (requestId === payrollRequestId.current) setPayrollLoading(false)
    }
  }, [canReviewAll, payrollEnd, payrollStart, profile])

  useEffect(() => {
    refreshPayroll().catch((loadError) => setError(t(loadError.message)))
  }, [refreshPayroll, t])

  useEffect(() => {
    geminiRequestId.current += 1
    setGeminiConsent(false)
    setGeminiSummary('')
    setGeminiLoading(false)
  }, [payrollStart, payrollEnd])

  const payrollHours = useMemo(() => payrollReports.reduce((sum, report) => sum + (report.time_entries || []).reduce((total, entry) => total + Number(entry.hours || 0), 0), 0), [payrollReports])
  const payrollMemberCount = useMemo(() => new Set(payrollReports.map((report) => report.user_id)).size, [payrollReports])

  const selectPayrollPeriod = (period, month = payrollMonth) => {
    setPayrollMonth(month)
    setPayrollPeriod(period)
  }

  const changePayrollMonth = (month) => {
    if (month) setPayrollMonth(month)
  }

  const exportPayroll = async () => {
    if (!canReviewAll || !payrollReports.length || payrollStart > payrollEnd) return
    setError('')
    try {
      const company = await loadCompanySettings()
      await downloadEodPayrollPdf({ reports: payrollReports, startDate: payrollStart, endDate: payrollEnd, company, geminiSummary })
    } catch (exportError) { setError(t(exportError.message)) }
  }

  const generateGeminiSummary = async () => {
    if (!canReviewAll || !geminiConsent || !payrollReports.length || payrollStart > payrollEnd) return
    const requestId = ++geminiRequestId.current
    setError(''); setMessage(''); setGeminiLoading(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('eod-payroll-integrations', {
        body: { action: 'summarize', startDate: payrollStart, endDate: payrollEnd },
      })
      if (invokeError) throw invokeError
      if (data?.error) throw new Error(data.error)
      if (!data?.summary) throw new Error('Gemini devolvió un resumen vacío.')
      if (requestId !== geminiRequestId.current) return
      setGeminiSummary(data.summary)
      setMessage(t('Resumen de Gemini generado.'))
    } catch (summaryError) {
      if (requestId === geminiRequestId.current) setError(t(summaryError.message))
    } finally { if (requestId === geminiRequestId.current) setGeminiLoading(false) }
  }

  const groupedReports = useMemo(() => {
    const search = userSearch.trim().toLowerCase()
    const groups = new Map()
    reports.filter((report) => {
      const state = getReviewState(report, profile.id)
      const matchesUser = !search || (report.profiles?.full_name || '').toLowerCase().includes(search)
      const matchesPeriod = !canReviewAll || (report.report_date >= payrollStart && report.report_date <= payrollEnd)
      const matchesState = !canReviewAll || reviewFilter === 'Todos'
        || (reviewFilter === 'Nuevos' && state.unread)
        || (!state.unread && reviewFilter === state.label)
      return matchesUser && matchesState && matchesPeriod
    }).forEach((report) => {
      const key = reportGroupMode === 'date' ? report.report_date : report.user_id || report.profiles?.full_name || 'unknown'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(report)
    })
    return [...groups.entries()].map(([key, items]) => {
      const sortedItems = items.sort((a, b) => b.report_date.localeCompare(a.report_date)
        || (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
      return {
        key,
        title: reportGroupMode === 'date' ? key : sortedItems[0]?.profiles?.full_name || t('Usuario'),
        items: sortedItems,
        totalHours: sortedItems.reduce((sum, report) => sum + (report.time_entries || []).reduce((total, entry) => total + Number(entry.hours || 0), 0), 0),
      }
    }).sort((a, b) => reportGroupMode === 'date' ? b.key.localeCompare(a.key) : a.title.localeCompare(b.title))
  }, [canReviewAll, payrollEnd, payrollStart, profile.id, reportGroupMode, reports, reviewFilter, t, userSearch])

  const changeSection = (index, key, value) => setManualSections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const changeReportField = (key, value) => setReportStructure((current) => ({ ...current, [key]: value }))
  const normalizeSectionMinutes = (index) => setManualSections((current) => current.map((item, itemIndex) => {
    if (itemIndex !== index) return item
    const normalized = normalizeHoursAndMinutes(item.hours, item.minutes)
    return normalized ? { ...item, ...normalized } : item
  }))
  const totalManualHours = useMemo(() => manualSections.reduce((sum, section) => sum + sectionDurationHours(section), 0), [manualSections])
  const activeManualSections = useMemo(() => manualSections.filter((section) => section.title.trim() || section.description.trim() || section.hours || section.minutes), [manualSections])
  const reportStructureComplete = Boolean(
    reportStructure.priorityStatus && reportStructure.priorityDetails.trim() && reportStructure.wins.trim()
      && reportStructure.lesson.trim() && reportStructure.carryover.trim()
      && Number.isInteger(Number(reportStructure.productivityScore))
      && Number(reportStructure.productivityScore) >= 1 && Number(reportStructure.productivityScore) <= 5,
  )
  const reportHoursValid = activeManualSections.length > 0 && totalManualHours > 0 && totalManualHours <= 24
    && activeManualSections.every((section) => section.title.trim() && section.description.trim()
      && Number.isInteger(Number(section.hours || 0)) && Number(section.hours || 0) >= 0 && Number(section.hours || 0) <= 24
      && Number.isInteger(Number(section.minutes || 0)) && Number(section.minutes || 0) >= 0 && Number(section.minutes || 0) <= 59
      && !(Number(section.hours || 0) === 24 && Number(section.minutes || 0) > 0))
  const isEodReportReady = reportStructureComplete && reportHoursValid
  const runAction = async (key, action, success) => {
    setActionKey(key); setError(''); setMessage('')
    try {
      await action()
      const refreshed = await refresh()
      const updatedReport = expandedReport && refreshed?.reports?.find((item) => item.id === expandedReport.id)
      if (updatedReport) setExpandedReport(updatedReport)
      setMessage(t(success))
      window.dispatchEvent(new CustomEvent('eod-review-updated'))
      return true
    } catch (actionError) {
      setError(t(actionError.message))
      return false
    } finally { setActionKey('') }
  }

  const updateReview = (report, status) => runAction(
    `review-${report.id}`,
    () => saveEodReview({ reportId: report.id, reviewerId: profile.id, status }),
    status === 'Requiere seguimiento' ? 'Reporte marcado para seguimiento.' : 'Revisión guardada.',
  )

  const submitComment = (event, report) => {
    event.preventDefault()
    const body = commentDrafts[report.id]?.trim()
    if (!body) return
    runAction(`comment-${report.id}`, () => addEodComment({ reportId: report.id, authorId: profile.id, body }), 'Comentario agregado.')
      .then((saved) => saved && setCommentDrafts((current) => ({ ...current, [report.id]: '' })))
  }

  const convertComment = (report, comment) => runAction(
    `task-${comment.id}`,
    () => convertEodCommentToTask({ report, comment }),
    'Seguimiento convertido en tarea de prioridad alta.',
  )

  const openComposer = () => {
    setCycleReference(new Date())
    setComposerOpen(true)
    setMessage('')
  }

  const selectReportDate = (value) => {
    if (!value) return
    setCycleReference(new Date(`${value}T12:00:00`))
    setMessage('')
  }

  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage('')
    const activeSections = manualSections.filter((section) => section.title.trim() || section.description.trim() || section.hours || section.minutes)
    if (!reportStructureComplete) {
      setError(t('Completa las secciones del formato EOD y el puntaje de productividad.'))
      return
    }
    if (!activeSections.length) {
      setError(t('Agrega al menos un registro de trabajo con horas.'))
      return
    }
    if (activeSections.some((section) => !section.title.trim() || !section.description.trim() || !(sectionDurationHours(section) > 0) || !Number.isInteger(Number(section.hours || 0)) || Number(section.hours || 0) < 0 || Number(section.hours || 0) > 24 || !Number.isInteger(Number(section.minutes || 0)) || Number(section.minutes || 0) < 0 || Number(section.minutes || 0) > 59 || (Number(section.hours || 0) === 24 && Number(section.minutes || 0) > 0)) || totalManualHours > 24) {
      setError(t('Cada registro necesita título, descripción y una duración válida; el total diario no puede superar 24 horas.'))
      return
    }
    setSaving(true)
    try {
      await saveEodReport({
        profileId: profile.id,
        reportDate,
        complianceDate: reportDate,
        periodStart: cycle.start.toISOString(),
        periodEnd: cycle.end.toISOString(),
        completedTasks: [],
        manualTasks: activeSections.map((section) => ({
          title: section.title,
          description: section.description,
          hours: sectionDurationHours(section),
        })),
        timeEntries: activeSections.map((section) => ({
          hours: sectionDurationHours(section),
          memo: `${section.title.trim()}${section.description.trim() ? `: ${section.description.trim()}` : ''}`,
        })),
        notes: buildEodReportText({ reportDate, reportStructure, manualSections: activeSections, totalHours: totalManualHours }),
        lateReason,
      })
      await refresh()
      await refreshPayroll()
      setComposerOpen(false)
      if (draftKey) window.localStorage.removeItem(draftKey)
      setMessage(t('Reporte EOD enviado para revisión de Operaciones correctamente.'))
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack eod-page">
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>{canReviewAll ? t('Centro de revisión diaria') : t('Informe de fin de día')}</h2><p className="muted">{canReviewAll ? t('Revisa el trabajo del equipo, registra seguimiento y conviértelo en tareas.') : t('Envía un solo reporte dentro de TP OPS al finalizar tu turno. Kevin lo revisa cada mañana de 9:00 a 10:00 a. m.')}</p></div>{canSubmit && <button className="primary-button compact-button eod-prepare-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openComposer()}>{composerOpen ? t('Cerrar reporte') : t('Preparar reporte')}</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}

    {canReviewAll && <section className="content-card eod-compliance-center">
      <div className="section-heading"><div><p className="eyebrow">Revisión diaria</p><h3>Cumplimiento EOD</h3><p className="muted">Los reportes deben enviarse dentro de TP OPS al finalizar cada turno. Kevin los revisa cada mañana de 9:00 a 10:00 a. m.</p></div><label className="eod-compliance-date">Día<input type="date" value={complianceDate} onChange={(event) => setComplianceDate(event.target.value)} /></label></div>
      <div className="eod-compliance-counts" aria-label="Resumen diario"><span className="submitted">{complianceCounts.submitted} enviados</span><span className="pending">{complianceCounts.pending} pendientes</span></div>
      <div className="eod-compliance-list">{complianceRows.length === 0 && <p className="muted">No hay usuarios activos para este día.</p>}{complianceRows.map(({ member, state }) => <article className="eod-compliance-row" key={member.id}><div><strong data-no-translate>{member.full_name}</strong><small>{member.role}</small></div><span className={`eod-compliance-status ${state}`}>{state === 'submitted' ? 'Enviado' : 'Pendiente'}</span></article>)}</div>
    </section>}

    {canReviewAll && <section className="metric-grid eod-review-metrics" aria-label="Estado de reportes EOD"><article className="metric-card blue"><span>Nuevos</span><strong>{reportCounts.new}</strong><small>sin revisar por ti</small></article><article className="metric-card green"><span>Revisados</span><strong>{reportCounts.reviewed}</strong><small>confirmados por ti</small></article><article className="metric-card amber"><span>Seguimiento</span><strong>{reportCounts.followUp}</strong><small>requieren atención</small></article></section>}

    {canSubmit && <section className="content-card eod-cycle-summary"><div><p className="eyebrow">{t('Ciclo diario')}</p><h3>{t('Día calendario · 00:00–23:59')}</h3><p className="muted">{t('Envía un reporte dentro de TP OPS al finalizar tu turno. Puedes completar reportes atrasados; explica el motivo si su fecha ya pasó.')}</p></div><div className="eod-period"><span>{t('Desde')} <strong>{formatMoment(cycle.start, timeZone, locale)}</strong></span><span>{t('Hasta')} <strong>{formatMoment(cycle.end, timeZone, locale)}</strong></span><small>{timeZone}</small></div></section>}

    {/* Se retiró el bloque de la regla de las 8:00 PM. El EOD se envía al finalizar cada turno. */}
    {/*
    {canSubmit && <section className={`content-card eod-late-card ${afterKevinCutoff ? 'cutoff-active' : ''}`}><div className="section-heading"><div><p className="eyebrow">Regla de las 8:00 PM</p><h3>{ownReportToday ? 'Reporte de hoy enviado' : ownDailyStatus?.status === 'working_late' ? 'Sigues trabajando' : 'Estado de cierre'}</h3><p className="muted">La referencia es la hora de Kevin: {kevinTimeZone}. Si sigues activo después de las 8:00 PM, registra tu hora estimada y copia el aviso a Slack.</p></div><span className={`eod-compliance-status ${ownReportToday ? 'submitted' : ownDailyStatus?.status === 'working_late' ? 'working-late' : 'pending'}`}>{ownReportToday ? 'Enviado' : ownDailyStatus?.status === 'working_late' ? 'Trabajando' : afterKevinCutoff ? 'Acción requerida' : 'Pendiente'}</span></div>{!ownReportToday && <><div className="eod-late-fields"><label>Tarea actual<input maxLength="500" value={lateTask} onChange={(event) => setLateTask(event.target.value)} placeholder="Ej. Finalizando automatización de onboarding" /></label><label>Enviaré el EOD a las<input type="time" value={expectedReportTime} onChange={(event) => setExpectedReportTime(event.target.value)} /><small>Hora de Kevin</small></label></div><div className="eod-slack-preview"><code>{lateNotice}</code><div><button className="secondary-button" type="button" disabled={actionKey === 'late-work'} onClick={registerLateWork}>{actionKey === 'late-work' ? 'Guardando…' : 'Registrar que sigo trabajando'}</button><button className="secondary-button" type="button" onClick={copyLateNotice}>Copiar aviso para Slack</button></div></div></>}</section>}

    */}
    {canSubmit && composerOpen && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading">
        <div><p className="eyebrow">{t('Preparación del reporte')}</p><h3>{t('Informe EOD estructurado')}</h3><p className="muted">{t('Completa el formato del equipo y registra el tiempo dedicado a cada actividad.')}</p></div>
        <div className="eod-report-date"><label>{t('Fecha del reporte')}<input type="date" value={reportDate} max={currentReportDate} onChange={(event) => selectReportDate(event.target.value)} /></label><small>{t('La hora se registra automáticamente al enviarlo.')}</small>{reportDate < currentReportDate && <label className="eod-late-reason">{t('Motivo del envío atrasado')}<textarea required maxLength="1000" rows={2} value={lateReason} onChange={(event) => setLateReason(event.target.value)} placeholder={t('Explica brevemente por qué el reporte se envía después de su fecha.')} /></label>}</div>
      </div>
      <div className="eod-section-list">
        <article className="eod-work-section">
          <div className="eod-work-section-heading"><strong>{t('Prioridades principales')}</strong></div>
          <div className="eod-section-fields">
            <label>{t('¿Completaste tus 3 prioridades principales?')}<select required value={reportStructure.priorityStatus} onChange={(event) => changeReportField('priorityStatus', event.target.value)}><option value="">{t('Selecciona el resultado')}</option><option value="Yes">{t('Sí')}</option><option value="Mostly">{t('Mayormente')}</option><option value="Partially">{t('Parcialmente')}</option><option value="No">{t('No')}</option></select></label>
          </div>
          <label>{t('Escribe tus tres prioridades y qué quedó pendiente…')}<textarea required rows="3" maxLength="3000" value={reportStructure.priorityDetails} onChange={(event) => changeReportField('priorityDetails', event.target.value)} placeholder={t('Indica cada prioridad, si se completó y qué sigue…')} /></label>
        </article>
        <article className="eod-work-section">
          <div className="eod-work-section-heading"><strong>{t('Logros de hoy')}</strong></div>
          <label>{t('Describe resultados concretos por cliente. Incluye código, nombre, ticket y responsable del siguiente paso…')}<textarea required rows="4" maxLength="5000" value={reportStructure.wins} onChange={(event) => changeReportField('wins', event.target.value)} placeholder="C4 · Crystal Flowers — TKT-023 — Completed the landing page; Juan owns approval." /></label>
        </article>
        <article className="eod-work-section">
          <div className="eod-work-section-heading"><strong>{t('Una lección o mejora')}</strong></div>
          <label>{t('¿Qué aprendiste o qué mejorarás mañana?')}<textarea required rows="3" maxLength="3000" value={reportStructure.lesson} onChange={(event) => changeReportField('lesson', event.target.value)} placeholder={t('Escribe una mejora concreta o None si no aplica…')} /></label>
        </article>
        <article className="eod-work-section">
          <div className="eod-work-section-heading"><strong>{t('Pendientes para mañana')}</strong></div>
          <label>{t('¿Qué asuntos debes llevar a mañana? Incluye bloqueo y responsable…')}<textarea required rows="3" maxLength="3000" value={reportStructure.carryover} onChange={(event) => changeReportField('carryover', event.target.value)} placeholder={t('Indica el próximo paso y quién lo resolverá; escribe None si no hay pendientes…')} /></label>
        </article>
        <article className="eod-work-section">
          <div className="eod-work-section-heading"><strong>{t('Puntuación de productividad')}</strong></div>
          <label>{t('Puntuación del 1 al 5')}<select required value={reportStructure.productivityScore} onChange={(event) => changeReportField('productivityScore', event.target.value)}><option value="">{t('Selecciona una puntuación')}</option>{Array.from({ length: 5 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score}/5</option>)}</select></label>
        </article>
      </div>
      <div className="section-heading">
        <div><p className="eyebrow">{t('Horas del reporte')}</p><h3>{t('Registro de horas y trabajo')}</h3><p className="muted">{t('Agrega cada actividad con cliente, resultado y duración. Las horas quedan vinculadas al reporte para nómina.')}</p></div>
        <button className="secondary-button" type="button" onClick={() => setManualSections((current) => [...current, { title: '', description: '', hours: '', minutes: '' }])}>+ {t('Agregar sección')}</button>
      </div>
      <div className="eod-section-list">{manualSections.map((section, index) => <article className="eod-work-section" key={index}><div className="eod-work-section-heading"><strong>{t('Actividad')} {index + 1}</strong>{manualSections.length > 1 && <button className="text-button" type="button" onClick={() => setManualSections((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t('Quitar')}</button>}</div><div className="eod-section-fields"><label>{t('Cliente o actividad')}<input maxLength="160" value={section.title} onChange={(event) => changeSection(index, 'title', event.target.value)} placeholder="C4 · Crystal Flowers · TKT-023" /></label><label>{t('Horas')}<input type="number" min="0" max="24" step="1" inputMode="numeric" value={section.hours} onChange={(event) => changeSection(index, 'hours', event.target.value)} placeholder="0" /></label><label>{t('Minutos')}<input type="number" min="0" step="1" inputMode="numeric" value={section.minutes} onChange={(event) => changeSection(index, 'minutes', event.target.value)} onBlur={() => normalizeSectionMinutes(index)} placeholder="0" /></label></div><label>{t('Trabajo realizado')}<textarea rows="3" maxLength="2000" value={section.description} onChange={(event) => changeSection(index, 'description', event.target.value)} placeholder={t('Describe la entrega, ticket o próximo paso…')} /></label></article>)}</div>
      <div className="eod-hours-summary"><span>{t('Total de horas')}</span><strong>{formatHoursAndMinutes(totalManualHours)}</strong></div>
      <div className="eod-submit-row"><span>{isEodReportReady ? t('Total de horas') + ': ' + formatHoursAndMinutes(totalManualHours) : t('Completa el formato y agrega las horas para enviar.')}</span><button className="primary-button compact-button" disabled={saving}>{saving ? t('Enviando…') : t('Enviar reporte')}</button></div>
    </form>}
    {!canSubmit && !canReviewAll && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}

    <WeeklyHoursPanel entries={timeEntries} directory={directory} profile={profile} canReviewAll={canReviewAll} currentDate={reportDate} />

    {canReviewAll && <section className="content-card eod-payroll-summary">
      <div className="section-heading"><div><p className="eyebrow">{t('Resumen para nómina')}</p><h3>{t('Reportes EOD por quincena')}</h3><p className="muted">{t('Selecciona el periodo. Las horas se suman desde los registros de tiempo de cada reporte enviado.')}</p></div><button className="primary-button compact-button" type="button" onClick={exportPayroll} disabled={payrollLoading || !payrollReports.length || payrollStart > payrollEnd}>{t('Descargar resumen PDF')}</button></div>
      <div className="eod-payroll-period-picker">
        <label>{t('Mes')}<input type="month" value={payrollMonth} onChange={(event) => changePayrollMonth(event.target.value)} /></label>
        <div className="eod-payroll-period-options" role="group" aria-label={t('Periodo quincenal')}>
          <button type="button" className={payrollPeriod === 'first' ? 'active' : ''} aria-pressed={payrollPeriod === 'first'} onClick={() => selectPayrollPeriod('first')}>{t('Del 1 al 13')}</button>
          <button type="button" className={payrollPeriod === 'second' ? 'active' : ''} aria-pressed={payrollPeriod === 'second'} onClick={() => selectPayrollPeriod('second')}>{t('Del 14 al fin de mes')}</button>
        </div>
      </div>

      <div className="eod-payroll-ai-controls">
        <label className="eod-payroll-ai-consent"><input type="checkbox" checked={geminiConsent} onChange={(event) => setGeminiConsent(event.target.checked)} /><span>{t('Autorizo enviar a Gemini las fechas, horas y descripciones del rango seleccionado. Se excluyen los nombres de empleados; las descripciones podrían mencionar clientes.')}</span></label>
        <button className="secondary-button" type="button" onClick={generateGeminiSummary} disabled={!geminiConsent || geminiLoading || payrollLoading || !payrollReports.length}>{t(geminiLoading ? 'Generando con Gemini…' : geminiSummary ? 'Actualizar resumen con Gemini' : 'Generar resumen con Gemini')}</button>
      </div>
      {geminiSummary && <div className="eod-payroll-ai-summary"><strong>{t('Resumen de Gemini')}</strong><p className="formatted-text">{geminiSummary}</p></div>}
      {payrollStart > payrollEnd && <p className="form-error" role="alert">{t('La fecha inicial debe ser anterior o igual a la fecha final.')}</p>}
      <div className="metric-grid eod-payroll-metrics"><article className="metric-card blue"><span>{t('Horas reportadas')}</span><strong>{formatHoursAndMinutes(payrollHours)}</strong><small>{payrollStart} — {payrollEnd}</small></article><article className="metric-card green"><span>{t('Reportes enviados')}</span><strong>{payrollReports.length}</strong><small>{t('Incluidos en el periodo')}</small></article><article className="metric-card amber"><span>{t('Integrantes con reporte')}</span><strong>{payrollMemberCount}</strong><small>{t('Con horas registradas')}</small></article></div>
      {payrollLoading && <p className="muted">{t('Cargando reportes del periodo…')}</p>}{!payrollLoading && !payrollReports.length && payrollStart <= payrollEnd && <p className="muted">{t('No hay reportes EOD enviados en este periodo.')}</p>}
    </section>}

    <section className="content-card eod-report-center">
      <div className="section-heading"><div><p className="eyebrow">{t('Historial')}</p><h3>{canReviewAll ? t('Reportes recibidos') : t('Mis reportes enviados')}</h3>{canReviewAll && <p className="muted">{t('Mostrando reportes del periodo seleccionado')}: {payrollStart} — {payrollEnd}</p>}</div></div>
      <div className="eod-report-filters">
        <input className="eod-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder={t('Buscar usuario…')} />
        {canReviewAll && <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option value="Todos">{t('Todos')}</option><option value="Nuevos">{t('Nuevos')}</option><option value="Revisado">{t('Revisado')}</option><option value="Requiere seguimiento">{t('Requiere seguimiento')}</option><option value="Visto">{t('Visto')}</option></select>}
        <div className="view-toggle" role="group" aria-label={t('Agrupar reportes')}>
          <button type="button" className={reportGroupMode === 'member' ? 'active' : ''} aria-pressed={reportGroupMode === 'member'} onClick={() => setReportGroupMode('member')}>{t('Por integrante')}</button>
          <button type="button" className={reportGroupMode === 'date' ? 'active' : ''} aria-pressed={reportGroupMode === 'date'} onClick={() => setReportGroupMode('date')}>{t('Por fecha')}</button>
        </div>
      </div>
      <div className="report-day-list">
        {groupedReports.length === 0 && <p className="muted">{t('No hay informes con estos filtros.')}</p>}
        {groupedReports.map((group) => <section className="report-day-group" key={group.key}>
          <div className="report-day-heading">
            <h4 data-no-translate={reportGroupMode === 'member' ? true : undefined}>{group.title}</h4>
            <span>{group.items.length} {group.items.length === 1 ? t('reporte') : t('reportes')} · {formatHoursAndMinutes(group.totalHours)}</span>
          </div>
          <div className="report-user-grid">
            {group.items.map((report) => {
              const state = getReviewState(report, profile.id)
              const totalActivities = (report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)
              const totalHours = (report.time_entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
              return <article className={`report-card eod-review-card report-collapsed ${state.unread ? 'unread' : ''}`} key={report.id}>
                <div className="eod-report-title">
                  <div>
                    <strong data-no-translate>{reportGroupMode === 'date' ? report.profiles?.full_name || t('Usuario') : report.report_date}</strong>
                    <small>{reportGroupMode === 'member' && <>{t('Fecha')}: {report.report_date} · </>}{t('Enviado')} {formatMoment(report.submitted_at || report.updated_at, timeZone, locale)}</small>
                  </div>
                  <span className={`eod-review-status ${state.label.toLowerCase().replaceAll(' ', '-')}`}>{t(state.label)}</span>
                </div>
                <div className="eod-compact-summary">
                  <span><strong>{formatHoursAndMinutes(totalHours)}</strong> {t('Horas')}</span>
                  <span><strong>{totalActivities}</strong> {t('Actividades')}</span>
                  {(report.comments || []).length > 0 && <span><strong>{report.comments.length}</strong> {t('Seguimientos')}</span>}
                  {report.late_reason && <span className="eod-late-badge">{t('Envío atrasado')}</span>}
                </div>
                <button className="secondary-button report-open-button" type="button" onClick={() => setExpandedReport(report)}>{t('Abrir reporte completo')}</button>
              </article>
            })}
          </div>
        </section>)}
      </div>
    </section>
    {expandedReport && <div className="eod-report-modal" role="dialog" aria-modal="true" aria-labelledby="expanded-report-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedReport(null) }}>
      <article className="eod-report-modal-card">
        <div className="eod-report-modal-header">
          <div>
            <p className="eyebrow">{t('Reporte EOD completo')}</p>
            <h2 id="expanded-report-title">{expandedReport.profiles?.full_name || t('Usuario')} · {expandedReport.report_date}</h2>
            <small>{t('Enviado')} {formatMoment(expandedReport.submitted_at || expandedReport.updated_at, timeZone, locale)}</small>
          </div>
          <button className="secondary-button" type="button" onClick={() => setExpandedReport(null)}>{t('Cerrar')}</button>
        </div>
        <div className="eod-report-modal-body">
          <p className="report-period">{t('Ciclo diario')}: {formatMoment(expandedReport.period_start, expandedReport.profiles?.timezone || timeZone, locale)} — {formatMoment(expandedReport.period_end, expandedReport.profiles?.timezone || timeZone, locale)}</p>
          {expandedReport.late_reason && <div className="eod-notes-block"><strong>{t('Motivo del envío atrasado')}:</strong><p className="formatted-text" data-no-translate>{expandedReport.late_reason}</p></div>}
          <h3>{t('Actividades')}</h3>
          <ul data-no-translate>{(expandedReport.completed_tasks || []).map((item) => <li className="formatted-text" key={item.id}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>
          {!isStructuredEodReport(expandedReport.notes) && (expandedReport.manual_tasks || []).length > 0 && <div className="eod-report-sections">
            <h3>{t('Secciones del trabajo')}</h3>
            {expandedReport.manual_tasks.map((item, index) => {
              const section = normalizeManualSection(item)
              return <article className="eod-report-section" key={section.title + '-' + index}>
                <div><strong data-no-translate>{section.title}</strong>{section.description && <p className="formatted-text" data-no-translate>{section.description}</p>}</div>
                {section.hours != null && <span>{formatHoursAndMinutes(Number(section.hours))}</span>}
              </article>
            })}
          </div>}
          {!isStructuredEodReport(expandedReport.notes) && <p className="eod-hours-total">{t('Total de horas')}: <strong>{formatHoursAndMinutes((expandedReport.time_entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0))}</strong></p>}
          {expandedReport.notes && <div className="eod-notes-block"><strong>{t(isStructuredEodReport(expandedReport.notes) ? 'Reporte EOD para Slack' : 'Resumen general del día')}:</strong><p className="formatted-text" data-no-translate>{expandedReport.notes}</p></div>}
          {canReviewAll && <section className="eod-modal-review">
            <h3>{t('Revisión del reporte')}</h3>
            <div className="eod-review-actions">
              <button className="secondary-button" type="button" disabled={actionKey === `review-${expandedReport.id}`} onClick={() => updateReview(expandedReport, 'Visto')}>{t('Marcar visto')}</button>
              <button className="secondary-button review-ok" type="button" disabled={actionKey === `review-${expandedReport.id}`} onClick={() => updateReview(expandedReport, 'Revisado')}>{t('Revisado')}</button>
              <button className="secondary-button review-follow-up" type="button" disabled={actionKey === `review-${expandedReport.id}`} onClick={() => updateReview(expandedReport, 'Requiere seguimiento')}>{t('Requiere seguimiento')}</button>
            </div>
            <form className="eod-comment-form" onSubmit={(event) => submitComment(event, expandedReport)}>
              <label>{t('Comentario del supervisor')}<textarea rows="2" maxLength="2000" value={commentDrafts[expandedReport.id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [expandedReport.id]: event.target.value }))} placeholder={t('Deja una observación o instrucción…')} /></label>
              <button className="primary-button compact-button" disabled={actionKey === `comment-${expandedReport.id}` || !commentDrafts[expandedReport.id]?.trim()}>{actionKey === `comment-${expandedReport.id}` ? t('Guardando…') : t('Agregar comentario')}</button>
            </form>
          </section>}
          {canReviewAll && (expandedReport.reviews || []).length > 0 && <div className="eod-review-history">
            <strong>{t('Historial de revisión')}</strong>
            {expandedReport.reviews.map((review) => <article key={review.id}>
              <b data-no-translate>{review.reviewer?.full_name || t('Usuario')}</b>
              <span>{t(review.status)}</span>
              <small>{formatMoment(review.updated_at || review.viewed_at, timeZone, locale)}</small>
            </article>)}
          </div>}
          {(expandedReport.comments || []).length > 0 && <div className="eod-comment-list">
            <strong>{t('Seguimiento')}</strong>
            {expandedReport.comments.map((comment) => <article className="eod-comment" key={comment.id}>
              <div><b data-no-translate>{comment.author?.full_name || 'Supervisor'}</b><small>{formatMoment(comment.created_at, timeZone, locale)}</small></div>
              <p className="formatted-text" data-no-translate>{comment.body}</p>
              {canReviewAll && !comment.task_id && <button className="secondary-button" type="button" disabled={actionKey === `task-${comment.id}`} onClick={() => convertComment(expandedReport, comment)}>{actionKey === `task-${comment.id}` ? t('Guardando…') : t('Convertir en tarea alta')}</button>}
            </article>)}
          </div>}
        </div>
      </article>
    </div>}
  </div>
}
