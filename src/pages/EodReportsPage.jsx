import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadEodData, saveEodReport } from '../services/eodService'

const today = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export default function EodReportsPage() {
  const { profile } = useAuth()
  const [reportDate, setReportDate] = useState(today())
  const [completedTasks, setCompletedTasks] = useState([])
  const [reports, setReports] = useState([])
  const [manualTasks, setManualTasks] = useState([''])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const isAdmin = profile?.role === 'superadmin'

  const refresh = async () => {
    const data = await loadEodData(profile, reportDate)
    setCompletedTasks(data.completedTasks); setReports(data.reports)
    const existing = data.reports.find((item) => item.user_id === profile.id && item.report_date === reportDate)
    if (existing) {
      setManualTasks(existing.manual_tasks?.length ? existing.manual_tasks.map((item) => item.title) : [''])
      setNotes(existing.notes || '')
    } else { setManualTasks(['']); setNotes('') }
  }
  useEffect(() => { setLoading(true); refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false)) }, [reportDate, profile.id])
  const changeManual = (index, value) => setManualTasks((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await saveEodReport({
        profileId: profile.id, reportDate,
        completedTasks: completedTasks.map((task) => ({ id: task.id, title: task.title, client: task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'General' })),
        manualTasks, notes,
      })
      await refresh(); setMessage('Informe EOD generado correctamente.')
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">EOD Reports</p><h2>Informe de fin de día</h2><p className="muted">Las tareas completadas se agregan automáticamente y puedes sumar trabajo manual.</p></div><input className="date-header-input" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {!isAdmin && profile?.permissions?.eod_reports && <form className="content-card eod-form" onSubmit={submit}>
      <div className="section-heading"><div><p className="eyebrow">Tareas registradas</p><h3>{completedTasks.length} completadas el {reportDate}</h3></div></div>
      <div className="eod-task-list">{completedTasks.length === 0 && <p className="muted">Todavía no marcaste tareas como completadas en esta fecha.</p>}{completedTasks.map((task) => <div className="mini-row" key={task.id}><span>✓</span><div><strong>{task.title}</strong><small>{task.clients ? `${task.clients.code} · ${task.clients.business_name}` : 'Tarea general'}</small></div></div>)}</div>
      <div className="section-heading"><div><p className="eyebrow">Trabajo adicional</p><h3>Agregar tareas manualmente</h3></div><button className="secondary-button" type="button" onClick={() => setManualTasks((current) => [...current, ''])}>+ Agregar</button></div>
      <div className="manual-task-list">{manualTasks.map((item, index) => <div className="manual-task-row" key={index}><input value={item} onChange={(event) => changeManual(index, event.target.value)} placeholder="Ej. Reunión con cliente o revisión manual" /><button className="text-button" type="button" onClick={() => setManualTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar</button></div>)}</div>
      <label>Notas del día<textarea rows="4" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Resultados, bloqueos o contexto para Kevin…" /></label>
      <button className="primary-button compact-button" disabled={saving}>{saving ? 'Generando…' : 'Generar informe EOD'}</button>
    </form>}{!isAdmin && !profile?.permissions?.eod_reports && <section className="content-card"><p className="muted">Tu usuario no tiene permiso para generar informes EOD.</p></section>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Historial</p><h3>Informes enviados</h3></div></div><div className="report-list">{reports.length === 0 && <p className="muted">Aún no hay informes.</p>}{reports.map((report) => <article className="report-card" key={report.id}><div><strong>{report.profiles?.full_name || 'Usuario'} · {report.report_date}</strong><small>{(report.completed_tasks?.length || 0) + (report.manual_tasks?.length || 0)} actividades</small></div><ul>{[...(report.completed_tasks || []), ...(report.manual_tasks || [])].map((item, index) => <li key={index}>{item.client ? `${item.client}: ` : ''}{item.title}</li>)}</ul>{report.notes && <p>{report.notes}</p>}</article>)}</div></section>
  </div>
}
