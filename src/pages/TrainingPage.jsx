import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { useLanguage } from '../i18n/LanguageContext'
import {
  createTrainingItem, createTrainingModule, deleteTrainingItem, deleteTrainingModule,
  loadTraining, setTrainingItemCompleted, updateTrainingItem, updateTrainingModule,
} from '../services/trainingService'

const roleLabels = { onboarding_media: 'Onboarding & Media', automation_funnels: 'Automations & Funnels', user_admin: 'User Admin' }
const blankModule = { title: '', description: '', driveUrl: '', audienceRole: '', sortOrder: 1 }
const blankItem = { title: '', description: '', driveUrl: '', resourceType: 'Lección' }

export default function TrainingPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const isAdmin = profile.role === 'superadmin' || Boolean(profile.permissions?.operations_admin)
  const [data, setData] = useState({ modules: [], items: [], progress: [] })
  const [open, setOpen] = useState(null)
  const [newModule, setNewModule] = useState(blankModule)
  const [newItems, setNewItems] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const next = await loadTraining(profile)
    setData(next)
    setNewModule((current) => current.title ? current : { ...current, sortOrder: Math.max(0, ...next.modules.map((item) => item.sort_order)) + 1 })
  }, [profile])
  useEffect(() => { refresh().catch((e) => setError(e.message)).finally(() => setLoading(false)) }, [refresh])
  const completed = useMemo(() => new Set(data.progress.map((item) => item.item_id)), [data.progress])
  const visibleModules = data.modules.filter((module) => !module.audience_role || module.audience_role === profile.role || isAdmin)
  const visibleItems = data.items.filter((item) => visibleModules.some((module) => module.id === item.module_id))
  const completion = visibleItems.length ? Math.round((visibleItems.filter((item) => completed.has(item.id)).length / visibleItems.length) * 100) : 0
  const updateLocal = (type, id, key, value) => setData((current) => ({ ...current, [type]: current[type].map((item) => item.id === id ? { ...item, [key]: value } : item) }))
  const runAction = async (key, action, success) => { setSaving(key); setError(''); setMessage(''); try { await action(); await refresh(); setMessage(t(success)); return true } catch (e) { setError(t(e.message)); return false } finally { setSaving(null) } }

  const toggleItem = async (item) => {
    const next = !completed.has(item.id)
    setSaving(item.id); setError('')
    try {
      await setTrainingItemCompleted(profile.id, item.id, next)
      setData((current) => ({ ...current, progress: next ? [...current.progress.filter((row) => row.item_id !== item.id), { user_id: profile.id, item_id: item.id }] : current.progress.filter((row) => row.item_id !== item.id) }))
    } catch (e) { setError(e.message) } finally { setSaving(null) }
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
    <header className="page-header"><div><p className="eyebrow">Training Hub</p><h2>Formación del equipo</h2><p className="muted">{isAdmin ? 'Administra los módulos, listas y enlaces del equipo.' : 'Revisa el hub semanalmente y marca cada lección cuando esté comprendida.'}</p></div><span className="status-pill">{isAdmin ? `${visibleModules.length} módulos` : `${completion}% completado`}</span></header>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {!isAdmin && <section className="content-card training-summary"><div><span>Tu progreso</span><strong>{visibleItems.filter((item) => completed.has(item.id)).length} de {visibleItems.length} lecciones</strong></div><div className="progress-track"><span style={{ width: `${completion}%` }} /></div></section>}
    {isAdmin && <form className="content-card training-create-form" onSubmit={addModule}><div className="section-heading"><div><p className="eyebrow">Administración</p><h3>Crear módulo</h3></div></div><div className="admin-training-grid"><label>Título<input value={newModule.title} onChange={(e) => setNewModule((current) => ({ ...current, title: e.target.value }))} required /></label><label>Enlace de Drive<input type="url" value={newModule.driveUrl} onChange={(e) => setNewModule((current) => ({ ...current, driveUrl: e.target.value }))} /></label><label>Visible para<select value={newModule.audienceRole} onChange={(e) => setNewModule((current) => ({ ...current, audienceRole: e.target.value }))}><option value="">Todos</option>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Orden<input type="number" min="0" value={newModule.sortOrder} onChange={(e) => setNewModule((current) => ({ ...current, sortOrder: e.target.value }))} /></label><label className="wide">Descripción<input value={newModule.description} onChange={(e) => setNewModule((current) => ({ ...current, description: e.target.value }))} /></label></div><button className="primary-button compact-button" disabled={saving === 'new-module'}>Crear módulo</button></form>}
    <section className="training-modules">{visibleModules.map((module) => {
      const items = data.items.filter((item) => item.module_id === module.id)
      const done = items.filter((item) => completed.has(item.id)).length
      const expanded = open === module.id
      const itemDraft = newItems[module.id] || blankItem
      return <article className="content-card training-module" key={module.id}>
        <button className="training-module-header" type="button" onClick={() => setOpen(expanded ? null : module.id)}><div><p className="eyebrow">{module.audience_role ? roleLabels[module.audience_role] : 'Todos los usuarios'}</p><h3 data-no-translate>{module.title}</h3><p className="muted" data-no-translate>{module.description}</p></div><span>{done}/{items.length} {expanded ? '▴' : '▾'}</span></button>
        {expanded && <div className="training-expanded">
          {isAdmin && <div className="training-admin-box"><div className="admin-training-grid"><label>Título<input value={module.title} onChange={(e) => updateLocal('modules', module.id, 'title', e.target.value)} /></label><label>Enlace de Drive<input value={module.drive_url} onChange={(e) => updateLocal('modules', module.id, 'drive_url', e.target.value)} /></label><label>Visible para<select value={module.audience_role || ''} onChange={(e) => updateLocal('modules', module.id, 'audience_role', e.target.value || null)}><option value="">Todos</option>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Orden<input type="number" min="0" value={module.sort_order} onChange={(e) => updateLocal('modules', module.id, 'sort_order', e.target.value)} /></label><label className="wide">Descripción<input value={module.description} onChange={(e) => updateLocal('modules', module.id, 'description', e.target.value)} /></label></div><div className="section-actions"><button className="danger-button" type="button" onClick={() => window.confirm(t('¿Eliminar este módulo y sus lecciones?')) && runAction(`delete-module-${module.id}`, () => deleteTrainingModule(module.id), 'Módulo eliminado.')}>Eliminar módulo</button><button className="secondary-button" type="button" onClick={() => runAction(`module-${module.id}`, () => updateTrainingModule(module), 'Módulo actualizado.')}>Guardar módulo</button></div></div>}
          <div className="training-lessons">{items.map((item) => <div className={`training-lesson ${completed.has(item.id) ? 'completed' : ''} ${isAdmin ? 'editable' : ''}`} key={item.id}>{isAdmin ? <div className="lesson-editor"><input value={item.title} onChange={(e) => updateLocal('items', item.id, 'title', e.target.value)} /><input value={item.drive_url} onChange={(e) => updateLocal('items', item.id, 'drive_url', e.target.value)} placeholder="Enlace de Drive" /><textarea rows="2" value={item.description} onChange={(e) => updateLocal('items', item.id, 'description', e.target.value)} placeholder="Descripción" /><div className="lesson-actions"><select value={item.resource_type} onChange={(e) => updateLocal('items', item.id, 'resource_type', e.target.value)}><option>Lección</option><option>Documento</option><option>Video</option><option>Carpeta</option></select><input type="number" min="1" value={item.sort_order} onChange={(e) => updateLocal('items', item.id, 'sort_order', e.target.value)} /><button className="text-button danger-text" type="button" onClick={() => window.confirm(t('¿Eliminar esta lección?')) && runAction(`delete-item-${item.id}`, () => deleteTrainingItem(item.id), 'Lección eliminada.')}>Eliminar</button><button className="secondary-button" type="button" onClick={() => runAction(`item-${item.id}`, () => updateTrainingItem(item), 'Lección actualizada.')}>Guardar</button></div></div> : <><label><input type="checkbox" checked={completed.has(item.id)} disabled={saving === item.id} onChange={() => toggleItem(item)} /><span><strong data-no-translate>{item.title}</strong>{item.description && <small data-no-translate>{item.description}</small>}</span></label>{item.drive_url ? <a className="secondary-button" href={item.drive_url} target="_blank" rel="noreferrer">Abrir en Drive ↗</a> : <span className="resource-pending">Enlace pendiente</span>}</>}</div>)}</div>
          {isAdmin && <div className="training-admin-box add-lesson"><p className="eyebrow">Nueva lección</p><div className="admin-training-grid"><label>Título<input value={itemDraft.title} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, title: e.target.value } }))} /></label><label>Enlace de Drive<input value={itemDraft.driveUrl} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, driveUrl: e.target.value } }))} /></label><label>Tipo<select value={itemDraft.resourceType} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, resourceType: e.target.value } }))}><option>Lección</option><option>Documento</option><option>Video</option><option>Carpeta</option></select></label><label className="wide">Descripción<input value={itemDraft.description} onChange={(e) => setNewItems((current) => ({ ...current, [module.id]: { ...itemDraft, description: e.target.value } }))} /></label></div><button className="secondary-button" type="button" disabled={!itemDraft.title.trim()} onClick={() => addItem(module)}>Agregar lección</button></div>}
          {!isAdmin && module.drive_url && <a className="module-drive-link" href={module.drive_url} target="_blank" rel="noreferrer">Abrir recursos del módulo en Drive ↗</a>}
        </div>}
      </article>
    })}</section>
  </div>
}
