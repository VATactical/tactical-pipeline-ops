import { useEffect, useState } from 'react'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { loadCalendarData, markNotificationRead } from '../services/calendarService'
import { loadOperations, markGeneralNoteSeen } from '../services/opsService'

export default function CommunicationsPage() {
  const { profile } = useAuth()
  const { locale, t } = useLanguage()
  const [notes, setNotes] = useState([])
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    const [operations, calendar] = await Promise.all([loadOperations(profile.id), loadCalendarData()])
    setNotes(operations.notes || [])
    setNotifications(calendar.notifications || [])
  }
  useEffect(() => { refresh().catch((loadError) => setError(t(loadError.message))).finally(() => setLoading(false)) }, [profile.id, t])
  const markNote = async (note) => { try { await markGeneralNoteSeen(note.id, profile.id); await refresh() } catch (actionError) { setError(t(actionError.message)) } }
  const dismissNotification = async (notification) => { try { await markNotificationRead(notification.id); setNotifications((current) => current.filter((item) => item.id !== notification.id)) } catch (actionError) { setError(t(actionError.message)) } }
  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">TP OPS</p><h2>Comunicaciones y notificaciones</h2><p className="muted">Mensajes generales, avisos específicos y recordatorios operativos en un solo lugar.</p></div><span className="status-pill">{notes.length + notifications.length} avisos</span></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Notificaciones</p><h3>Avisos pendientes</h3></div></div><div className="notification-list">{notifications.length === 0 && <p className="muted">No hay notificaciones pendientes.</p>}{notifications.map((notice) => <article className="notification-row" key={notice.id}><div><strong>{notice.title}</strong><p>{notice.body}</p><small>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notice.notify_at))}</small></div><button className="secondary-button" type="button" onClick={() => dismissNotification(notice)}>Marcar vista</button></article>)}</div></section>
    <section className="content-card"><div className="section-heading"><div><p className="eyebrow">Mensajes</p><h3>Generales y específicos</h3></div></div><div className="notification-list">{notes.length === 0 && <p className="muted">No hay mensajes.</p>}{notes.map((note) => <article className={`notification-row ${note.receipt ? 'seen' : ''}`} key={note.id}><div><strong data-no-translate>{note.title}</strong><p className="formatted-text" data-no-translate>{note.body}</p><small>{note.client_id ? 'Mensaje específico de cliente' : 'Mensaje general'}{note.slack_channel ? ` · ${note.slack_channel}` : ''} · {note.author?.full_name || 'Equipo'} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.created_at))}</small></div>{!note.receipt && <button className="secondary-button" type="button" onClick={() => markNote(note)}>Marcar visto</button>}</article>)}</div></section>
  </div>
}
