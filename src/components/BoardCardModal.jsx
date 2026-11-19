import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import ClientLog from './ClientLog'
import ClientTickets from './ClientTickets'
import DossierSuggestions from './DossierSuggestions'
import { createClientNote, loadClient, updateWorkflowStep } from '../services/opsService'
import LinkifiedText from './LinkifiedText'

// Trello-style quick view of a client opened from the lifecycle board: summary, checklist,
// notes and recent activity without leaving the board.

const PHASES = [['prep', 'Venta y preparación'], ['call', 'Llamada de onboarding'], ['build', 'Montaje'], ['launch', 'QA y lanzamiento'], ['post', 'Post-lanzamiento']]
const STATUS_CLASS = { ONBOARDING: 'onboarding', 'A2P SUBMITTED': 'a2p', 'ADS LIVE': 'live', 'ADS PAUSED': 'paused', 'CRUISE CONTROL': 'cruise' }

const text = (value) => (value == null ? '' : String(value).trim())
const isPlaceholder = (value) => !text(value) || /^(pendiente|pending|n\/a|na|-|not provided)$/i.test(text(value))

function ModalTickets({ clientId }) {
  const { t } = useLanguage()
  return <section className="board-modal-section board-modal-tickets">
    <h3>🎫 {t('Tickets')}</h3>
    <ClientTickets clientId={clientId} />
  </section>
}

