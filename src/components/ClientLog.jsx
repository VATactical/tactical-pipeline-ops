import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import LinkifiedText from './LinkifiedText'
import { addClientComment, deleteClientComment, loadClientComments, updateClientComment } from '../services/opsService'

// Client log ("bitácora"): short comments like Trello card comments, tagged as an update,
// something done or a blocker. Links in the text become clickable.

export const COMMENT_KINDS = [
  ['update', '📝', 'Actualización'],
  ['done', '✅', 'Hecho'],
  ['blocked', '⛔', 'Bloqueado'],
]
function KindPicker({ value, onChange }) {
  const { t } = useLanguage()
  return <div className="client-log-kinds" role="radiogroup" aria-label={t('Tipo de comentario')}>
    {COMMENT_KINDS.map(([kind, icon, label]) => <button key={kind} type="button" role="radio" aria-checked={value === kind}
      className={`client-log-kind ${kind} ${value === kind ? 'selected' : ''}`} onClick={() => onChange(kind)}>{icon} {t(label)}</button>)}
  </div>
}

export default function ClientLog({ clientId, limit = null, onChanged, compact = false }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [comments, setComments] = useState(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ kind: 'update', body: '', sendToSlack: false })
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const isAdmin = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const reload = useCallback(async () => {
    try { setComments(await loadClientComments(clientId)); setError('') }
    catch (loadError) { setError(t(loadError.message)) }
  }, [clientId, t])
  useEffect(() => { setComments(null); reload() }, [reload])

  const submit = async (event) => {
    event?.preventDefault()
    if (!draft.body.trim() || saving) return
    setSaving(true); setError('')
    try { await addClientComment({ clientId, profileId: profile?.id, ...draft }); setDraft({ kind: 'update', body: '', sendToSlack: false }); await reload(); onChanged?.() }
    catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }
  const saveEdit = async () => {
    setSaving(true); setError('')
    try { await updateClientComment(editing.id, editing); setEditing(null); await reload() }
    catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }
  const remove = async (comment) => {
    if (!window.confirm(t('¿Eliminar este comentario?'))) return
    setError('')
    try { await deleteClientComment(comment.id); await reload(); onChanged?.() }
    catch (deleteError) { setError(t(deleteError.message)) }
  }

  const formatWhen = (value) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  const visible = comments ? (limit && !showAll ? comments.slice(0, limit) : comments) : []

  return <div className={`client-log ${compact ? 'compact' : ''}`}>
    <form className="client-log-form" onSubmit={submit}>
      <textarea rows={draft.body ? 3 : 1} value={draft.body} maxLength={4000} placeholder={t('Escribe un avance, algo que quedó hecho o un bloqueo…')}
        onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit() }} />
      {draft.body && <div className="client-log-form-actions">
        <KindPicker value={draft.kind} onChange={(kind) => setDraft((current) => ({ ...current, kind }))} />
        <label className="client-log-slack" title={draft.kind === 'blocked' ? t('Los bloqueos siempre se avisan en el canal de Slack del cliente.') : t('Publica este comentario en el canal de Slack del cliente.')}>
          <input type="checkbox" checked={draft.kind === 'blocked' || draft.sendToSlack} disabled={draft.kind === 'blocked'}
            onChange={(event) => setDraft((current) => ({ ...current, sendToSlack: event.target.checked }))} /> {t('Enviar a Slack')}
        </label>
        <button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Comentar')}</button>
      </div>}
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {comments === null && !error && <p className="muted">{t('Cargando…')}</p>}
    {comments?.length === 0 && <p className="muted client-log-empty">{t('Aún no hay comentarios en la bitácora.')}</p>}
    <ol className="client-log-list">{visible.map((comment) => {
      const kind = COMMENT_KINDS.find(([key]) => key === comment.kind) || COMMENT_KINDS[0]
      const canEdit = comment.author_id === profile?.id || isAdmin
      const isEditing = editing?.id === comment.id
      return <li key={comment.id} className={`client-log-item ${comment.kind}`}>
        <div className="client-log-meta">
          <span className={`client-log-badge ${comment.kind}`}>{kind[1]} {t(kind[2])}</span>
          <strong>{comment.author?.full_name || t('Equipo')}</strong>
          <small>{formatWhen(comment.created_at)}{comment.edited_at ? ` · ${t('editado')}` : ''}</small>
          {comment.slack_sent_at
            ? <span className="client-log-slack-state sent" title={t('Publicado en el canal de Slack del cliente')}>{t('En Slack')}</span>
            : (comment.kind === 'blocked' || comment.send_to_slack) && <span className="client-log-slack-state" title={t('Se publicará en Slack cuando la app tenga el permiso chat:write')}>{t('Pendiente para Slack')}</span>}
          {canEdit && !isEditing && <span className="client-log-actions">
            <button type="button" className="text-button" onClick={() => setEditing({ id: comment.id, kind: comment.kind, body: comment.body })}>{t('Editar')}</button>
            <button type="button" className="text-button danger" onClick={() => remove(comment)}>{t('Eliminar')}</button>
          </span>}
        </div>
        {isEditing
          ? <div className="client-log-edit">
            <textarea rows="3" value={editing.body} maxLength={4000} onChange={(event) => setEditing((current) => ({ ...current, body: event.target.value }))} />
            <div className="client-log-form-actions"><KindPicker value={editing.kind} onChange={(value) => setEditing((current) => ({ ...current, kind: value }))} />
              <span><button type="button" className="primary-button compact-button" disabled={saving} onClick={saveEdit}>{t('Guardar')}</button> <button type="button" className="secondary-button compact-button" onClick={() => setEditing(null)}>{t('Cancelar')}</button></span></div>
          </div>
          : <LinkifiedText text={comment.body} className="client-log-body" />}
      </li>
    })}</ol>
    {limit && comments && comments.length > limit && <button type="button" className="text-button" onClick={() => setShowAll((value) => !value)}>
      {showAll ? t('Ver menos') : `${t('Ver todos los comentarios')} (${comments.length})`}</button>}
  </div>
}
