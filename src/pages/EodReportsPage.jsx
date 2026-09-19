import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import WeeklyHoursPanel from '../components/WeeklyHoursPanel'
import { useLanguage } from '../i18n/LanguageContext'
import {
  addEodComment,
  convertEodCommentToTask,
  DEFAULT_KEVIN_TIME_ZONE,
  getDateInTimeZone,
  isPastKevinCutoff,
  loadEodData,
  saveEodReport,
  saveEodReview,
  saveLateWorkStatus,
} from '../services/eodService'
import { getCalendarDayWindow } from '../utils/timeZone'

function formatMoment(value, timeZone, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function getReviewState(report, reviewerId) {
  const review = (report.reviews || []).find((item) => item.reviewer_id === reviewerId)
  const unread = !review || new Date(review.viewed_at) < new Date(report.updated_at)
  return { review, unread, label: unread ? 'Nuevo' : review.status }
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
  const [completedTasks, setCompletedTasks] = useState([])
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [reports, setReports] = useState([])
  const [directory, setDirectory] = useState([])
  const [dailyStatuses, setDailyStatuses] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [kevinTimeZone, setKevinTimeZone] = useState(DEFAULT_KEVIN_TIME_ZONE)
  const [complianceDate, setComplianceDate] = useState(() => getDateInTimeZone(new Date(), DEFAULT_KEVIN_TIME_ZONE))
  const [lateTask, setLateTask] = useState('')
  const [expectedReportTime, setExpectedReportTime] = useState('')
  const [manualTasks, setManualTasks] = useState([''])
  const [manualHours, setManualHours] = useState([{ hours: '', memo: '' }])
  const [notes, setNotes] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState('Todos')
  const [commentDrafts, setCommentDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionKey, setActionKey] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const data = await loadEodData(profile, { windowStart: cycle.start.toISOString(), windowEnd: cycle.end.toISOString() })
    setCompletedTasks(data.completedTasks)
    setReports(data.reports)
    setDirectory(data.directory)
    setDailyStatuses(data.dailyStatuses)
    setTimeEntries(data.timeEntries)
    setKevinTimeZone(data.kevinTimeZone)
    const currentKevinDate = getDateInTimeZone(new Date(), data.kevinTimeZone)
    setComplianceDate((current) => current || currentKevinDate)
    const ownStatus = data.dailyStatuses.find((item) => item.user_id === profile.id && item.work_date === currentKevinDate)
    setLateTask(ownStatus?.current_task || '')
    setExpectedReportTime(ownStatus?.expected_report_time?.slice(0, 5) || '')
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
        setManualHours([{ hours: '', memo: '' }])
        setNotes('')
      }
    }
  }, [cycle, isSuperadmin, profile, reportDate])

  useEffect(() => {
    setLoading(true)
    setError('')
    refresh().catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false))
  }, [refresh])

  const currentKevinDate = getDateInTimeZone(new Date(), kevinTimeZone)
  const afterKevinCutoff = isPastKevinCutoff(kevinTimeZone)
  const ownReportToday = reports.find((report) => report.user_id === profile.id
    && getDateInTimeZone(new Date(report.submitted_at || report.updated_at), kevinTimeZone) === currentKevinDate)
  const ownDailyStatus = dailyStatuses.find((item) => item.user_id === profile.id && item.work_date === currentKevinDate)

  const complianceRows = useMemo(() => directory
    .filter((member) => member.role !== 'superadmin')
    .map((member) => {
      const report = reports.find((item) => item.user_id === member.id
        && getDateInTimeZone(new Date(item.submitted_at || item.updated_at), kevinTimeZone) === complianceDate)
      const status = dailyStatuses.find((item) => item.user_id === member.id && item.work_date === complianceDate)
      const state = report ? 'submitted' : status?.status === 'working_late' ? 'working_late' : 'pending'
      return { member, report, status, state }
    })
    .sort((a, b) => a.member.full_name.localeCompare(b.member.full_name)), [complianceDate, dailyStatuses, directory, kevinTimeZone, reports])

  const complianceCounts = useMemo(() => complianceRows.reduce((counts, row) => {
    counts[row.state] += 1
    return counts
  }, { submitted: 0, working_late: 0, pending: 0 }), [complianceRows])

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

  const lateNotice = `Still working on ${lateTask.trim() || '[Task]'}, EOD report coming at ${expectedReportTime || '[Time]'} Kevin time.`

  const registerLateWork = () => {
    if (!lateTask.trim() || !expectedReportTime) {
      setError(t('Indica la tarea actual y la hora estimada del reporte.'))
      return
    }
    runAction(
      'late-work',
      () => saveLateWorkStatus({
        profileId: profile.id,
        workDate: currentKevinDate,
        currentTask: lateTask,
        expectedReportTime,
      }),
      'Estado actualizado. Ya puedes copiar el aviso para Slack.',
    )
  }

  const copyLateNotice = async () => {
    try {
      await navigator.clipboard.writeText(lateNotice)
      setMessage(t('Aviso para Slack copiado.'))
      setError('')
    } catch {
      setError(t('No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.'))
    }
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
        complianceDate: currentKevinDate,
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
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>{canReviewAll ? 'Centro de revisión diaria' : 'Informe de fin de día'}</h2><p className="muted">{canReviewAll ? 'Revisa el trabajo del equipo, registra seguimiento y conviértelo en tareas.' : 'Selecciona el trabajo completado hoy, de 00:00 a 23:59, y envíalo a Kevin y Alejandra.'}</p></div>{canSubmit && <button className="primary-button compact-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openComposer()}>{composerOpen ? 'Cerrar reporte' : 'Preparar reporte'}</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}

    {canReviewAll && <section className="content-card eod-compliance-center">
      <div className="section-heading"><div><p className="eyebrow">Control diario · hora de Kevin</p><h3>Cumplimiento EOD</h3><p className="muted">La regla de las 8:00 PM se calcula en {kevinTimeZone}.</p></div><label className="eod-compliance-date">Día<input type="date" value={complianceDate} onChange={(event) => setComplianceDate(event.target.value)} /></label></div>
      <div className="eod-compliance-counts" aria-label="Resumen diario"><span className="submitted">{complianceCounts.submitted} enviados</span><span className="working-late">{complianceCounts.working_late} trabajando</span><span className="pending">{complianceCounts.pending} pendientes</span></div>
      <div className="eod-compliance-list">{complianceRows.length === 0 && <p className="muted">No hay usuarios activos para este día.</p>}{complianceRows.map(({ member, status, state }) => <article className="eod-compliance-row" key={member.id}><div><strong data-no-translate>{member.full_name}</strong><small>{member.role}</small></div><span className={`eod-compliance-status ${state}`}>{state === 'submitted' ? 'Enviado' : state === 'working_late' ? 'Trabajando después de las 8 PM' : 'Pendiente'}</span>{state === 'working_late' && <p><b data-no-translate>{status.current_task}</b>{status.expected_report_time && <small>EOD estimado: {status.expected_report_time.slice(0, 5)} · hora Kevin</small>}</p>}</article>)}</div>
    </section>}

    {canReviewAll && <section className="metric-grid eod-review-metrics" aria-label="Estado de reportes EOD"><article className="metric-card blue"><span>Nuevos</span><strong>{reportCounts.new}</strong><small>sin revisar por ti</small></article><article className="metric-card green"><span>Revisados</span><strong>{reportCounts.reviewed}</strong><small>confirmados por ti</small></article><article className="metric-card amber"><span>Seguimiento</span><strong>{reportCounts.followUp}</strong><small>requieren atención</small></article></section>}

    {canSubmit && <section className="content-card eod-cycle-summary"><div><p className="eyebrow">Ciclo diario</p><h3>Día calendario · 00:00–23:59</h3></div><div className="eod-period"><span>Desde <strong>{formatMoment(cycle.start, timeZone, locale)}</strong></span><span>Hasta <strong>{formatMoment(cycle.end, timeZone, locale)}</strong></span><small>{timeZone}</small></div></section>}

    {canSubmit && <section className={`content-card eod-late-card ${afterKevinCutoff ? 'cutoff-active' : ''}`}><div className="section-heading"><div><p className="eyebrow">Regla de las 8:00 PM</p><h3>{ownReportToday ? 'Reporte de hoy enviado' : ownDailyStatus?.status === 'working_late' ? 'Sigues trabajando' : 'Estado de cierre'}</h3><p className="muted">La referencia es la hora de Kevin: {kevinTimeZone}. Si sigues activo después de las 8:00 PM, registra tu hora estimada y copia el aviso a Slack.</p></div><span className={`eod-compliance-status ${ownReportToday ? 'submitted' : ownDailyStatus?.status === 'working_late' ? 'working-late' : 'pending'}`}>{ownReportToday ? 'Enviado' : ownDailyStatus?.status === 'working_late' ? 'Trabajando' : afterKevinCutoff ? 'Acción requerida' : 'Pendiente'}</span></div>{!ownReportToday && <><div className="eod-late-fields"><label>Tarea actual<input maxLength="500" value={lateTask} onChange={(event) => setLateTask(event.target.value)} placeholder="Ej. Finalizando automatización de onboarding" /></label><label>Enviaré el EOD a las<input type="time" value={expectedReportTime} onChange={(event) => setExpectedReportTime(event.target.value)} /><small>Hora de Kevin</small></label></div><div className="eod-slack-preview"><code>{lateNotice}</code><div><button className="secondary-button" type="button" disabled={actionKey === 'late-work'} onClick={registerLateWork}>{actionKey === 'late-work' ? 'Guardando…' : 'Registrar que sigo trabajando'}</button><button className="secondary-button" type="button" onClick={copyLateNotice}>Copiar aviso para Slack</button></div></div></>}</section>}

    {canSubmit && composerOpen && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">Checklist de actividades</p><h3>{selectedTaskIds.length} de {completedTasks.length} tareas seleccionadas</h3><p className="muted">Desmarca cualquier tarea que no quieras incluir.</p></div>{completedTasks.length > 0 && <button className="text-button" type="button" onClick={() => setSelectedTaskIds(selectedTaskIds.length === completedTasks.length ? [] : completedTasks.map((task) => task.id))}>{selectedTaskIds.length === completedTasks.length ? 'Desmarcar todas' : 'Seleccionar todas'}</button>}</div>
      <div className="eod-checklist">{completedTasks.length === 0 && <p className="muted">No completaste tareas registradas durante este ciclo. Puedes agregar actividades manualmente.</p>}{completedTasks.map((task) => <label className="eod-check" key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span><strong data-no-translate>{task.title}</strong><small><span data-no-translate>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : t('Tarea general')}</span> · {formatMoment(task.completed_at, timeZone, locale)}</small>{task.status_note && <small className="task-status-note" data-no-translate>{task.status_note}</small>}</span></label>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Trabajo adicional</p><h3>Agregar actividad manual</h3></div><button className="secondary-button" type="button" onClick={() => setManualTasks((current) => [...current, ''])}>+ Agregar</button></div>
      <div className="manual-task-list">{manualTasks.map((item, index) => <div className="manual-task-row" key={index}><input value={item} onChange={(event) => changeManual(index, event.target.value)} placeholder="Ej. Reunión con cliente o revisión manual" /><button className="text-button" type="button" onClick={() => setManualTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}</div>
      <div className="section-heading"><div><p className="eyebrow">{t('Tiempo manual')}</p><h3>{t('Horas trabajadas')}</h3><p className="muted">{t('Registra horas y un memo como en el diario manual de Upwork.')}</p></div><button className="secondary-button" type="button" onClick={() => setManualHours((current) => [...current, { hours: '', memo: '' }])}>+ {t('Agregar tiempo')}</button></div>
      <div className="manual-hours-list">{manualHours.map((entry, index) => <div className="manual-hours-row" key={index}><label>{t('Horas')}<input type="number" min="0.01" max="24" step="0.01" value={entry.hours} onChange={(event) => changeHours(index, 'hours', event.target.value)} placeholder="0.00" /></label><label>{t('Memo')}<input maxLength="500" value={entry.memo} onChange={(event) => changeHours(index, 'memo', event.target.value)} placeholder={t('Describe el trabajo realizado…')} /></label><button className="text-button" type="button" onClick={() => setManualHours((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t('Quitar')}</button></div>)}</div>
      <label>Notas del día<textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resultados, bloqueos o contexto para supervisión…" /></label>
      <div className="eod-submit-row"><span>{selectedTaskIds.length + manualTasks.filter((item) => item.trim()).length} actividades serán enviadas.</span><button className="primary-button compact-button" disabled={saving}>{saving ? 'Enviando…' : 'Enviar reporte'}</button></div>
    </form>}

    {!canSubmit && !canReviewAll && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}

    <WeeklyHoursPanel entries={timeEntries} directory={directory} profile={profile} canReviewAll={canReviewAll} currentDate={reportDate} />

    <section className="content-card eod-report-center">
      <div className="section-heading"><div><p className="eyebrow">Historial</p><h3>{canReviewAll ? 'Reportes recibidos' : 'Mis reportes enviados'}</h3></div></div>
      <div className="eod-report-filters"><input className="eod-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar usuario…"/>{canReviewAll && <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option>Todos</option><option>Nuevos</option><option>Revisado</option><option>Requiere seguimiento</option><option>Visto</option></select>}</div>
      <div className="report-day-list">{groupedReports.length === 0 && <p className="muted">No hay informes con estos filtros.</p>}{groupedReports.map((group) => <section className="report-day-group" key={group.date}><div className="report-day-heading"><h4>{group.date}</h4><span>{group.items.length} {group.items.length === 1 ? 'reporte' : 'reportes'}</span></div><div className="report-user-grid">{group.items.map((report) => {
        const reportTimeZone = report.profiles?.timezone || timeZone
        const state = getReviewState(report, profile.id)
        return <article className={`report-card eod-review-card ${state.unread ? 'unread' : ''}`} key={report.id}>
          <div className="eod-report-title"><div><strong data-no-translate>{report.profiles?.full_name || t('Usuario')}</strong><small>{t('Enviado')} {formatMoment(report.submitted_at || report.updated_at, timeZone, locale)}</small></div><span className={`eod-review-status ${state.label.toLowerCase().replaceAll(' ', '-')}`}>{t(state.label)}</span></div>
          <small className="report-period">{t('Ciclo diario')}: {formatMoment(report.period_start, reportTimeZone, locale)} — {formatMoment(report.period_end, reportTimeZone, locale)} · {reportTimeZone}</small>
          <p className="eod-activity-count">{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades</p>
          <p className="eod-hours-total">{t('Horas')}: <strong>{(report.time_entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(2)} h</strong></p>
          <ul data-no-translate>{[...(report.completed_tasks || []), ...(report.manual_tasks || [])].map((item, index) => <li key={`${item.id || 'manual'}-${index}`}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>
          {report.notes && <p><strong>{t('Notas')}:</strong> <span data-no-translate>{report.notes}</span></p>}
          {canReviewAll && <><div className="eod-review-actions"><button className="secondary-button" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Visto')}>Marcar visto</button><button className="secondary-button review-ok" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Revisado')}>Revisado</button><button className="secondary-button review-follow-up" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Requiere seguimiento')}>Requiere seguimiento</button></div>
            <form className="eod-comment-form" onSubmit={(event) => submitComment(event, report)}><label>Comentario del supervisor<textarea rows="2" maxLength="2000" value={commentDrafts[report.id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Deja una observación o instrucción…"/></label><button className="primary-button compact-button" disabled={actionKey === `comment-${report.id}` || !commentDrafts[report.id]?.trim()}>{actionKey === `comment-${report.id}` ? 'Guardando…' : 'Agregar comentario'}</button></form></>}
          {(report.comments || []).length > 0 && <div className="eod-comment-list"><strong>Seguimiento</strong>{report.comments.map((comment) => <article className="eod-comment" key={comment.id}><div><b data-no-translate>{comment.author?.full_name || 'Supervisor'}</b><small>{formatMoment(comment.created_at, timeZone, locale)}</small></div><p data-no-translate>{comment.body}</p>{comment.task_id ? <span className="task-created-label">✓ Tarea creada</span> : canReviewAll && comment.author_id === profile.id && <button className="text-button" type="button" disabled={actionKey === `task-${comment.id}`} onClick={() => convertComment(report, comment)}>{actionKey === `task-${comment.id}` ? 'Creando…' : 'Convertir en tarea alta'}</button>}</article>)}</div>}
          {canReviewAll && (report.reviews || []).length > 0 && <div className="eod-reviewers">{report.reviews.map((review) => <small key={review.id}>{review.reviewer?.full_name || 'Supervisor'}: {review.status}</small>)}</div>}
        </article>
      })}</div></section>)}</div>
    </section>
  </div>
}
