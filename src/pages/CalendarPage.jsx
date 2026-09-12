import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { createCalendarEvent, loadCalendarData, markNotificationRead } from '../services/calendarService'

const zones = [['America/Managua', 'Nicaragua'], ['Africa/Lagos', 'Nigeria'], ['America/New_York', 'USA Eastern'], ['America/Chicago', 'USA Central'], ['America/Denver', 'USA Mountain'], ['America/Los_Angeles', 'USA Pacific']]
const reminderLabels = { 15: '15 minutos', 60: '1 hora', 1440: '24 horas' }
const blankEvent = (timezone) => ({ title: '', eventType: 'Reunión', clientId: '', startAt: '', endAt: '', meetingUrl: '', notes: '', reminders: [15, 60, 1440], timezone })
const dayKey = (date, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const calendarKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function WorldClocks() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  return <section className="world-clocks">{zones.map(([zone, label]) => <article className="clock-card" key={zone}><span>{label}</span><strong>{new Intl.DateTimeFormat('es', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)}</strong><small>{new Intl.DateTimeFormat('es', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</small></article>)}</section>
}

export default function CalendarPage() {
  const { profile } = useAuth()
  const displayZone = profile.timezone || 'America/Managua'
  const [data, setData] = useState({ events: [], clients: [], notifications: [] })
  const [form, setForm] = useState(() => blankEvent(displayZone))
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date(), displayZone))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [notificationPermission, setNotificationPermission] = useState(() => 'Notification' in window ? Notification.permission : 'unsupported')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const refresh = async () => setData(await loadCalendarData())

  useEffect(() => { refresh().catch((e) => setError(e.message)).finally(() => setLoading(false)); const timer = window.setInterval(() => refresh().catch(() => {}), 60000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (notificationPermission !== 'granted') return; data.notifications.forEach((notice) => { const key = `calendar-notified-${notice.id}`; if (!sessionStorage.getItem(key)) { new Notification(notice.title, { body: notice.body }); sessionStorage.setItem(key, '1') } }) }, [data.notifications, notificationPermission])

  const upcoming = useMemo(() => data.events.filter((event) => new Date(event.start_at) >= new Date()).slice(0, 30), [data.events])
  const monthDays = useMemo(() => { const blanks = (month.getDay() + 6) % 7; const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); return [...Array(blanks).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))] }, [month])
  const eventsFor = (key) => data.events.filter((event) => dayKey(new Date(event.start_at), displayZone) === key)
  const selectedEvents = eventsFor(selectedDay)
  const toggleReminder = (minutes) => setForm((current) => ({ ...current, reminders: current.reminders.includes(minutes) ? current.reminders.filter((item) => item !== minutes) : [...current.reminders, minutes] }))
  const submit = async (event) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await createCalendarEvent(form, profile.id); setForm(blankEvent(displayZone)); await refresh(); setMessage('Evento creado con sus recordatorios.') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  const enableNotifications = async () => { if (!('Notification' in window)) return setMessage('Las alertas internas seguirán activas.'); const permission = await Notification.requestPermission(); setNotificationPermission(permission); setMessage(permission === 'granted' ? 'Notificaciones activadas.' : 'Las alertas internas seguirán activas.') }
  const dismiss = async (id) => { try { await markNotificationRead(id); setData((current) => ({ ...current, notifications: current.notifications.filter((item) => item.id !== id) })) } catch (e) { setError(e.message) } }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Agenda operativa</p><h2>Calendario internacional</h2><p className="muted">Tu agenda se muestra en {zones.find(([zone]) => zone === displayZone)?.[1] || displayZone}. Cada evento conserva su zona original.</p></div><div className="header-actions"><span className="status-pill">{upcoming.length} próximos</span>{notificationPermission !== 'granted' && <button className="secondary-button" onClick={enableNotifications}>Activar notificaciones</button>}</div></header>
    <WorldClocks />
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {data.notifications.map((notice) => <section className="new-task-alert calendar-notice" role="alert" key={notice.id}><div><strong>{notice.title}</strong><p>{notice.body}</p></div><button className="secondary-button" onClick={() => dismiss(notice.id)}>Marcar vista</button></section>)}
    <section className="calendar-workspace content-card"><div className="month-panel"><div className="month-toolbar"><button className="secondary-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button><h3>{new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' }).format(month)}</h3><button className="secondary-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button></div><div className="month-grid weekday-row">{['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <b key={day}>{day}</b>)}</div><div className="month-grid">{monthDays.map((day, i) => { if (!day) return <span className="calendar-day empty" key={`e-${i}`} />; const key = calendarKey(day); const count = eventsFor(key).length; return <button className={`calendar-day ${selectedDay === key ? 'selected' : ''}`} onClick={() => setSelectedDay(key)} key={key}><span>{day.getDate()}</span>{count > 0 && <b>{count}</b>}</button> })}</div></div><aside className="day-agenda"><p className="eyebrow">{selectedDay}</p><h3>Agenda del día</h3>{selectedEvents.length === 0 && <p className="muted">Sin eventos.</p>}{selectedEvents.map((event) => <article key={event.id}><time>{new Intl.DateTimeFormat('es', { timeZone: displayZone, hour: '2-digit', minute: '2-digit' }).format(new Date(event.start_at))}</time><strong>{event.title}</strong><small>{event.clients ? `${event.clients.code} · ${event.clients.business_name}` : 'General'}</small>{event.meeting_url && <a href={event.meeting_url} target="_blank" rel="noreferrer">Abrir enlace ↗</a>}</article>)}</aside></section>
    {profile?.permissions?.calendar_manage && <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Nuevo</p><h3>Crear evento</h3></div></div><form className="calendar-form" onSubmit={submit}>
      <label>Título<input value={form.title} onChange={(event) => setField('title', event.target.value)} required /></label><label>Tipo<select value={form.eventType} onChange={(event) => setField('eventType', event.target.value)}><option>Reunión</option><option>Evento</option><option>Nota</option></select></label>
      <label>Cliente<select value={form.clientId} onChange={(event) => { const client = data.clients.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, clientId: event.target.value, timezone: client?.timezone || current.timezone })) }}><option value="">General / Todos</option>{data.clients.map((client) => <option value={client.id} key={client.id}>{client.code} · {client.business_name}</option>)}</select></label><label>Zona del evento<select value={form.timezone} onChange={(event) => setField('timezone', event.target.value)}>{zones.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Inicio<input type="datetime-local" value={form.startAt} onChange={(event) => setField('startAt', event.target.value)} required /></label><label>Final<input type="datetime-local" value={form.endAt} onChange={(event) => setField('endAt', event.target.value)} /></label><label className="wide">Enlace de reunión<input type="url" value={form.meetingUrl} onChange={(event) => setField('meetingUrl', event.target.value)} /></label><label className="wide">Notas<textarea rows="3" value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
      <div className="wide"><span className="field-label">Notificar antes</span><div className="reminder-options">{[15, 60, 1440].map((minutes) => <label key={minutes}><input type="checkbox" checked={form.reminders.includes(minutes)} onChange={() => toggleReminder(minutes)} />{reminderLabels[minutes]}</label>)}</div></div><div className="wide"><button className="primary-button compact-button" disabled={saving}>{saving ? 'Creando…' : 'Crear evento'}</button></div>
    </form></section>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Próximos</p><h3>Agenda del equipo</h3></div></div><div className="calendar-list">{upcoming.length === 0 && <p className="muted">No hay eventos próximos.</p>}{upcoming.map((event) => <article className="calendar-event" key={event.id}><time>{new Intl.DateTimeFormat('es', { timeZone: displayZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.start_at))}</time><div><strong>{event.title}</strong><p>{event.clients ? `${event.clients.code} · ${event.clients.business_name}` : 'Evento general'} · {event.event_type}</p><small>Creado en {zones.find(([zone]) => zone === event.timezone)?.[1] || event.timezone}</small></div>{event.meeting_url && <a className="secondary-button" href={event.meeting_url} target="_blank" rel="noreferrer">Abrir enlace ↗</a>}</article>)}</div></section>
  </div>
}
