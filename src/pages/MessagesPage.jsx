import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadMessageCenter, markTeamMessageRead, sendTeamMessage, subscribeToTeamMessages } from '../services/messageService'

export default function MessagesPage() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState({ members: [], messages: [] })
  const [recipientId, setRecipientId] = useState(params.get('to') || '')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => setData(await loadMessageCenter(profile.id)), [profile.id])

  useEffect(() => {
    refresh().catch((e) => setError(e.message)).finally(() => setLoading(false))
    return subscribeToTeamMessages(profile.id, () => refresh().catch(() => {}))
  }, [profile.id, refresh])

  const recipients = data.members.filter((member) => member.id !== profile.id)
  const inbox = useMemo(() => data.messages.filter((item) => item.recipient_id === profile.id), [data.messages, profile.id])
  const sent = useMemo(() => data.messages.filter((item) => item.sender_id === profile.id), [data.messages, profile.id])

  useEffect(() => {
    if (loading || !recipientId) return
    if (!recipients.some((member) => member.id === recipientId)) setRecipientId('')
  }, [loading, recipientId, recipients])

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await sendTeamMessage(profile.id, recipientId, body)
      setBody(''); setParams({}); await refresh(); setMessage('Mensaje enviado.')
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }
  const markRead = async (item) => {
    try { await markTeamMessageRead(item.id, profile.id); await refresh() }
    catch (e) { setError(e.message) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Comunicación interna</p><h2>Mensajes del equipo</h2><p className="muted">Envía avisos breves y privados. Para conversaciones largas usa Slack.</p></div><span className="status-pill">{inbox.filter((item) => !item.read_at).length} sin leer</span></header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success">{message}</p>}
    <form className="content-card message-composer" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Nuevo</p><h3>Mensaje corto</h3></div><small>{body.length}/500</small></div><label>Para<select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} required><option value="">Seleccionar usuario…</option>{recipients.map((member) => <option value={member.id} key={member.id}>{member.full_name} · {member.email}</option>)}</select></label><label>Mensaje<textarea rows="3" maxLength="500" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe una alerta, pregunta o actualización breve…" required /></label><button className="primary-button compact-button" disabled={saving}>{saving ? 'Enviando…' : 'Enviar mensaje'}</button></form>
    <div className="message-columns"><section className="content-card"><div className="section-heading"><div><p className="eyebrow">Recibidos</p><h3>Bandeja de entrada</h3></div></div><div className="message-list">{inbox.length === 0 && <p className="muted">No tienes mensajes.</p>}{inbox.map((item) => <article className={`team-message ${item.read_at ? '' : 'unread'}`} key={item.id}><div><strong>{item.sender_name}</strong><time>{new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div><p>{item.body}</p>{!item.read_at && <button className="text-button" type="button" onClick={() => markRead(item)}>Marcar como leído</button>}</article>)}</div></section><section className="content-card"><div className="section-heading"><div><p className="eyebrow">Enviados</p><h3>Mensajes recientes</h3></div></div><div className="message-list">{sent.length === 0 && <p className="muted">Aún no enviaste mensajes.</p>}{sent.map((item) => <article className="team-message" key={item.id}><div><strong>Para {item.recipient_name}</strong><time>{new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at))}</time></div><p>{item.body}</p><small>{item.read_at ? 'Leído' : 'Enviado'}</small></article>)}</div></section></div>
  </div>
}