export default function BoardCardModal({ clientId, stages, stageLabel, canMove, onMove, onChanged, onClose }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [savingStep, setSavingStep] = useState(null)
  const [note, setNote] = useState({ title: '', body: '' })
  const [savingNote, setSavingNote] = useState(false)

  const reload = useCallback(async () => {
    try { setData(await loadClient(clientId)); setError('') }
    catch (loadError) { setError(t(loadError.message)) }
  }, [clientId, t])
  useEffect(() => { setData(null); reload() }, [reload])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [onClose])

  const client = data?.client
  const steps = data?.workflowSteps || []
  const done = steps.filter((step) => step.completed).length
  const currentPhase = PHASES.find(([phase]) => steps.some((step) => step.phase === phase && !step.completed))?.[0] || null
  const visibleSteps = showAll ? steps : steps.filter((step) => step.phase === currentPhase)
  const canEditAll = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin || profile?.permissions?.clients_edit)
  const canToggle = (step) => client && !client.archived && (canEditAll || step.owner_role === profile?.role)
  const stepTitle = (step) => (locale.startsWith('en') && step.title_en ? step.title_en : step.title)

  const summary = useMemo(() => {
    if (!client) return []
    return [
      ['Propietario', client.owner_name],
      ['Teléfono', client.contact_phone || client.phone],
      ['Correo', client.contact_email || client.email],
      ['Dirección', client.address],
      ['Presupuesto diario', Number(client.daily_budget) > 0 ? `$${Number(client.daily_budget)}` : ''],
      ['Deadline de lanzamiento', client.target_launch_date ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${client.target_launch_date}T12:00:00`)) : ''],
      ['Oferta', client.offer],
      ['Servicios', client.services],
      ['Siguiente acción', client.next_action],
    ].filter(([, value]) => !isPlaceholder(value))
  }, [client, locale])

  const links = client ? [
    ['Sitio web', client.website_url], ['Slack', client.slack_channel_link], ['Google Drive', client.drive_folder_link],
    ['Subcuenta GHL', client.ghl_subaccount_link], ['Landing page', client.landing_page_url],
  ].filter(([, url]) => /^https?:\/\//i.test(text(url))) : []

  const toggleStep = async (step) => {
    setSavingStep(step.id); setError('')
    try { await updateWorkflowStep(step.id, !step.completed); await reload(); onChanged?.() }
    catch (stepError) { setError(t(stepError.message)) }
    finally { setSavingStep(null) }
  }
  const addNote = async (event) => {
    event.preventDefault()
    if (!note.title.trim()) return
    setSavingNote(true); setError('')
    try { await createClientNote({ clientId, profileId: profile?.id, title: note.title, body: note.body }); setNote({ title: '', body: '' }); await reload() }
    catch (noteError) { setError(t(noteError.message)) }
    finally { setSavingNote(false) }
  }

  const formatWhen = (value) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))

  return <div className="board-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="board-modal" role="dialog" aria-modal="true" aria-label={client ? `${client.code} ${client.business_name}` : t('Cliente')}>
      <button type="button" className="board-modal-close" onClick={onClose} aria-label={t('Cerrar')}>×</button>
      {!client && !error && <p className="muted board-modal-loading">{t('Cargando…')}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {client && <>
        <header className="board-modal-header">
          <div className="board-card-top"><span className="board-code" data-no-translate>{client.code}</span><span className={`board-status ${STATUS_CLASS[client.status] || ''}`} data-no-translate>{client.status}</span>{client.phase && <span className="board-modal-phase">{t(client.phase)}</span>}</div>
          <h2 data-no-translate>{client.business_name}</h2>
          <label className="board-modal-stage">{t('En la lista')}
            <select value={client.board_stage} disabled={!canMove} onChange={async (event) => { await onMove(client.id, event.target.value); reload() }}>
              {stages.map((stage) => <option key={stage.key} value={stage.key}>{stageLabel(stage)}</option>)}
            </select>
          </label>
          {client.status === 'ADS PAUSED' && client.ads_pause_reason && <p className="board-paused" data-no-translate>⏸ {client.ads_pause_reason}</p>}
        </header>

        <div className="board-modal-body">
          <main>
            <DossierSuggestions clientId={client.id} compact className="board-modal-section" onApplied={() => { reload(); onChanged?.() }} />
            <ModalTickets clientId={client.id} />
            {summary.length > 0 && <section className="board-modal-section"><h3>{t('Resumen')}</h3>
              <dl className="board-modal-summary">{summary.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd data-no-translate>{text(value)}</dd></div>)}</dl>
            </section>}

            <section className="board-modal-section">
              <div className="board-modal-section-head"><h3>{t('Checklist')} <small>{done}/{steps.length}</small></h3>
                <button type="button" className="text-button" onClick={() => setShowAll((value) => !value)}>{showAll ? t('Ver solo la fase actual') : t('Ver checklist completo')}</button></div>
              {steps.length > 0 && <div className="board-progress big"><span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} /></div>}
              {!showAll && currentPhase && <p className="muted board-modal-phase-label">{t('Fase actual')}: {t(PHASES.find(([key]) => key === currentPhase)?.[1])}</p>}
              {!steps.length && <p className="muted">{t('No tienes pasos del checklist asignados en este cliente.')}</p>}
              {steps.length > 0 && !visibleSteps.length && <p className="muted">{t('Checklist completo')}</p>}
              <ul className="board-modal-steps">{visibleSteps.map((step) => <li key={step.id} className={step.completed ? 'completed' : ''}>
                <label><input type="checkbox" checked={step.completed} disabled={!canToggle(step) || savingStep === step.id} onChange={() => toggleStep(step)} />
                  <span>{stepTitle(step)}{step.evidence === 'required' && <em className="board-step-evidence" title={t('Este paso se confirma con una captura (súbela desde la ficha del cliente).')}> 📷</em>}<small>{t(step.owner_name)}</small></span></label>
              </li>)}</ul>
            </section>

            <section className="board-modal-section">
              <h3>{t('Bitácora')}</h3>
              <ClientLog clientId={client.id} limit={8} compact onChanged={() => { reload(); onChanged?.() }} />
            </section>

            <section className="board-modal-section">
              <h3>{t('Notas')}</h3>
              <form className="board-modal-note" onSubmit={addNote}>
                <input value={note.title} maxLength={160} placeholder={t('Título de la nota')} onChange={(event) => setNote((current) => ({ ...current, title: event.target.value }))} />
                {note.title && <textarea rows="3" value={note.body} placeholder={t('Escribe el detalle…')} onChange={(event) => setNote((current) => ({ ...current, body: event.target.value }))} />}
                {note.title && <button className="primary-button compact-button" disabled={savingNote}>{savingNote ? t('Guardando…') : t('Guardar nota')}</button>}
              </form>
              <ul className="board-modal-notes">{data.notes.slice(0, 6).map((item) => <li key={item.id}>
                <div><strong data-no-translate>{item.title}</strong><small>{item.author?.full_name || t('Equipo')} · {formatWhen(item.created_at)}</small></div>
                {item.body && <LinkifiedText text={item.body} className="formatted-text" />}
              </li>)}</ul>
              {data.notes.length > 6 && <Link className="text-button" to={`/clientes/${client.id}?tab=notes`}>{t('Ver todas las notas')} ({data.notes.length})</Link>}
            </section>
          </main>

          <aside>
            <Link className="primary-button compact-button board-modal-open" to={`/clientes/${client.id}?tab=dossier`}>{t('Abrir cliente completo')}</Link>
            {links.length > 0 && <div className="board-modal-links"><h4>{t('Enlaces')}</h4>{links.map(([label, url]) => <a key={label} href={url} target="_blank" rel="noreferrer">{t(label)} ↗</a>)}</div>}
            <div className="board-modal-activity"><h4>{t('Actividad')}</h4>
              {data.auditLog.slice(0, 8).map((entry) => <p key={entry.id}><strong>{entry.actor_name}</strong> <span>{t(entry.summary)}</span><small>{formatWhen(entry.created_at)}</small></p>)}
              {!data.auditLog.length && <p className="muted">{t('Sin actividad registrada.')}</p>}
            </div>
          </aside>
        </div>
      </>}
    </div>
  </div>
}
