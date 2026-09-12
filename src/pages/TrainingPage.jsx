import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadTraining, setTrainingItemCompleted } from '../services/trainingService'

const roleLabels = {
  onboarding_media: 'Diego · Onboarding & Media',
  automation_funnels: 'Daniel · Automations & Funnels',
  user_admin: 'User Admin',
}

export default function TrainingPage() {
  const { profile } = useAuth()
  const [data, setData] = useState({ modules: [], items: [], progress: [] })
  const [open, setOpen] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadTraining(profile).then(setData).catch((loadError) => setError(loadError.message)).finally(() => setLoading(false))
  }, [profile])

  const completed = useMemo(() => new Set(data.progress.map((item) => item.item_id)), [data.progress])
  const visibleModules = data.modules.filter((module) => !module.audience_role || module.audience_role === profile.role || profile.role === 'superadmin')
  const visibleItems = data.items.filter((item) => visibleModules.some((module) => module.id === item.module_id))
  const completion = visibleItems.length ? Math.round((visibleItems.filter((item) => completed.has(item.id)).length / visibleItems.length) * 100) : 0

  const toggleItem = async (item) => {
    const next = !completed.has(item.id)
    setSaving(item.id); setError('')
    try {
      await setTrainingItemCompleted(profile.id, item.id, next)
      setData((current) => ({
        ...current,
        progress: next
          ? [...current.progress.filter((row) => row.item_id !== item.id), { user_id: profile.id, item_id: item.id, completed_at: new Date().toISOString() }]
          : current.progress.filter((row) => row.item_id !== item.id),
      }))
    } catch (saveError) { setError(saveError.message) }
    finally { setSaving(null) }
  }

  if (loading) return <LoadingScreen />
  return <div className="page-stack">
    <header className="page-header"><div><p className="eyebrow">Training Hub</p><h2>Formación del equipo</h2><p className="muted">Revisa el hub semanalmente y marca cada lección cuando esté comprendida.</p></div><span className="status-pill">{completion}% completado</span></header>
    {error && <p className="form-error">{error}</p>}
    <section className="content-card training-summary"><div><span>Tu progreso</span><strong>{visibleItems.filter((item) => completed.has(item.id)).length} de {visibleItems.length} lecciones</strong></div><div className="progress-track"><span style={{ width: `${completion}%` }} /></div></section>
    <section className="training-modules">{visibleModules.map((module) => {
      const items = data.items.filter((item) => item.module_id === module.id)
      const done = items.filter((item) => completed.has(item.id)).length
      const expanded = open === module.id
      return <article className="content-card training-module" key={module.id}>
        <button className="training-module-header" type="button" onClick={() => setOpen(expanded ? null : module.id)} aria-expanded={expanded}>
          <div><p className="eyebrow">{module.audience_role ? roleLabels[module.audience_role] : 'Todos los usuarios'}</p><h3>{module.title}</h3><p className="muted">{module.description}</p></div><span>{done}/{items.length} {expanded ? '▴' : '▾'}</span>
        </button>
        {expanded && <div className="training-lessons">{items.map((item) => <div className={`training-lesson ${completed.has(item.id) ? 'completed' : ''}`} key={item.id}>
          <label><input type="checkbox" checked={completed.has(item.id)} disabled={saving === item.id} onChange={() => toggleItem(item)} /><span><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</span></label>
          {item.drive_url ? <a className="secondary-button" href={item.drive_url} target="_blank" rel="noreferrer">Abrir en Drive ↗</a> : <span className="resource-pending">Enlace pendiente</span>}
        </div>)}</div>}
        {module.drive_url && <a className="module-drive-link" href={module.drive_url} target="_blank" rel="noreferrer">Abrir recursos del módulo en Drive ↗</a>}
      </article>
    })}</section>
  </div>
}
