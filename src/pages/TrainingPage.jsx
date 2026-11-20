import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LinkifiedText, { linkLabel } from '../components/LinkifiedText'
import LoadingScreen from '../components/LoadingScreen'
import TeamSubnav from '../components/TeamSubnav'
import { usePageTrail } from '../components/navigation'
import { useLanguage } from '../i18n/LanguageContext'
import {
  createTrainingItem, createTrainingModule, deleteTrainingItem, deleteTrainingModule,
  loadTraining, setTrainingItemCompleted, updateTrainingItem, updateTrainingModule,
} from '../services/trainingService'

const roleLabels = {
  onboarding_media: { es: 'Onboarding y medios', en: 'Onboarding & Media' },
  automation_funnels: { es: 'Automatizaciones y funnels', en: 'Automations & Funnels' },
  user_admin: { es: 'Administrador de usuarios', en: 'User Admin' },
}
const blankModule = { titleEs: '', titleEn: '', descriptionEs: '', descriptionEn: '', driveUrl: '', audienceRole: '', sortOrder: 1 }
const blankItem = { titleEs: '', titleEn: '', descriptionEs: '', descriptionEn: '', driveUrl: '', resourceType: 'Lección' }
const resourceTypes = ['Lección', 'Documento', 'Video', 'Carpeta']
const TYPE_ICONS = { Lección: '📘', Documento: '📄', Video: '🎥', Carpeta: '📁' }

