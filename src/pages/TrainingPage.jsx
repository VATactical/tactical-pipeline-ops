import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
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

export default function TrainingPage() {
  const { profile } = useAuth()
  const { language, t } = useLanguage()
  const isAdmin = profile.role === 'superadmin' || Boolean(profile.permissions?.operations_admin)
  const [data, setData] = useState({ modules: [], items: [], progress: [] })
  const [open, setOpen] = useState(null)
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
  const visibleModules = data.modules.filter((module) => !module.audience_role || module.audience_role === profile.role || isAdmin)
  const visibleItems = data.items.filter((item) => visibleModules.some((module) => module.id === item.module_id))
  const completedCount = visibleItems.filter((item) => completed.has(item.id)).length
  const completion = visibleItems.length ? Math.round((completedCount / visibleItems.length) * 100) : 0
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
  return <div className="page-stack">
    <header className="page-header">
      <div>
        <p className="eyebrow">Training Hub</p>
        <h2>{t('Formación del equipo')}</h2>
        <p className="muted">{t(isAdmin ? 'Administra los módulos, listas y enlaces del equipo.' : 'Revisa el hub semanalmente y marca cada lección cuando esté comprendida.')}</p>
      </div>
      <span className="status-pill">{isAdmin ? `${visibleModules.length} ${t('módulos')}` : `${completion}% ${t('completado')}`}</span>
    </header>

    {error && <p className="form-error">{error}</p>}
    {message && <p className="form-success">{message}</p>}

    {!isAdmin && <section className="content-card training-summary">
      <div><span>{t('Tu progreso')}</span><strong>{completedCount} {t('de')} {visibleItems.length} {t('lecciones')}</strong></div>
      <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
    </section>}

    {isAdmin && <form className="content-card training-create-form" onSubmit={addModule}>
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

    <section className="training-modules">{visibleModules.map((module) => {
      const items = data.items.filter((item) => item.module_id === module.id)
      const done = items.filter((item) => completed.has(item.id)).length
      const expanded = open === module.id
      const itemDraft = newItems[module.id] || blankItem
      return <article className="content-card training-module" key={module.id}>
        <button className="training-module-header" type="button" onClick={() => setOpen(expanded ? null : module.id)}>
          <div>
            <p className="eyebrow">{module.audience_role ? roleLabel(module.audience_role) : t('Todos los usuarios')}</p>
            <h3 data-no-translate>{localize(module, 'title')}</h3>
            <p className="muted" data-no-translate>{localize(module, 'description')}</p>
          </div>
          <span>{done}/{items.length} {expanded ? '▴' : '▾'}</span>
        </button>

        {expanded && <div className="training-expanded">
          {isAdmin && <div className="training-admin-box">
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

          <div className="training-lessons">{items.map((item) => <div className={`training-lesson ${completed.has(item.id) ? 'completed' : ''} ${isAdmin ? 'editable' : ''}`} key={item.id}>
            {isAdmin ? <div className="lesson-editor">
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
            </div> : <>
              <label><input type="checkbox" checked={completed.has(item.id)} disabled={saving === item.id} onChange={() => toggleItem(item)} /><span><strong data-no-translate>{localize(item, 'title')}</strong>{localize(item, 'description') && <small data-no-translate>{localize(item, 'description')}</small>}</span></label>
              {item.drive_url ? <a className="secondary-button" href={item.drive_url} target="_blank" rel="noreferrer">{t('Abrir en Drive ↗')}</a> : <span className="resource-pending">{t('Enlace pendiente')}</span>}
            </>}
          </div>)}</div>

          {isAdmin && <div className="training-admin-box add-lesson">
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

          {!isAdmin && module.drive_url && <a className="module-drive-link" href={module.drive_url} target="_blank" rel="noreferrer">{t('Abrir recursos del módulo en Drive ↗')}</a>}
        </div>}
      </article>
    })}</section>
  </div>
}
