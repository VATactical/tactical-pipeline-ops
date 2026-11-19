import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { createBoardClient, loadLifecycleBoard, moveClientOnBoard, saveBoardStage } from '../services/opsService'

// Client lifecycle board (replaces the Trello board "Facebook Onboarding and Launch").
// Drag a card to another column or reorder it; columns linked to a status (Lead Tracking ->
// ADS LIVE, Cruise Control -> CRUISE CONTROL) update the client status on the server.

const STATUS_CLASS = {
  ONBOARDING: 'onboarding',
  'A2P SUBMITTED': 'a2p',
  'ADS LIVE': 'live',
  'ADS PAUSED': 'paused',
  'CRUISE CONTROL': 'cruise',
}
const COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple']
const POLL_MS = 30000

const byPosition = (a, b) => a.board_position - b.board_position || a.code.localeCompare(b.code, undefined, { numeric: true })
const daysSince = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0

// Position between the neighbours at `index` (cards already exclude the one being moved).
function positionAt(cards, index) {
  const prev = cards[index - 1]?.board_position
  const next = cards[index]?.board_position
  if (prev == null && next == null) return 1
  if (prev == null) return next - 1
  if (next == null) return prev + 1
  return (prev + next) / 2
}

function CardMenu({ client, stages, stageLabel, onMove, onClose }) {
  const { t } = useLanguage()
  return <div className="board-card-menu" role="menu" onClick={(event) => event.stopPropagation()}>
    <p>{t('Mover a')}</p>
    {stages.map((stage) => <button type="button" role="menuitem" key={stage.key} disabled={stage.key === client.board_stage} onClick={() => { onMove(stage.key); onClose() }}>{stageLabel(stage)}</button>)}
  </div>
}

function NewCardForm({ stage, onCreate, onCancel }) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event?.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onCreate({ businessName: name.trim(), code: code.trim(), stage: stage.key })
    setBusy(false)
    if (ok) { setName(''); setCode('') }
  }
  return <form className="board-new-card" onSubmit={submit}>
    <textarea autoFocus rows="2" value={name} maxLength={160} placeholder={t('Nombre del negocio')} onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } if (event.key === 'Escape') onCancel() }} />
    <input value={code} maxLength={20} placeholder={t('Código (automático)')} onChange={(event) => setCode(event.target.value.toUpperCase())} />
    <div><button className="primary-button compact-button" disabled={busy || !name.trim()}>{busy ? t('Creando…') : t('Agregar cliente')}</button><button type="button" className="board-icon-button" onClick={onCancel} aria-label={t('Cancelar')}>×</button></div>
  </form>
}

function StageEditor({ stage, onSave, onCancel, onArchive, canArchive }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(stage)
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  return <form className="board-stage-editor" onSubmit={(event) => { event.preventDefault(); if (draft.name.trim()) onSave(draft) }}>
    <label>{t('Nombre')}<input autoFocus value={draft.name} maxLength={80} onChange={(event) => set('name', event.target.value)} required /></label>
    <label>{t('Nombre en inglés')}<input value={draft.name_en || ''} maxLength={120} onChange={(event) => set('name_en', event.target.value)} /></label>
    <label>{t('Responsable')}<input value={draft.owner_hint || ''} maxLength={80} onChange={(event) => set('owner_hint', event.target.value)} placeholder="CSM, Editor…" /></label>
    <div className="board-color-picker" role="radiogroup" aria-label={t('Color')}>{COLORS.map((color) => <button type="button" key={color} role="radio" aria-checked={draft.color === color} className={`board-color ${color} ${draft.color === color ? 'selected' : ''}`} onClick={() => set('color', color)} aria-label={color} />)}</div>
    {stage.sets_status && <small className="muted">{t('Al mover un cliente aquí su estado pasa a')} <strong data-no-translate>{stage.sets_status}</strong>.</small>}
    <div className="board-stage-editor-actions">
      <button className="primary-button compact-button">{t('Guardar')}</button>
      <button type="button" className="secondary-button compact-button" onClick={onCancel}>{t('Cancelar')}</button>
      {!stage.isNew && !stage.sets_status && <button type="button" className="text-button danger" disabled={!canArchive} title={canArchive ? '' : t('Mueve primero los clientes de esta lista.')} onClick={onArchive}>{t('Archivar lista')}</button>}
    </div>
  </form>
}

