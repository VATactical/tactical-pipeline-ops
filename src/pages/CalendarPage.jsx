import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { createCalendarEvent, loadCalendarData, markNotificationRead } from '../services/calendarService'

const initialEvent = { title: '', eventType: 'Reunión', clientId: '', startAt: '', endAt: '', meetingUrl: '', notes: '', reminders: [15, 60, 1440] }
const reminderLabels = { 15: '15 minutos', 60: '1 hora', 1440: '24 horas' }

export default function CalendarPage() {
  const { profile } = useAuth()
  const [data, setData] = useState({ events: [], clients: [], notifications: [] })
  const [form, setForm] = useState(initialEvent)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const refresh = async () => setData(await loadCalendarData())
  useEffect(() => {
    refresh().catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
    const timer = window.setInterval(() => refresh().catch(() => {}), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (notificationPermission !== 'granted') return
    data.notifications.forEach((notice) => {
      const key = `calendar-notified-${notice.id}`
      if (!sessionStorage.getItem(key)) {
        new Notification(notice.title, { body: notice.body })
        sessionStorage.setItem(key, '1')
      }
    })
  }, [data.notifications, notificationPermission])
  const upcoming = useMemo(() => data.events.filter((event) => new Date(event.start_at) >= new Date()).slice(0, 30), [data.events])
  const toggleReminder = (minutes) => setForm((current) => ({ ...current, reminders: current.reminders.includes(minutes) ? current.reminders.filter((item) => item !== minutes) : [...current.reminders, minutes] }))
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await createCalendarEvent(form, profile.id)
      setForm(initialEvent); await refresh(); setMessage('Evento creado con sus recordatorios.')
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(false) }
  }
  const enableBrowserNotifications = async () => {
    if (!('Notification' in window)) { setMessage('Este navegador no admite notificaciones. Las alertas internas seguirán activas.'); return }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    setMessage(permission === 'granted' ? 'Notificaciones del navegador activadas.' : 'Las alertas internas seguirán activas.')
  }
  const dismiss = async (id) => {
    try { await markNotificationRead(id); setData((current) => ({ ...current, notifications: current.notifications.filter((item) => item.id !== id) })) }
    catch (dismissError) { setError(dismissError.message) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Agenda operativa</p><h2>Calendario</h2><p className="muted">Eventos, reuniones, enlaces y recordatorios del equipo.</p></div><div className="header-actions"><span className="status-pill">{upcoming.length} próximos</span>{notificationPermission !== 'granted' && <button className="secondary-button" onClick={enableBrowserNotifications}>Activar notificaciones</button>}</div></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {data.notifications.map((notice) => <section className="new-task-alert calendar-notice" role="alert" key={notice.id}><div><strong>{notice.title}</strong><p>{notice.body}</p></div><button className="secondary-button" onClick={() => dismiss(notice.id)}>Marcar vista</button></section>)}
    {profile?.permissions?.calendar_manage && <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Nuevo</p><h3>Crear evento</h3></div></div><form className="calendar-form" onSubmit={submit}>
      <label>Título<input value={form.title} onChange={(event) => setField('title', event.target.value)} required /></label>
      <label>Tipo<select value={form.eventType} onChange={(event) => setField('eventType', event.target.value)}><option>Reunión</option><option>Evento</option><option>Nota</option></select></label>
      <label>Cliente<select value={form.clientId} onChange={(event) => setField('clientId', event.target.value)}><option value="">General / Todos</option>{data.clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.business_name}</option>)}</select></label>
      <label>Inicio<input type="datetime-local" value={form.startAt} onChange={(event) => setField('startAt', event.target.value)} required /></label>
      <label>Final<input type="datetime-local" value={form.endAt} onChange={(event) => setField('endAt', event.target.value)} /></label>
      <label>Enlace de reunión<input type="url" value={form.meetingUrl} onChange={(event) => setField('meetingUrl', event.target.value)} placeholder="https://meet.google.com/…" /></label>
      <label className="wide">Notas<textarea rows="3" value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
      <div className="wide"><span className="field-label">Notificar antes</span><div className="reminder-options">{[15, 60, 1440].map((minutes) => <label key={minutes}><input type="checkbox" checked={form.reminders.includes(minutes)} onChange={() => toggleReminder(minutes)} />{reminderLabels[minutes]}</label>)}</div></div>
      <div className="wide"><button className="primary-button compact-button" disabled={saving}>{saving ? 'Creando…' : 'Crear evento'}</button></div>
    </form></section>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Próximos</p><h3>Agenda del equipo</h3></div></div><div className="calendar-list">{upcoming.length === 0 && <p className="muted">No hay eventos próximos.</p>}{upcoming.map((event) => <article className="calendar-event" key={event.id}><time>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.start_at))}</time><div><strong>{event.title}</strong><p>{event.clients ? `${event.clients.code} · ${event.clients.business_name}` : 'Evento general'} · {event.event_type}</p>{event.notes && <small>{event.notes}</small>}</div>{event.meeting_url && <a className="secondary-button" href={event.meeting_url} target="_blank" rel="noreferrer">Abrir enlace ↗</a>}</article>)}</div></section>
  </div>
}
