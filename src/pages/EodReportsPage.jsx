import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadEodData, saveEodReport } from '../services/eodService'
import { getCalendarDayWindow } from '../utils/timeZone'

function formatMoment(value, timeZone) {
  if (!value) return ''
  return new Intl.DateTimeFormat('es', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function EodReportsPage() {
  const { profile } = useAuth()
  const timeZone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Managua'
  const isAdmin = profile?.role === 'superadmin'
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const data = await loadEodData(profile, { windowStart: cycle.start.toISOString(), windowEnd: cycle.end.toISOString() })
    setCompletedTasks(data.completedTasks)
    setReports(data.reports)
    if (!isAdmin) {
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
  }, [cycle, isAdmin, profile, reportDate])

  useEffect(() => {
    setLoading(true)
    setError('')
    refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [refresh])

  const groupedReports = useMemo(() => {
    const search = userSearch.trim().toLowerCase()
    const groups = new Map()
    reports.filter((report) => !search || (report.profiles?.full_name || '').toLowerCase().includes(search)).forEach((report) => {
      if (!groups.has(report.report_date)) groups.set(report.report_date, [])
      groups.get(report.report_date).push(report)
    })
    return [...groups.entries()].map(([date, items]) => ({ date, items: items.sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || '')) }))
  }, [reports, userSearch])

  const toggleTask = (taskId) => setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId])
  const changeManual = (index, value) => setManualTasks((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))

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
      setMessage('Reporte EOD enviado a Kevin correctamente.')
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>{isAdmin ? 'Trabajo diario del equipo' : 'Informe de fin de día'}</h2><p className="muted">{isAdmin ? 'Reportes enviados, ordenados por día y usuario.' : 'Selecciona el trabajo completado hoy, de 00:00 a 23:59, y envíalo a Kevin.'}</p></div>{!isAdmin && profile?.permissions?.eod_reports && <button className="primary-button compact-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openComposer()}>{composerOpen ? 'Cerrar reporte' : 'Preparar reporte'}</button>}</header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}

    {!isAdmin && profile?.permissions?.eod_reports && <section className="content-card eod-cycle-summary"><div><p className="eyebrow">Ciclo diario</p><h3>Día calendario · 00:00–23:59</h3></div><div className="eod-period"><span>Desde <strong>{formatMoment(cycle.start, timeZone)}</strong></span><span>Hasta <strong>{formatMoment(cycle.end, timeZone)}</strong></span><small>{timeZone}</small></div></section>}

    {!isAdmin && profile?.permissions?.eod_reports && composerOpen && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">Checklist de actividades</p><h3>{selectedTaskIds.length} de {completedTasks.length} tareas seleccionadas</h3><p className="muted">Desmarca cualquier tarea que no quieras incluir en este reporte.</p></div>{completedTasks.length > 0 && <button className="text-button" type="button" onClick={() => setSelectedTaskIds(selectedTaskIds.length === completedTasks.length ? [] : completedTasks.map((task) => task.id))}>{selectedTaskIds.length === completedTasks.length ? 'Desmarcar todas' : 'Seleccionar todas'}</button>}</div>
      <div className="eod-checklist">{completedTasks.length === 0 && <p className="muted">No completaste tareas registradas durante este ciclo. Puedes agregar actividades manualmente.</p>}{completedTasks.map((task) => <label className="eod-check" key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span><strong>{task.title}</strong><small>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'} · {formatMoment(task.completed_at, timeZone)}</small></span></label>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Trabajo adicional</p><h3>Agregar actividad manual</h3></div><button className="secondary-button" type="button" onClick={() => setManualTasks((current) => [...current, ''])}>+ Agregar</button></div>
      <div className="manual-task-list">{manualTasks.map((item, index) => <div className="manual-task-row" key={index}><input value={item} onChange={(event) => changeManual(index, event.target.value)} placeholder="Ej. Reunión con cliente o revisión manual" /><button className="text-button" type="button" onClick={() => setManualTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}</div>
      <label>Notas del día<textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resultados, bloqueos o contexto para Kevin…" /></label>
      <div className="eod-submit-row"><span>{selectedTaskIds.length + manualTasks.filter((item) => item.trim()).length} actividades serán enviadas.</span><button className="primary-button compact-button" disabled={saving}>{saving ? 'Enviando…' : 'Enviar reporte a Kevin'}</button></div>
    </form>}

    {!isAdmin && !profile?.permissions?.eod_reports && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Historial</p><h3>{isAdmin ? 'Reportes recibidos' : 'Mis reportes enviados'}</h3></div>{isAdmin && <input className="eod-user-search" type="search" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Buscar usuario…" />}</div><div className="report-day-list">{groupedReports.length === 0 && <p className="muted">Aún no hay informes.</p>}{groupedReports.map((group) => <section className="report-day-group" key={group.date}><div className="report-day-heading"><h4>{group.date}</h4><span>{group.items.length} {group.items.length === 1 ? 'reporte' : 'reportes'}</span></div><div className="report-user-grid">{group.items.map((report) => { const reportTimeZone = report.profiles?.timezone || timeZone; return <article className="report-card" key={report.id}><div><strong>{report.profiles?.full_name || 'Usuario'}</strong><span className="status-pill">Enviado</span></div><small>Enviado {formatMoment(report.submitted_at || report.updated_at, timeZone)} · {(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades</small><small className="report-period">Ciclo: {formatMoment(report.period_start, reportTimeZone)} — {formatMoment(report.period_end, reportTimeZone)} · {reportTimeZone}</small><ul>{[...(report.completed_tasks || []), ...(report.manual_tasks || [])].map((item, index) => <li key={`${item.id || 'manual'}-${index}`}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>{report.notes && <p><strong>Notas:</strong> {report.notes}</p>}</article> })}</div></section>)}</div></section>
  </div>
}
