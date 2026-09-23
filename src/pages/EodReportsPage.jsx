import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import WeeklyHoursPanel from '../components/WeeklyHoursPanel'
import { useLanguage } from '../i18n/LanguageContext'
import {
  addEodComment,
  convertEodCommentToTask,
  getDateInTimeZone,
  loadEodData,
  saveEodReport,
  saveEodReview,
} from '../services/eodService'
import { getCalendarDayWindow } from '../utils/timeZone'

function formatMoment(value, timeZone, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function reportPreview(value, limit = 200) {
  const text = String(value || '').trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
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

function startOfWeek(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`)
  const day = date.getUTCDay()
  return shiftDate(dateString, day === 0 ? -6 : 1 - day)
}

export default function EodReportsPage() {
  const { profile } = useAuth()
  const { locale, t } = useLanguage()
  const timeZone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Managua'
  const isSuperadmin = profile?.role === 'superadmin'
  const canReviewAll = isSuperadmin || Boolean(profile?.permissions?.operations_admin)
  const canSubmit = !isSuperadmin && Boolean(profile?.permissions?.eod_reports)
  const [cycleReference, setCycleReference] = useState(() => new Date())
  const cycle = useMemo(() => getCalendarDayWindow(cycleReference, timeZone), [cycleReference, timeZone])
  const reportDate = cycle.reportDate
  const currentReportDate = getDateInTimeZone(new Date(), timeZone)
  const reportDateMin = startOfWeek(currentReportDate)
  const [completedTasks, setCompletedTasks] = useState([])
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [reports, setReports] = useState([])
  const [directory, setDirectory] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [complianceDate, setComplianceDate] = useState(() => getDateInTimeZone(new Date(), timeZone))
  const [manualTasks, setManualTasks] = useState([''])
  const [manualHours, setManualHours] = useState([{ hours: '', memo: '' }])
  const [notes, setNotes] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState('Todos')
  const [reportViewMode, setReportViewMode] = useState(() => window.localStorage.getItem('tp-ops-eod-view') || 'cards')
  const [commentDrafts, setCommentDrafts] = useState({})
  const [expandedReport, setExpandedReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionKey, setActionKey] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { window.localStorage.setItem('tp-ops-eod-view', reportViewMode) }, [reportViewMode])

  const refresh = useCallback(async () => {
    const data = await loadEodData(profile, { windowStart: cycle.start.toISOString(), windowEnd: cycle.end.toISOString() })
    setCompletedTasks(data.completedTasks)
    setReports(data.reports)
    setDirectory(data.directory)
    setTimeEntries(data.timeEntries)
    setComplianceDate((current) => current || getDateInTimeZone(new Date(), timeZone))
    if (!isSuperadmin) {
      const existing = data.reports.find((item) => item.user_id === profile.id && item.report_date === reportDate)
      if (existing) {
        const existingIds = new Set((existing.completed_tasks || []).map((item) => item.id))
        setSelectedTaskIds(data.completedTasks.filter((task) => existingIds.has(task.id)).map((task) => task.id))
        setManualTasks(existing.manual_tasks?.length ? existing.manual_tasks.map((item) => item.title) : [''])
        setManualHours(existing.time_entries?.length ? existing.time_entries.map((item) => ({ hours: String(item.hours), memo: item.memo })) : [{ hours: '', memo: '' }])
        setNotes(existing.notes || '')
      } else {
        setSelectedTaskIds(data.completedTasks.map((task) => task.id))
        setManualTasks([''])
        const ownEntriesForDay = (data.timeEntries || []).filter((entry) => entry.user_id === profile.id && entry.work_date === reportDate)
        setManualHours(ownEntriesForDay.length ? ownEntriesForDay.map((item) => ({ hours: String(item.hours), memo: item.memo })) : [{ hours: '', memo: '' }])
        setNotes('')
      }
    }
  }, [cycle, isSuperadmin, profile, reportDate])

  useEffect(() => {
    setLoading(true)
    setError('')
    refresh().catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false))
  }, [refresh])

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

  const groupedReports = useMemo(() => {
    const search = userSearch.trim().toLowerCase()
    const groups = new Map()
    reports.filter((report) => {
      const state = getReviewState(report, profile.id)
      const matchesUser = !search || (report.profiles?.full_name || '').toLowerCase().includes(search)
      const matchesState = !canReviewAll || reviewFilter === 'Todos'
        || (reviewFilter === 'Nuevos' && state.unread)
        || (!state.unread && reviewFilter === state.label)
      return matchesUser && matchesState
    }).forEach((report) => {
      if (!groups.has(report.report_date)) groups.set(report.report_date, [])
      groups.get(report.report_date).push(report)
    })
    return [...groups.entries()].map(([date, items]) => ({
      date,
      items: items.sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '')),
    }))
  }, [canReviewAll, profile.id, reports, reviewFilter, userSearch])

  const toggleTask = (taskId) => setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId])
  const changeManual = (index, value) => setManualTasks((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))
  const changeHours = (index, key, value) => setManualHours((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))

  const runAction = async (key, action, success) => {
    setActionKey(key); setError(''); setMessage('')
    try {
      await action()
      await refresh()
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
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const selectedTasks = completedTasks.filter((task) => selectedTaskIds.includes(task.id)).map((task) => ({
        id: task.id,
        title: task.title,
        client: task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'General',
        status_note: task.status_note || '',
        completed_at: task.completed_at,
      }))
      await saveEodReport({
        profileId: profile.id,
        reportDate,
        complianceDate: reportDate,
        periodStart: cycle.start.toISOString(),
        periodEnd: cycle.end.toISOString(),
        completedTasks: selectedTasks,
        manualTasks,
        timeEntries: manualHours,
        notes,
      })
      await refresh()
      setComposerOpen(false)
      setMessage(t('Reporte EOD enviado a Kevin y Alejandra correctamente.'))
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>{canReviewAll ? 'Centro de revisión diaria' : 'Informe de fin de día'}</h2><p className="muted">{canReviewAll ? 'Revisa el trabajo del equipo, registra seguimiento y conviértelo en tareas.' : 'Envía un solo reporte dentro de TP OPS al finalizar tu turno. Kevin lo revisa cada mañana de 9:00 a 10:00 a. m.'}</p></div>{canSubmit && <button className="primary-button compact-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openComposer()}>{composerOpen ? 'Cerrar reporte' : 'Preparar reporte'}</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}

    {canReviewAll && <section className="content-card eod-compliance-center">
      <div className="section-heading"><div><p className="eyebrow">Revisión diaria</p><h3>Cumplimiento EOD</h3><p className="muted">Los reportes deben enviarse dentro de TP OPS al finalizar cada turno. Kevin los revisa cada mañana de 9:00 a 10:00 a. m.</p></div><label className="eod-compliance-date">Día<input type="date" value={complianceDate} onChange={(event) => setComplianceDate(event.target.value)} /></label></div>
      <div className="eod-compliance-counts" aria-label="Resumen diario"><span className="submitted">{complianceCounts.submitted} enviados</span><span className="pending">{complianceCounts.pending} pendientes</span></div>
      <div className="eod-compliance-list">{complianceRows.length === 0 && <p className="muted">No hay usuarios activos para este día.</p>}{complianceRows.map(({ member, state }) => <article className="eod-compliance-row" key={member.id}><div><strong data-no-translate>{member.full_name}</strong><small>{member.role}</small></div><span className={`eod-compliance-status ${state}`}>{state === 'submitted' ? 'Enviado' : 'Pendiente'}</span></article>)}</div>
    </section>}

    {canReviewAll && <section className="metric-grid eod-review-metrics" aria-label="Estado de reportes EOD"><article className="metric-card blue"><span>Nuevos</span><strong>{reportCounts.new}</strong><small>sin revisar por ti</small></article><article className="metric-card green"><span>Revisados</span><strong>{reportCounts.reviewed}</strong><small>confirmados por ti</small></article><article className="metric-card amber"><span>Seguimiento</span><strong>{reportCounts.followUp}</strong><small>requieren atención</small></article></section>}

    {canSubmit && <section className="content-card eod-cycle-summary"><div><p className="eyebrow">Ciclo diario</p><h3>Día calendario · 00:00–23:59</h3><p className="muted">Envía un reporte dentro de TP OPS al finalizar tu turno. Puedes completar cualquier día desde el lunes de esta semana hasta hoy.</p></div><div className="eod-period"><span>Desde <strong>{formatMoment(cycle.start, timeZone, locale)}</strong></span><span>Hasta <strong>{formatMoment(cycle.end, timeZone, locale)}</strong></span><small>{timeZone}</small></div></section>}

    {/* Se retiró el bloque de la regla de las 8:00 PM. El EOD se envía al finalizar cada turno. */}
    {/*
    {canSubmit && <section className={`content-card eod-late-card ${afterKevinCutoff ? 'cutoff-active' : ''}`}><div className="section-heading"><div><p className="eyebrow">Regla de las 8:00 PM</p><h3>{ownReportToday ? 'Reporte de hoy enviado' : ownDailyStatus?.status === 'working_late' ? 'Sigues trabajando' : 'Estado de cierre'}</h3><p className="muted">La referencia es la hora de Kevin: {kevinTimeZone}. Si sigues activo después de las 8:00 PM, registra tu hora estimada y copia el aviso a Slack.</p></div><span className={`eod-compliance-status ${ownReportToday ? 'submitted' : ownDailyStatus?.status === 'working_late' ? 'working-late' : 'pending'}`}>{ownReportToday ? 'Enviado' : ownDailyStatus?.status === 'working_late' ? 'Trabajando' : afterKevinCutoff ? 'Acción requerida' : 'Pendiente'}</span></div>{!ownReportToday && <><div className="eod-late-fields"><label>Tarea actual<input maxLength="500" value={lateTask} onChange={(event) => setLateTask(event.target.value)} placeholder="Ej. Finalizando automatización de onboarding" /></label><label>Enviaré el EOD a las<input type="time" value={expectedReportTime} onChange={(event) => setExpectedReportTime(event.target.value)} /><small>Hora de Kevin</small></label></div><div className="eod-slack-preview"><code>{lateNotice}</code><div><button className="secondary-button" type="button" disabled={actionKey === 'late-work'} onClick={registerLateWork}>{actionKey === 'late-work' ? 'Guardando…' : 'Registrar que sigo trabajando'}</button><button className="secondary-button" type="button" onClick={copyLateNotice}>Copiar aviso para Slack</button></div></div></>}</section>}

    */}
    {canSubmit && composerOpen && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">Checklist de actividades</p><h3>{selectedTaskIds.length} de {completedTasks.length} tareas seleccionadas</h3><p className="muted">{t('Un reporte por día. Puedes completar el de ayer hasta hoy.')}</p></div><label className="eod-report-date">Fecha del reporte<input type="date" value={reportDate} min={reportDateMin} max={currentReportDate} onChange={(event) => selectReportDate(event.target.value)} /><small>La hora se registra automáticamente al enviarlo.</small></label>{completedTasks.length > 0 && <button className="text-button" type="button" onClick={() => setSelectedTaskIds(selectedTaskIds.length === completedTasks.length ? [] : completedTasks.map((task) => task.id))}>{selectedTaskIds.length === completedTasks.length ? 'Desmarcar todas' : 'Seleccionar todas'}</button>}</div>
      <div className="eod-checklist">{completedTasks.length === 0 && <p className="muted">No completaste tareas registradas durante este ciclo. Puedes agregar actividades manualmente.</p>}{completedTasks.map((task) => <label className="eod-check" key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span><strong data-no-translate>{task.title}</strong><small><span data-no-translate>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : t('Tarea general')}</span> · {formatMoment(task.completed_at, timeZone, locale)}</small>{task.status_note && <small className="task-status-note" data-no-translate>{task.status_note}</small>}</span></label>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Trabajo adicional</p><h3>Agregar actividad manual</h3></div><button className="secondary-button" type="button" onClick={() => setManualTasks((current) => [...current, ''])}>+ Agregar</button></div>
      <div className="manual-task-list">{manualTasks.map((item, index) => <div className="manual-task-row" key={index}><input value={item} onChange={(event) => changeManual(index, event.target.value)} placeholder="Ej. Reunión con cliente o revisión manual" /><button className="text-button" type="button" onClick={() => setManualTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}</div>
      <div className="section-heading"><div><p className="eyebrow">{t('Registro manual diario')}</p><h3>{t('Horas trabajadas')}</h3><p className="muted">{t('Registra las horas y describe el trabajo realizado.')}</p></div><button className="secondary-button" type="button" onClick={() => setManualHours((current) => [...current, { hours: '', memo: '' }])}>+ {t('Agregar tiempo')}</button></div>
      <div className="manual-hours-list">{manualHours.map((entry, index) => <div className="manual-hours-row" key={index}><label>{t('Horas')}<input type="number" min="0.01" max="24" step="0.01" value={entry.hours} onChange={(event) => changeHours(index, 'hours', event.target.value)} placeholder="0.00" /></label><label>{t('Memo')}<input maxLength="500" value={entry.memo} onChange={(event) => changeHours(index, 'memo', event.target.value)} placeholder={t('Describe el trabajo realizado…')} /></label><button className="text-button" type="button" onClick={() => setManualHours((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t('Quitar')}</button></div>)}</div>
      <label>Notas del día<textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resultados, bloqueos o contexto para supervisión…" /></label>
      <div className="eod-submit-row"><span>{selectedTaskIds.length + manualTasks.filter((item) => item.trim()).length} actividades serán enviadas.</span><button className="primary-button compact-button" disabled={saving}>{saving ? 'Enviando…' : 'Enviar reporte'}</button></div>
    </form>}

    {!canSubmit && !canReviewAll && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}

    <WeeklyHoursPanel entries={timeEntries} directory={directory} profile={profile} canReviewAll={canReviewAll} currentDate={reportDate} />

    <section className="content-card eod-report-center">
      <div className="section-heading"><div><p className="eyebrow">Historial</p><h3>{canReviewAll ? 'Reportes recibidos' : 'Mis reportes enviados'}</h3></div></div>
      <div className="eod-report-filters"><input className="eod-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar usuario…"/>{canReviewAll && <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option>Todos</option><option>Nuevos</option><option>Revisado</option><option>Requiere seguimiento</option><option>Visto</option></select>}<div className="view-toggle"><button type="button" className={reportViewMode === 'cards' ? 'active' : ''} onClick={() => setReportViewMode('cards')}>Tarjetas</button><button type="button" className={reportViewMode === 'list' ? 'active' : ''} onClick={() => setReportViewMode('list')}>Lista</button></div></div>
      <div className="report-day-list">{groupedReports.length === 0 && <p className="muted">No hay informes con estos filtros.</p>}{groupedReports.map((group) => <section className="report-day-group" key={group.date}><div className="report-day-heading"><h4>{group.date}</h4><span>{group.items.length} {group.items.length === 1 ? 'reporte' : 'reportes'}</span></div><div className={`report-user-grid ${reportViewMode === 'list' ? 'report-list-view' : ''}`}>{group.items.map((report) => {
        const reportTimeZone = report.profiles?.timezone || timeZone
        const state = getReviewState(report, profile.id)
        return <article className={`report-card eod-review-card report-collapsed ${state.unread ? 'unread' : ''}`} key={report.id}>
          <div className="eod-report-title"><div><strong data-no-translate>{report.profiles?.full_name || t('Usuario')}</strong><small>{t('Enviado')} {formatMoment(report.submitted_at || report.updated_at, timeZone, locale)}</small></div><span className={`eod-review-status ${state.label.toLowerCase().replaceAll(' ', '-')}`}>{t(state.label)}</span></div>
          <small className="report-period">{t('Ciclo diario')}: {formatMoment(report.period_start, reportTimeZone, locale)} — {formatMoment(report.period_end, reportTimeZone, locale)} · {reportTimeZone}</small>
          <p className="eod-activity-count">{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades</p>
          <p className="eod-hours-total">{t('Horas')}: <strong>{(report.time_entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(2)} h</strong></p>
          <button className="secondary-button report-open-button" type="button" onClick={() => setExpandedReport(report)}>Abrir reporte completo</button>
          <ul data-no-translate>{[...(report.completed_tasks || []), ...(report.manual_tasks || [])].map((item, index) => <li className="formatted-text" key={`${item.id || 'manual'}-${index}`}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>
          {report.notes && <div className="eod-notes-block"><strong>{t('Notas')}:</strong><p className="formatted-text" data-no-translate>{reportPreview(report.notes)}</p>{report.notes.trim().length > 200 && <button className="text-button" type="button" onClick={() => setExpandedReport(report)}>Ver reporte completo</button>}</div>}
          {canReviewAll && <><div className="eod-review-actions"><button className="secondary-button" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Visto')}>Marcar visto</button><button className="secondary-button review-ok" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Revisado')}>Revisado</button><button className="secondary-button review-follow-up" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Requiere seguimiento')}>Requiere seguimiento</button></div>
            <form className="eod-comment-form" onSubmit={(event) => submitComment(event, report)}><label>Comentario del supervisor<textarea rows="2" maxLength="2000" value={commentDrafts[report.id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Deja una observación o instrucción…"/></label><button className="primary-button compact-button" disabled={actionKey === `comment-${report.id}` || !commentDrafts[report.id]?.trim()}>{actionKey === `comment-${report.id}` ? 'Guardando…' : 'Agregar comentario'}</button></form></>}
          {(report.comments || []).length > 0 && <div className="eod-follow-up-summary"><strong>Seguimiento</strong><span>{report.comments.length} {report.comments.length === 1 ? 'seguimiento' : 'seguimientos'}</span><small>{[...new Set(report.comments.map((comment) => comment.author?.full_name || 'Supervisor'))].join(' · ')}</small><button className="text-button" type="button" onClick={() => setExpandedReport(report)}>Ver reporte completo</button></div>}
          {canReviewAll && (report.reviews || []).length > 0 && <div className="eod-reviewers">{report.reviews.map((review) => <small key={review.id}>{review.reviewer?.full_name || 'Supervisor'}: {review.status}</small>)}</div>}
        </article>
      })}</div></section>)}</div>
    </section>
    {expandedReport && <div className="eod-report-modal" role="dialog" aria-modal="true" aria-labelledby="expanded-report-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedReport(null) }}>
      <article className="eod-report-modal-card">
        <div className="eod-report-modal-header"><div><p className="eyebrow">Reporte EOD completo</p><h2 id="expanded-report-title">{expandedReport.profiles?.full_name || t('Usuario')} · {expandedReport.report_date}</h2><small>{t('Enviado')} {formatMoment(expandedReport.submitted_at || expandedReport.updated_at, timeZone, locale)}</small></div><button className="secondary-button" type="button" onClick={() => setExpandedReport(null)}>Cerrar</button></div>
        <div className="eod-report-modal-body"><p className="report-period">{t('Ciclo diario')}: {formatMoment(expandedReport.period_start, expandedReport.profiles?.timezone || timeZone, locale)} — {formatMoment(expandedReport.period_end, expandedReport.profiles?.timezone || timeZone, locale)}</p><h3>Actividades</h3><ul data-no-translate>{[...(expandedReport.completed_tasks || []), ...(expandedReport.manual_tasks || [])].map((item, index) => <li className="formatted-text" key={`${item.id || 'manual'}-${index}`}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul><p className="eod-hours-total">{t('Horas')}: <strong>{(expandedReport.time_entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(2)} h</strong></p>{expandedReport.notes && <div className="eod-notes-block"><strong>{t('Notas')}:</strong><p className="formatted-text" data-no-translate>{expandedReport.notes}</p></div>}{(expandedReport.comments || []).length > 0 && <div className="eod-comment-list"><strong>Seguimiento</strong>{expandedReport.comments.map((comment) => <article className="eod-comment" key={comment.id}><div><b data-no-translate>{comment.author?.full_name || 'Supervisor'}</b><small>{formatMoment(comment.created_at, timeZone, locale)}</small></div><p className="formatted-text" data-no-translate>{comment.body}</p></article>)}</div>}</div>
      </article>
    </div>}
  </div>
}
