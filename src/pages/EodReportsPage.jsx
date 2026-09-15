import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import {
  addEodComment,
  convertEodCommentToTask,
  loadEodData,
  saveEodReport,
  saveEodReview,
} from '../services/eodService'
import { getCalendarDayWindow } from '../utils/timeZone'

function formatMoment(value, timeZone) {
  if (!value) return ''
  return new Intl.DateTimeFormat('es', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function getReviewState(report, reviewerId) {
  const review = (report.reviews || []).find((item) => item.reviewer_id === reviewerId)
  const unread = !review || new Date(review.viewed_at) < new Date(report.updated_at)
  return { review, unread, label: unread ? 'Nuevo' : review.status }
}

export default function EodReportsPage() {
  const { profile } = useAuth()
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
  const [manualTasks, setManualTasks] = useState([''])
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
    if (!isSuperadmin) {
      const existing = data.reports.find((item) => item.user_id === profile.id && item.report_date === reportDate)
      if (existing) {
        const existingIds = new Set((existing.completed_tasks || []).map((item) => item.id))
        setSelectedTaskIds(data.completedTasks.filter((task) => existingIds.has(task.id)).map((task) => task.id))
        setManualTasks(existing.manual_tasks?.length ? existing.manual_tasks.map((item) => item.title) : [''])
        setNotes(existing.notes || '')
      } else {
        setSelectedTaskIds(data.completedTasks.map((task) => task.id))
        setManualTasks([''])
        setNotes('')
      }
    }
  }, [cycle, isSuperadmin, profile, reportDate])

  useEffect(() => {
    setLoading(true)
    setError('')
    refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [refresh])

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

  const runAction = async (key, action, success) => {
    setActionKey(key); setError(''); setMessage('')
    try {
      await action()
      await refresh()
      setMessage(success)
      window.dispatchEvent(new CustomEvent('eod-review-updated'))
      return true
    } catch (actionError) {
      setError(actionError.message)
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

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const selectedTasks = completedTasks.filter((task) => selectedTaskIds.includes(task.id)).map((task) => ({
        id: task.id,
        title: task.title,
        client: task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'General',
        completed_at: task.completed_at,
      }))
      await saveEodReport({
        profileId: profile.id,
        reportDate,
        periodStart: cycle.start.toISOString(),
        periodEnd: cycle.end.toISOString(),
        completedTasks: selectedTasks,
        manualTasks,
        notes,
      })
      await refresh()
      setComposerOpen(false)
      setMessage('Reporte EOD enviado a Kevin y Alejandra correctamente.')
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>{canReviewAll ? 'Centro de revisión diaria' : 'Informe de fin de día'}</h2><p className="muted">{canReviewAll ? 'Revisa el trabajo del equipo, registra seguimiento y conviértelo en tareas.' : 'Selecciona el trabajo completado hoy, de 00:00 a 23:59, y envíalo a Kevin y Alejandra.'}</p></div>{canSubmit && <button className="primary-button compact-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openComposer()}>{composerOpen ? 'Cerrar reporte' : 'Preparar reporte'}</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}

    {canReviewAll && <section className="metric-grid eod-review-metrics" aria-label="Estado de reportes EOD"><article className="metric-card blue"><span>Nuevos</span><strong>{reportCounts.new}</strong><small>sin revisar por ti</small></article><article className="metric-card green"><span>Revisados</span><strong>{reportCounts.reviewed}</strong><small>confirmados por ti</small></article><article className="metric-card amber"><span>Seguimiento</span><strong>{reportCounts.followUp}</strong><small>requieren atención</small></article></section>}

    {canSubmit && <section className="content-card eod-cycle-summary"><div><p className="eyebrow">Ciclo diario</p><h3>Día calendario · 00:00–23:59</h3></div><div className="eod-period"><span>Desde <strong>{formatMoment(cycle.start, timeZone)}</strong></span><span>Hasta <strong>{formatMoment(cycle.end, timeZone)}</strong></span><small>{timeZone}</small></div></section>}

    {canSubmit && composerOpen && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">Checklist de actividades</p><h3>{selectedTaskIds.length} de {completedTasks.length} tareas seleccionadas</h3><p className="muted">Desmarca cualquier tarea que no quieras incluir.</p></div>{completedTasks.length > 0 && <button className="text-button" type="button" onClick={() => setSelectedTaskIds(selectedTaskIds.length === completedTasks.length ? [] : completedTasks.map((task) => task.id))}>{selectedTaskIds.length === completedTasks.length ? 'Desmarcar todas' : 'Seleccionar todas'}</button>}</div>
      <div className="eod-checklist">{completedTasks.length === 0 && <p className="muted">No completaste tareas registradas durante este ciclo. Puedes agregar actividades manualmente.</p>}{completedTasks.map((task) => <label className="eod-check" key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span><strong>{task.title}</strong><small>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'} · {formatMoment(task.completed_at, timeZone)}</small></span></label>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Trabajo adicional</p><h3>Agregar actividad manual</h3></div><button className="secondary-button" type="button" onClick={() => setManualTasks((current) => [...current, ''])}>+ Agregar</button></div>
      <div className="manual-task-list">{manualTasks.map((item, index) => <div className="manual-task-row" key={index}><input value={item} onChange={(event) => changeManual(index, event.target.value)} placeholder="Ej. Reunión con cliente o revisión manual" /><button className="text-button" type="button" onClick={() => setManualTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}</div>
      <label>Notas del día<textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resultados, bloqueos o contexto para supervisión…" /></label>
      <div className="eod-submit-row"><span>{selectedTaskIds.length + manualTasks.filter((item) => item.trim()).length} actividades serán enviadas.</span><button className="primary-button compact-button" disabled={saving}>{saving ? 'Enviando…' : 'Enviar reporte'}</button></div>
    </form>}

    {!canSubmit && !canReviewAll && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}

    <section className="content-card eod-report-center">
      <div className="section-heading"><div><p className="eyebrow">Historial</p><h3>{canReviewAll ? 'Reportes recibidos' : 'Mis reportes enviados'}</h3></div></div>
      <div className="eod-report-filters"><input className="eod-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar usuario…"/>{canReviewAll && <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option>Todos</option><option>Nuevos</option><option>Revisado</option><option>Requiere seguimiento</option><option>Visto</option></select>}</div>
      <div className="report-day-list">{groupedReports.length === 0 && <p className="muted">No hay informes con estos filtros.</p>}{groupedReports.map((group) => <section className="report-day-group" key={group.date}><div className="report-day-heading"><h4>{group.date}</h4><span>{group.items.length} {group.items.length === 1 ? 'reporte' : 'reportes'}</span></div><div className="report-user-grid">{group.items.map((report) => {
        const reportTimeZone = report.profiles?.timezone || timeZone
        const state = getReviewState(report, profile.id)
        return <article className={`report-card eod-review-card ${state.unread ? 'unread' : ''}`} key={report.id}>
          <div className="eod-report-title"><div><strong>{report.profiles?.full_name || 'Usuario'}</strong><small>Enviado {formatMoment(report.submitted_at || report.updated_at, timeZone)}</small></div><span className={`eod-review-status ${state.label.toLowerCase().replaceAll(' ', '-')}`}>{state.label}</span></div>
          <small className="report-period">Ciclo: {formatMoment(report.period_start, reportTimeZone)} — {formatMoment(report.period_end, reportTimeZone)} · {reportTimeZone}</small>
          <p className="eod-activity-count">{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades</p>
          <ul>{[...(report.completed_tasks || []), ...(report.manual_tasks || [])].map((item, index) => <li key={`${item.id || 'manual'}-${index}`}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>
          {report.notes && <p><strong>Notas:</strong> {report.notes}</p>}
          {canReviewAll && <><div className="eod-review-actions"><button className="secondary-button" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Visto')}>Marcar visto</button><button className="secondary-button review-ok" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Revisado')}>Revisado</button><button className="secondary-button review-follow-up" type="button" disabled={actionKey === `review-${report.id}`} onClick={() => updateReview(report, 'Requiere seguimiento')}>Requiere seguimiento</button></div>
            <form className="eod-comment-form" onSubmit={(event) => submitComment(event, report)}><label>Comentario del supervisor<textarea rows="2" maxLength="2000" value={commentDrafts[report.id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Deja una observación o instrucción…"/></label><button className="primary-button compact-button" disabled={actionKey === `comment-${report.id}` || !commentDrafts[report.id]?.trim()}>{actionKey === `comment-${report.id}` ? 'Guardando…' : 'Agregar comentario'}</button></form></>}
          {(report.comments || []).length > 0 && <div className="eod-comment-list"><strong>Seguimiento</strong>{report.comments.map((comment) => <article className="eod-comment" key={comment.id}><div><b>{comment.author?.full_name || 'Supervisor'}</b><small>{formatMoment(comment.created_at, timeZone)}</small></div><p>{comment.body}</p>{comment.task_id ? <span className="task-created-label">✓ Tarea creada</span> : canReviewAll && comment.author_id === profile.id && <button className="text-button" type="button" disabled={actionKey === `task-${comment.id}`} onClick={() => convertComment(report, comment)}>{actionKey === `task-${comment.id}` ? 'Creando…' : 'Convertir en tarea alta'}</button>}</article>)}</div>}
          {canReviewAll && (report.reviews || []).length > 0 && <div className="eod-reviewers">{report.reviews.map((review) => <small key={review.id}>{review.reviewer?.full_name || 'Supervisor'}: {review.status}</small>)}</div>}
        </article>
      })}</div></section>)}</div>
    </section>
  </div>
}
