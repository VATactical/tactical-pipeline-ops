import { useCallback, useEffect, useMemo, useState } from 'react'
import CompanySubnav from '../components/CompanySubnav'
import LoadingScreen from '../components/LoadingScreen'
import { useLanguage } from '../i18n/LanguageContext'
import {
  applyChecklistTemplateSteps, deleteChecklistTemplateStep, loadChecklistTemplate,
  moveChecklistTemplateStep, saveChecklistTemplateStep,
} from '../services/checklistTemplateService'

const PHASES = [
  ['prep', 'Venta y preparación'], ['call', 'Llamada de onboarding'], ['build', 'Montaje'],
  ['launch', 'QA y lanzamiento'], ['post', 'Post-lanzamiento'],
]
const EVIDENCE = [['none', 'Sin captura'], ['optional', 'Captura opcional'], ['required', 'Captura obligatoria']]

function StepForm({ initial, departments, onCancel, onSave, saving }) {
  const { t, language } = useLanguage()
  const [form, setForm] = useState(initial)
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  return <form className="checklist-template-form" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
    <label className="wide">{t('Paso (español)')}<input value={form.title_es} onChange={(e) => set('title_es', e.target.value)} required minLength={3} autoFocus /></label>
    <label className="wide">{t('Paso (inglés)')}<input value={form.title_en} onChange={(e) => set('title_en', e.target.value)} placeholder={t('Si lo dejas vacío se usa el texto en español')} /></label>
    <label>{t('Fase')}<select value={form.phase} onChange={(e) => set('phase', e.target.value)}>{PHASES.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
    <label>{t('Departamento')}<select value={form.department_id} onChange={(e) => set('department_id', e.target.value)} required>{departments.map((d) => <option key={d.id} value={d.id}>{language === 'en' ? d.name_en || d.name_es : d.name_es}</option>)}</select></label>
    <label>{t('Evidencia')}<select value={form.evidence} onChange={(e) => set('evidence', e.target.value)}>{EVIDENCE.map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label>
    <div className="checklist-template-form-actions">
      <button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Guardar paso')}</button>
      <button className="secondary-button compact-button" type="button" onClick={onCancel} disabled={saving}>{t('Cancelar')}</button>
    </div>
  </form>
}

export default function ChecklistTemplatePage() {
  const { t, language } = useLanguage()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState(null) // step_key, or `new:<phase>`
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [pending, setPending] = useState([]) // step keys changed since the last "apply"
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => loadChecklistTemplate().then(setData).catch((e) => setError(e.message)), [])
  useEffect(() => { reload() }, [reload])

  const departmentName = useMemo(() => Object.fromEntries((data?.departments || []).map((d) => [d.id, language === 'en' ? d.name_en || d.name_es : d.name_es])), [data, language])
  if (!data && !error) return <LoadingScreen />

  const remember = (keys) => setPending((current) => [...new Set([...current, ...keys.filter(Boolean)])])
  const run = async (action, success) => {
    setBusy(true); setError(''); setMessage('')
    try { const result = await action(); await reload(); if (success) setMessage(success(result)) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const save = (form) => run(async () => {
    const key = await saveChecklistTemplateStep(form)
    remember([key]); setEditing(null)
    return key
  }, () => t('Paso guardado en la plantilla. Aplica a los clientes nuevos.'))
  const move = (key, direction) => run(async () => remember(await moveChecklistTemplateStep(key, direction)))
  const remove = (key) => run(async () => {
    await deleteChecklistTemplateStep(key)
    remember([key]); setConfirmDelete(null)
  }, () => t('Paso eliminado de la plantilla.'))
  const apply = () => run(async () => {
    const result = await applyChecklistTemplateSteps(pending)
    setPending([])
    return result
  }, (result) => t('Aplicado a los clientes activos: {added} agregados, {updated} actualizados, {removed} quitados. Los pasos ya completados no se tocaron.')
    .replace('{added}', result.added).replace('{updated}', result.updated).replace('{removed}', result.removed))

  const steps = data?.steps || []
  const blank = (phase) => ({ step_key: null, title_es: '', title_en: '', phase, department_id: data.departments.find((d) => d.id === 'onboarding_csm')?.id || data.departments[0]?.id || '', evidence: 'none' })
  let number = 0

  return <div className="page-stack compact-page checklist-template-page">
    <header className="page-header"><div><p className="eyebrow">{t('Administración')}</p><h2>{t('Checklist de onboarding')}</h2><p className="muted">{t('La plantilla que recibe cada cliente nuevo. Edita, agrega, ordena o elimina pasos.')}</p></div></header>
    <CompanySubnav />
    {error && <p className="form-error">{error}</p>}
    {message && <p className="form-success">{message}</p>}
    {pending.length > 0 && <div className="checklist-template-apply" role="status">
      <div><strong>{t('Cambios en la plantilla')}</strong><span>{t('Ya aplican a los clientes nuevos. ¿Aplicarlos también a los {n} clientes activos? Los pasos completados no se tocan.').replace('{n}', data.activeClients)}</span></div>
      <div className="checklist-template-apply-actions">
        <button className="primary-button compact-button" type="button" disabled={busy} onClick={apply}>{busy ? t('Aplicando…') : t('Aplicar a clientes activos')}</button>
        <button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => setPending([])}>{t('Solo clientes nuevos')}</button>
      </div>
    </div>}
    {PHASES.map(([phase, label]) => {
      const rows = steps.filter((step) => step.phase === phase)
      return <section key={phase} className="content-card checklist-template-phase">
        <header><h3>{t(label)}</h3><span className="muted">{rows.length} {rows.length === 1 ? t('paso') : t('pasos')}</span></header>
        <ol className="checklist-template-list">
          {rows.map((step) => {
            number += 1
            const index = steps.indexOf(step)
            if (editing === step.step_key) return <li key={step.step_key} className="editing"><StepForm initial={step} departments={data.departments} saving={busy} onCancel={() => setEditing(null)} onSave={save} /></li>
            return <li key={step.step_key}>
              <span className="checklist-template-number">{number}</span>
              <div className="checklist-template-text">
                <strong>{language === 'en' ? step.title_en || step.title_es : step.title_es}</strong>
                <small>{language === 'en' ? step.title_es : step.title_en}</small>
                <div className="checklist-template-tags"><span>{departmentName[step.department_id] || step.department_id}</span>{step.evidence !== 'none' && <span className={`evidence-${step.evidence}`}>{t(EVIDENCE.find(([key]) => key === step.evidence)[1])}</span>}</div>
              </div>
              {confirmDelete === step.step_key
                ? <div className="checklist-template-actions confirm"><span>{t('¿Eliminar este paso?')}</span><button className="danger-button compact-button" type="button" disabled={busy} onClick={() => remove(step.step_key)}>{t('Eliminar')}</button><button className="secondary-button compact-button" type="button" onClick={() => setConfirmDelete(null)}>{t('Cancelar')}</button></div>
                : <div className="checklist-template-actions">
                  <button className="icon-button" type="button" aria-label={t('Subir')} title={t('Subir')} disabled={busy || index === 0} onClick={() => move(step.step_key, -1)}>↑</button>
                  <button className="icon-button" type="button" aria-label={t('Bajar')} title={t('Bajar')} disabled={busy || index === steps.length - 1} onClick={() => move(step.step_key, 1)}>↓</button>
                  <button className="text-button compact-button" type="button" disabled={busy} onClick={() => { setEditing(step.step_key); setConfirmDelete(null) }}>{t('Editar')}</button>
                  <button className="text-button compact-button danger-text" type="button" disabled={busy} onClick={() => { setConfirmDelete(step.step_key); setEditing(null) }}>{t('Eliminar')}</button>
                </div>}
            </li>
          })}
          {editing === `new:${phase}` && <li className="editing"><StepForm initial={blank(phase)} departments={data.departments} saving={busy} onCancel={() => setEditing(null)} onSave={save} /></li>}
        </ol>
        {editing !== `new:${phase}` && <button className="secondary-button compact-button checklist-template-add" type="button" disabled={busy} onClick={() => { setEditing(`new:${phase}`); setConfirmDelete(null) }}>+ {t('Agregar paso')}</button>}
      </section>
    })}
  </div>
}