export default function TrainingPage() {
  usePageTrail([{ label: 'Training' }])
  const { profile } = useAuth()
  const { language, t } = useLanguage()
  const isAdmin = profile.role === 'superadmin' || Boolean(profile.permissions?.operations_admin)
  const [data, setData] = useState({ modules: [], items: [], progress: [] })
  const [openModules, setOpenModules] = useState(() => new Set())
  const [editMode, setEditMode] = useState(false)
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('all')
  const [newModule, setNewModule] = useState(blankModule)
  const [newItems, setNewItems] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const localize = useCallback((record, field) => {
    const preferred = record?.[`${field}_${language}`]
    const alternate = record?.[`${field}_${language === 'en' ? 'es' : 'en'}`]
    return preferred || alternate || record?.[field] || ''
  }, [language])
  const roleLabel = (role) => roleLabels[role]?.[language] || role || t('Todos los usuarios')

  const refresh = useCallback(async () => {
    const next = await loadTraining(profile)
    setData(next)
    setNewModule((current) => current.titleEs || current.titleEn
      ? current
      : { ...current, sortOrder: Math.max(0, ...next.modules.map((item) => item.sort_order)) + 1 })
  }, [profile])

  useEffect(() => {
    refresh().catch((e) => setError(t(e.message))).finally(() => setLoading(false))
  }, [refresh, t])

  const completed = useMemo(() => new Set(data.progress.map((item) => item.item_id)), [data.progress])
  const toggleModule = (id) => setOpenModules((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const visibleModules = data.modules.filter((module) => !module.audience_role || module.audience_role === profile.role || isAdmin)
  const visibleItems = data.items.filter((item) => visibleModules.some((module) => module.id === item.module_id))
  const completedCount = visibleItems.filter((item) => completed.has(item.id)).length
  const completion = visibleItems.length ? Math.round((completedCount / visibleItems.length) * 100) : 0
  // Open the first module that still has pending lessons.
  const firstPending = visibleModules.find((module) => data.items.some((item) => item.module_id === module.id && !completed.has(item.id)))?.id
  useEffect(() => {
    if (!loading && firstPending) setOpenModules((current) => current.size ? current : new Set([firstPending]))
  }, [loading, firstPending])
  const updateLocal = (type, id, key, value) => setData((current) => ({
    ...current,
    [type]: current[type].map((item) => item.id === id ? { ...item, [key]: value } : item),
  }))
  const runAction = async (key, action, success) => {
    setSaving(key); setError(''); setMessage('')
    try {
      await action(); await refresh(); setMessage(t(success)); return true
    } catch (e) {
      setError(t(e.message)); return false
    } finally {
      setSaving(null)
    }
  }

  const toggleItem = async (item) => {
    const next = !completed.has(item.id)
    setSaving(item.id); setError('')
    try {
      await setTrainingItemCompleted(profile.id, item.id, next)
      setData((current) => ({
        ...current,
        progress: next
          ? [...current.progress.filter((row) => row.item_id !== item.id), { user_id: profile.id, item_id: item.id }]
          : current.progress.filter((row) => row.item_id !== item.id),
      }))
    } catch (e) {
      setError(t(e.message))
    } finally {
      setSaving(null)
    }
  }

  const addModule = (event) => {
    event.preventDefault()
    runAction('new-module', () => createTrainingModule(newModule), 'Módulo creado.')
      .then((saved) => saved && setNewModule({ ...blankModule, sortOrder: Math.max(0, ...data.modules.map((item) => item.sort_order)) + 2 }))
  }
  const addItem = (module) => {
    const item = newItems[module.id] || blankItem
    const nextOrder = Math.max(0, ...data.items.filter((row) => row.module_id === module.id).map((row) => row.sort_order)) + 1
    runAction(`new-item-${module.id}`, () => createTrainingItem(module.id, item, nextOrder), 'Lección agregada.')
      .then((saved) => saved && setNewItems((current) => ({ ...current, [module.id]: blankItem })))
  }

  if (loading) return <LoadingScreen />
  const term = search.trim().toLowerCase()
  const matches = (item) => (show === 'all' || (show === 'pending' ? !completed.has(item.id) : completed.has(item.id)))
    && (!term || `${localize(item, 'title')} ${localize(item, 'description')}`.toLowerCase().includes(term))
  const editing = isAdmin && editMode
  const shownModules = visibleModules.filter((module) => editing || !term && show === 'all'
    || data.items.some((item) => item.module_id === module.id && matches(item))
    || (term && localize(module, 'title').toLowerCase().includes(term)))
  const allOpen = shownModules.length > 0 && shownModules.every((module) => openModules.has(module.id))
  const filtering = Boolean(term) || show !== 'all'

  return <div className="page-stack">
    <TeamSubnav />
    <header className="page-header">
      <div>
        <p className="eyebrow">Training Hub</p>
        <h2>{t('Formación del equipo')}</h2>
        <p className="muted">{t('Abre cada lección, revísala y márcala cuando la tengas clara.')}</p>
      </div>
      <span className="status-pill">{completion}% {t('completado')}</span>
    </header>

    {error && <p className="form-error">{error}</p>}
    {message && <p className="form-success">{message}</p>}

    <section className="content-card training-summary">
      <div><span>{t('Tu progreso')}</span><strong>{completedCount} {t('de')} {visibleItems.length} {t('lecciones')}</strong></div>
      <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
    </section>

    <div className="training-toolbar">
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar lección')} />
      <select value={show} onChange={(event) => setShow(event.target.value)}>
        <option value="all">{t('Todas las lecciones')}</option><option value="pending">{t('Pendientes')}</option><option value="done">{t('Completadas')}</option>
      </select>
      <button className="secondary-button compact-button" type="button" onClick={() => setOpenModules(allOpen ? new Set() : new Set(shownModules.map((module) => module.id)))}>{allOpen ? t('Contraer todo') : t('Expandir todo')}</button>
      {isAdmin && <button className={`${editMode ? 'primary-button' : 'secondary-button'} compact-button training-edit-toggle`} type="button" onClick={() => setEditMode((value) => !value)}>{editMode ? t('Terminar edición') : t('Editar contenido')}</button>}
    </div>

    {editing && <form className="content-card training-create-form" onSubmit={addModule}>
      <div className="section-heading"><div><p className="eyebrow">{t('Administración')}</p><h3>{t('Crear módulo')}</h3></div></div>
      <div className="admin-training-grid">
        <label>{t('Título (ES)')}<input value={newModule.titleEs} onChange={(e) => setNewModule((current) => ({ ...current, titleEs: e.target.value }))} required /></label>
        <label>{t('Title (EN)')}<input value={newModule.titleEn} onChange={(e) => setNewModule((current) => ({ ...current, titleEn: e.target.value }))} required /></label>
        <label>{t('Enlace de Drive')}<input type="url" value={newModule.driveUrl} onChange={(e) => setNewModule((current) => ({ ...current, driveUrl: e.target.value }))} /></label>
        <label>{t('Visible para')}<select value={newModule.audienceRole} onChange={(e) => setNewModule((current) => ({ ...current, audienceRole: e.target.value }))}><option value="">{t('Todos')}</option>{Object.keys(roleLabels).map((value) => <option value={value} key={value}>{roleLabel(value)}</option>)}</select></label>
        <label>{t('Orden')}<input type="number" min="0" value={newModule.sortOrder} onChange={(e) => setNewModule((current) => ({ ...current, sortOrder: e.target.value }))} /></label>
        <label className="wide">{t('Descripción (ES)')}<input value={newModule.descriptionEs} onChange={(e) => setNewModule((current) => ({ ...current, descriptionEs: e.target.value }))} /></label>
        <label className="wide">{t('Description (EN)')}<input value={newModule.descriptionEn} onChange={(e) => setNewModule((current) => ({ ...current, descriptionEn: e.target.value }))} /></label>
      </div>
      <button className="primary-button compact-button" disabled={saving === 'new-module'}>{t('Crear módulo')}</button>
    </form>}

    <section className="training-modules">{shownModules.map((module, position) => {
      const items = data.items.filter((item) => item.module_id === module.id)
      const listed = editing ? items : items.filter(matches)
      const done = items.filter((item) => completed.has(item.id)).length
      const percent = items.length ? Math.round((done / items.length) * 100) : 0
      const expanded = openModules.has(module.id) || (filtering && !editing)
      const itemDraft = newItems[module.id] || blankItem
      const moduleUrl = module.drive_url || ''
      return <article className={`content-card training-module ${percent === 100 && items.length ? 'module-done' : ''}`} key={module.id}>
        <div className="training-module-header" role="button" tabIndex={0} aria-expanded={expanded}
          onClick={() => toggleModule(module.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleModule(module.id) } }}>
          <span className="training-module-number">{percent === 100 && items.length ? '✓' : position + 1}</span>
          <div className="training-module-text">
            <p className="eyebrow">{module.audience_role ? roleLabel(module.audience_role) : t('Todos los usuarios')}</p>
            <h3 data-no-translate>{localize(module, 'title')}</h3>
            {localize(module, 'description') && <LinkifiedText className="muted" text={localize(module, 'description')} />}
            <div className="training-module-progress"><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><small>{done}/{items.length}</small></div>
          </div>
          <div className="training-module-side">
            {moduleUrl && <a className="secondary-button compact-button" href={moduleUrl} target="_blank" rel="noreferrer" title={moduleUrl} onClick={(event) => event.stopPropagation()}>{t(linkLabel(moduleUrl))} ↗</a>}
            <span className="training-chevron" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
          </div>
        </div>

        {expanded && <div className="training-expanded">
          {editing && <div className="training-admin-box">
            <div className="admin-training-grid">
              <label>{t('Título (ES)')}<input value={module.title_es ?? module.title ?? ''} onChange={(e) => updateLocal('modules', module.id, 'title_es', e.target.value)} /></label>
              <label>{t('Title (EN)')}<input value={module.title_en ?? module.title ?? ''} onChange={(e) => updateLocal('modules', module.id, 'title_en', e.target.value)} /></label>
              <label>{t('Enlace de Drive')}<input value={module.drive_url || ''} onChange={(e) => updateLocal('modules', module.id, 'drive_url', e.target.value)} /></label>
              <label>{t('Visible para')}<select value={module.audience_role || ''} onChange={(e) => updateLocal('modules', module.id, 'audience_role', e.target.value || null)}><option value="">{t('Todos')}</option>{Object.keys(roleLabels).map((value) => <option value={value} key={value}>{roleLabel(value)}</option>)}</select></label>
              <label>{t('Orden')}<input type="number" min="0" value={module.sort_order} onChange={(e) => updateLocal('modules', module.id, 'sort_order', e.target.value)} /></label>
              <label className="wide">{t('Descripción (ES)')}<input value={module.description_es ?? module.description ?? ''} onChange={(e) => updateLocal('modules', module.id, 'description_es', e.target.value)} /></label>
              <label className="wide">{t('Description (EN)')}<input value={module.description_en ?? module.description ?? ''} onChange={(e) => updateLocal('modules', module.id, 'description_en', e.target.value)} /></label>
            </div>
            <div className="section-actions">
              <button className="danger-button" type="button" onClick={() => window.confirm(t('¿Eliminar este módulo y sus lecciones?')) && runAction(`delete-module-${module.id}`, () => deleteTrainingModule(module.id), 'Módulo eliminado.')}>{t('Eliminar módulo')}</button>
              <button className="secondary-button" type="button" onClick={() => runAction(`module-${module.id}`, () => updateTrainingModule(module), 'Módulo actualizado.')}>{t('Guardar módulo')}</button>
            </div>
          </div>}

          <div className="training-lessons">{listed.map((item) => {
            const done = completed.has(item.id)
            const ownUrl = item.drive_url || ''
            const url = ownUrl || moduleUrl
            const title = localize(item, 'title')
            if (editing) return <div className="training-lesson editable" key={item.id}><div className="lesson-editor">
              <input value={item.title_es ?? item.title ?? ''} onChange={(e) => updateLocal('items', item.id, 'title_es', e.target.value)} placeholder={t('Título (ES)')} />
              <input value={item.title_en ?? item.title ?? ''} onChange={(e) => updateLocal('items', item.id, 'title_en', e.target.value)} placeholder={t('Title (EN)')} />
              <input value={item.drive_url || ''} onChange={(e) => updateLocal('items', item.id, 'drive_url', e.target.value)} placeholder={t('Enlace de Drive')} />
              <textarea rows="2" value={item.description_es ?? item.description ?? ''} onChange={(e) => updateLocal('items', item.id, 'description_es', e.target.value)} placeholder={t('Descripción (ES)')} />
              <textarea rows="2" value={item.description_en ?? item.description ?? ''} onChange={(e) => updateLocal('items', item.id, 'description_en', e.target.value)} placeholder={t('Description (EN)')} />
              <div className="lesson-actions">
                <select value={item.resource_type} onChange={(e) => updateLocal('items', item.id, 'resource_type', e.target.value)}>{resourceTypes.map((type) => <option value={type} key={type}>{t(type)}</option>)}</select>
                <input type="number" min="1" value={item.sort_order} onChange={(e) => updateLocal('items', item.id, 'sort_order', e.target.value)} />
                <button className="text-button danger-text" type="button" onClick={() => window.confirm(t('¿Eliminar esta lección?')) && runAction(`delete-item-${item.id}`, () => deleteTrainingItem(item.id), 'Lección eliminada.')}>{t('Eliminar')}</button>
                <button className="secondary-button" type="button" onClick={() => runAction(`item-${item.id}`, () => updateTrainingItem(item), 'Lección actualizada.')}>{t('Guardar')}</button>
              </div>
            </div></div>
            return <div className={`training-lesson ${done ? 'completed' : ''}`} key={item.id}>
              <input type="checkbox" checked={done} disabled={saving === item.id} onChange={() => toggleItem(item)} aria-label={t(done ? 'Marcar como pendiente' : 'Marcar como completada')} />
              <span className="training-type" title={t(item.resource_type || 'Lección')} aria-hidden="true">{TYPE_ICONS[item.resource_type] || '📘'}</span>
              <div className="training-lesson-text">
                {url ? <a className="training-lesson-title" href={url} target="_blank" rel="noreferrer" title={url} data-no-translate>{title}</a> : <strong className="training-lesson-title" data-no-translate>{title}</strong>}
                {localize(item, 'description') && <LinkifiedText as="small" text={localize(item, 'description')} />}
                {!ownUrl && moduleUrl && <small className="training-from-module">{t('En el material del módulo')}</small>}
              </div>
              {url ? <a className="secondary-button compact-button training-open" href={url} target="_blank" rel="noreferrer" title={url}>{t('Abrir')} ↗</a> : <span className="resource-pending">{t('Enlace pendiente')}</span>}
            </div>
          })}
          {!listed.length && <p className="training-empty">{t('No hay lecciones con estos filtros.')}</p>}</div>

          {editing && <div className="training-admin-box add-lesson">
            <p className="eyebrow">{t('Nueva lección')}</p>
            <div className="admin-training-grid">
              <label>{t('Título (ES)')}<input value={itemDraft.titleEs} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, titleEs: e.target.value } }))} /></label>
              <label>{t('Title (EN)')}<input value={itemDraft.titleEn} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, titleEn: e.target.value } }))} /></label>
              <label>{t('Enlace de Drive')}<input value={itemDraft.driveUrl} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, driveUrl: e.target.value } }))} /></label>
              <label>{t('Tipo')}<select value={itemDraft.resourceType} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, resourceType: e.target.value } }))}>{resourceTypes.map((type) => <option value={type} key={type}>{t(type)}</option>)}</select></label>
              <label className="wide">{t('Descripción (ES)')}<input value={itemDraft.descriptionEs} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, descriptionEs: e.target.value } }))} /></label>
              <label className="wide">{t('Description (EN)')}<input value={itemDraft.descriptionEn} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, descriptionEn: e.target.value } }))} /></label>
            </div>
            <button className="secondary-button" type="button" disabled={!itemDraft.titleEs.trim() || !itemDraft.titleEn.trim()} onClick={() => addItem(module)}>{t('Agregar lección')}</button>
          </div>}
        </div>}
      </article>
    })}
    {!shownModules.length && <p className="muted">{t('No hay lecciones con estos filtros.')}</p>}</section>
  </div>
}