export default function LifecycleBoardPage() {
  const { profile } = useAuth()
  const { t, language } = useLanguage()
  const navigate = useNavigate()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [menuFor, setMenuFor] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [editingStage, setEditingStage] = useState(null)
  const draggingRef = useRef(null)
  const listRefs = useRef({})

  const isAdmin = profile?.role === 'superadmin' || Boolean(profile?.permissions?.operations_admin)
  const canMove = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_edit)
  const canCreate = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_create)
  const stageLabel = useCallback((stage) => (language === 'en' && stage.name_en ? stage.name_en : stage.name), [language])

  const refresh = useCallback(async () => {
    try { setBoard(await loadLifecycleBoard()); setError('') }
    catch (loadError) { setError(t(loadError.message)) }
  }, [t])
  useEffect(() => { refresh() }, [refresh])
  // Keep the board fresh for everyone without realtime: poll while visible, refetch on focus.
  useEffect(() => {
    const tick = () => { if (!document.hidden && !draggingRef.current) refresh() }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [refresh])
  useEffect(() => {
    if (!menuFor) return undefined
    const close = () => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  const query = search.trim().toLowerCase()
  const columns = useMemo(() => {
    if (!board) return []
    const visible = board.clients.filter((client) => !query
      || `${client.code} ${client.business_name} ${client.owner_name || ''}`.toLowerCase().includes(query))
    return board.stages.map((stage) => ({ stage, cards: visible.filter((client) => client.board_stage === stage.key).sort(byPosition) }))
  }, [board, query])

  const moveCard = async (clientId, stageKey, index) => {
    const client = board.clients.find((item) => item.id === clientId)
    if (!client) return
    const targetCards = board.clients.filter((item) => item.board_stage === stageKey && item.id !== clientId).sort(byPosition)
    const safeIndex = index == null ? targetCards.length : Math.min(index, targetCards.length)
    const position = positionAt(targetCards, safeIndex)
    if (client.board_stage === stageKey && client.board_position === position) return
    const previous = board
    setBoard((current) => ({ ...current, clients: current.clients.map((item) => item.id === clientId ? { ...item, board_stage: stageKey, board_position: position } : item) }))
    setError(''); setNotice('')
    try {
      const saved = await moveClientOnBoard(clientId, stageKey, position)
      setBoard((current) => ({ ...current, clients: current.clients.map((item) => item.id === clientId ? { ...item, ...saved, progress: item.progress } : item) }))
      if (saved.status !== client.status) setNotice(`${client.code}: ${t('estado actualizado a')} ${saved.status}.`)
    } catch (moveError) {
      setBoard(previous)
      setError(t(moveError.message))
    }
  }

  const createCard = async ({ businessName, code, stage }) => {
    setError(''); setNotice('')
    try {
      const created = await createBoardClient({ businessName, code, stage })
      setBoard((current) => ({ ...current, clients: [...current.clients, { ...created, progress: { done: 0, total: 0 } }] }))
      setNotice(`${created.code} · ${created.business_name} ${t('creado.')}`)
      refresh()
      return true
    } catch (createError) {
      setError(t(createError.message))
      return false
    }
  }

  const saveStage = async (draft) => {
    setError('')
    try { await saveBoardStage(draft); setEditingStage(null); await refresh() }
    catch (saveError) { setError(t(saveError.message)) }
  }
  const shiftStage = async (stage, direction) => {
    const ordered = board.stages
    const index = ordered.findIndex((item) => item.key === stage.key)
    const other = ordered[index + direction]
    if (!other) return
    setError('')
    try {
      await saveBoardStage({ ...stage, sort_order: other.sort_order })
      await saveBoardStage({ ...other, sort_order: stage.sort_order })
      await refresh()
    } catch (saveError) { setError(t(saveError.message)) }
  }
  const newStage = () => {
    const maxOrder = Math.max(0, ...board.stages.map((stage) => stage.sort_order))
    setEditingStage({ isNew: true, key: `stage_${Date.now().toString(36)}`, name: '', name_en: '', owner_hint: '', color: 'slate', sort_order: maxOrder + 10 })
  }

  // Native drag & drop (mouse). Touch devices use the "Mover a" menu on each card.
  const onDragStart = (event, client) => {
    if (!canMove) return
    draggingRef.current = client.id
    setDragging(client.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', client.id)
  }
  const onDragEnd = () => { draggingRef.current = null; setDragging(null); setDropTarget(null) }
  const onDragOver = (event, stageKey) => {
    if (!draggingRef.current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const list = listRefs.current[stageKey]
    const cards = list ? [...list.querySelectorAll('[data-card-id]')].filter((node) => node.dataset.cardId !== draggingRef.current) : []
    let index = cards.length
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) { index = i; break }
    }
    setDropTarget((current) => current?.stage === stageKey && current.index === index ? current : { stage: stageKey, index })
  }
  const onDrop = (event, stageKey) => {
    event.preventDefault()
    const clientId = draggingRef.current || event.dataTransfer.getData('text/plain')
    const index = dropTarget?.stage === stageKey ? dropTarget.index : null
    onDragEnd()
    if (!clientId) return
    // The drop index counts visible cards; map it to the full column when a search filter is on.
    const column = columns.find((item) => item.stage.key === stageKey)
    const visible = column ? column.cards.filter((card) => card.id !== clientId) : []
    const anchor = index == null ? null : visible[index]
    const full = board.clients.filter((item) => item.board_stage === stageKey && item.id !== clientId).sort(byPosition)
    const fullIndex = anchor ? full.findIndex((item) => item.id === anchor.id) : full.length
    moveCard(clientId, stageKey, fullIndex)
  }

  if (!board && !error) return <LoadingScreen />
  const total = board?.clients.length || 0

  return <div className="page-stack lifecycle-board-page">
    <header className="page-header"><div><p className="eyebrow">{t('Operación')}</p><h2>{t('Ciclo de vida del cliente')}</h2><p className="muted">{t('Arrastra cada cliente a la etapa en la que está. Las columnas de lanzamiento actualizan el estado del cliente.')}</p></div>
      <div className="header-actions"><span className="status-pill">{total} {t('clientes activos')}</span><label className="board-search"><span className="sr-only">{t('Buscar')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar cliente o código…')} /></label></div>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {board && <div className="lifecycle-board" role="list" aria-label={t('Etapas del ciclo de vida')}>
      {columns.map(({ stage, cards }, columnIndex) => {
        const isTarget = dropTarget?.stage === stage.key
        const allCount = board.clients.filter((client) => client.board_stage === stage.key).length
        return <section className={`board-column ${stage.color} ${isTarget ? 'drop-active' : ''}`} key={stage.key} role="listitem" aria-label={stageLabel(stage)}
          onDragOver={(event) => onDragOver(event, stage.key)} onDrop={(event) => onDrop(event, stage.key)}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current?.stage === stage.key ? null : current) }}>
          {editingStage?.key === stage.key
            ? <StageEditor stage={editingStage} onSave={saveStage} onCancel={() => setEditingStage(null)} canArchive={allCount === 0} onArchive={() => saveStage({ ...stage, archived: true })} />
            : <header className="board-column-header">
              <div><h3>{stageLabel(stage)}</h3>{stage.owner_hint && <small>{t(stage.owner_hint)}</small>}{stage.sets_status && <small className="board-status-link" data-no-translate>→ {stage.sets_status}</small>}</div>
              <span className="board-count">{query ? `${cards.length}/${allCount}` : allCount}</span>
              {isAdmin && <div className="board-column-tools">
                <button type="button" className="board-icon-button" disabled={columnIndex === 0} onClick={() => shiftStage(stage, -1)} aria-label={t('Mover lista a la izquierda')}>‹</button>
                <button type="button" className="board-icon-button" disabled={columnIndex === columns.length - 1} onClick={() => shiftStage(stage, 1)} aria-label={t('Mover lista a la derecha')}>›</button>
                <button type="button" className="board-icon-button" onClick={() => setEditingStage({ ...stage })} aria-label={t('Editar lista')}>✎</button>
              </div>}
            </header>}
          <div className="board-card-list" ref={(node) => { listRefs.current[stage.key] = node }}>
            {cards.map((client) => {
              const index = cards.filter((card) => card.id !== dragging).indexOf(client)
              const progress = client.progress
              const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
              const days = daysSince(client.board_stage_changed_at)
              return <div key={client.id} style={{ display: 'contents' }}>
                {isTarget && index >= 0 && dropTarget.index === index && <div className="board-drop-placeholder" />}
                <article className={`board-card ${dragging === client.id ? 'dragging' : ''}`} data-card-id={client.id} draggable={canMove}
                  onDragStart={(event) => onDragStart(event, client)} onDragEnd={onDragEnd}
                  onClick={() => navigate(`/clientes/${client.id}?tab=dossier`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/clientes/${client.id}?tab=dossier`) }}
                  tabIndex={0} role="link" aria-label={`${client.code} ${client.business_name}`}>
                  <div className="board-card-top"><span className="board-code" data-no-translate>{client.code}</span><span className={`board-status ${STATUS_CLASS[client.status] || ''}`} data-no-translate>{client.status}</span>
                    {canMove && <button type="button" className="board-icon-button board-card-more" aria-label={t('Mover a')} aria-haspopup="menu" aria-expanded={menuFor === client.id} onClick={(event) => { event.stopPropagation(); setMenuFor((current) => current === client.id ? null : client.id) }}>⋯</button>}
                  </div>
                  <strong className="board-card-name" data-no-translate>{client.business_name}</strong>
                  {client.status === 'ADS PAUSED' && client.ads_pause_reason && <small className="board-paused" data-no-translate>⏸ {client.ads_pause_reason}</small>}
                  {progress.total > 0 && <div className="board-progress" title={`${t('Checklist')}: ${progress.done}/${progress.total}`}><span style={{ width: `${percent}%` }} /></div>}
                  <div className="board-card-meta">
                    {progress.total > 0 && <span title={t('Checklist')}>☑ {progress.done}/{progress.total}</span>}
                    <span title={t('Días en esta etapa')}>⏱ {days} {t(days === 1 ? 'día' : 'días')}</span>
                    {Number(client.daily_budget) > 0 && <span title={t('Presupuesto diario')}>${Number(client.daily_budget)}/{t('día')}</span>}
                  </div>
                  {menuFor === client.id && <CardMenu client={client} stages={board.stages} stageLabel={stageLabel} onMove={(stageKey) => moveCard(client.id, stageKey, null)} onClose={() => setMenuFor(null)} />}
                </article>
              </div>
            })}
            {isTarget && dropTarget.index >= cards.filter((card) => card.id !== dragging).length && <div className="board-drop-placeholder" />}
            {!cards.length && !isTarget && <p className="board-empty">{t(query ? 'Sin coincidencias' : 'Sin clientes')}</p>}
          </div>
          {canCreate && !stage.sets_status && (addingTo === stage.key
            ? <NewCardForm stage={stage} onCreate={createCard} onCancel={() => setAddingTo(null)} />
            : <button type="button" className="board-add-card" onClick={() => setAddingTo(stage.key)}>+ {t('Agregar un cliente')}</button>)}
        </section>
      })}
      {isAdmin && (editingStage?.isNew
        ? <section className="board-column slate"><StageEditor stage={editingStage} onSave={saveStage} onCancel={() => setEditingStage(null)} canArchive={false} onArchive={() => {}} /></section>
        : <button type="button" className="board-add-column" onClick={newStage}>+ {t('Agregar otra lista')}</button>)}
    </div>}
  </div>
}
