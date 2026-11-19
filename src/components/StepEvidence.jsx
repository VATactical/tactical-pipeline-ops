import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { deleteStepEvidence, uploadStepEvidence } from '../services/opsService'

// Screenshots attached to one checklist step (at most MAX_EVIDENCE).
// - No screenshot yet: a button opens the upload box (paste with Ctrl/Cmd+V, drag or pick a file).
//   It closes by itself once the image is uploaded.
// - With screenshots: only an eye (view them) and a pencil (edit: add one more or delete).
// step.evidence says what proof the step expects: required (clear button, flagged while missing
// on a checked step), optional (small 📎 button) or none (no upload button).
export const MAX_EVIDENCE = 2

export default function StepEvidence({ clientId, step, items, canUpload, canDelete, onChange, autoOpen = false }) {
  const { t, locale } = useLanguage()
  const inputRef = useRef(null)
  const dropRef = useRef(null)
  const [panel, setPanel] = useState('') // '' | 'add' | 'edit'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null) // index of the image shown in the viewer
  const mode = step.evidence || 'optional'
  const room = MAX_EVIDENCE - items.length
  const allowUpload = canUpload && mode !== 'none'
  const canEdit = (allowUpload && room > 0) || items.some((item) => canDelete(item))

  useEffect(() => { if (autoOpen && allowUpload && !items.length) setPanel('add') }, [autoOpen, allowUpload, items.length])
  useEffect(() => { if (panel) dropRef.current?.focus() }, [panel])
  useEffect(() => {
    if (viewing === null) return undefined
    const keys = (event) => {
      if (event.key === 'Escape') setViewing(null)
      if (event.key === 'ArrowRight') setViewing((index) => (index + 1) % items.length)
      if (event.key === 'ArrowLeft') setViewing((index) => (index - 1 + items.length) % items.length)
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [viewing, items.length])

  const upload = async (files) => {
    const images = [...(files || [])].filter((file) => file.type?.startsWith('image/'))
    if (!images.length) { setError(t('Pega o elige una imagen.')); return }
    if (room <= 0) { setError(t('Máximo 2 capturas por paso. Elimina una para subir otra.')); return }
    setBusy(true); setError('')
    try {
      for (const file of images.slice(0, room)) await uploadStepEvidence({ clientId, stepId: step.id, file })
      if (images.length > room) setError(t('Solo se guardaron las primeras imágenes: máximo 2 por paso.'))
      setPanel('')
      await onChange()
    } catch (uploadError) { setError(t(uploadError.message || 'No se pudo subir la imagen.')) }
    finally { setBusy(false) }
  }
  const remove = async (item) => {
    if (!window.confirm(t('¿Eliminar esta captura?'))) return
    setBusy(true); setError('')
    try {
      await deleteStepEvidence(item)
      if (items.length <= 1) setPanel('')
      await onChange()
    } catch (deleteError) { setError(t(deleteError.message)) }
    finally { setBusy(false) }
  }

  const missing = mode === 'required' && !items.length
  if (!items.length && !allowUpload && !(missing && step.completed)) return null

  const dropZone = <div
    className={`step-evidence-drop ${busy ? 'busy' : ''}`}
    ref={dropRef}
    tabIndex={0}
    onPaste={(event) => { event.preventDefault(); upload(event.clipboardData?.files) }}
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => { event.preventDefault(); upload(event.dataTransfer?.files) }}
  >
    <span>{busy ? t('Subiendo…') : missing && step.completed ? t('Paso marcado. Pega aquí la captura que lo confirma (Ctrl+V) o arrástrala.') : t('Haz clic aquí y pega la captura (Ctrl+V), o arrástrala')}</span>
    <span className="step-evidence-drop-actions">
      <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => inputRef.current?.click()}>{t('Elegir imagen')}</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setPanel(items.length ? 'edit' : ''); setError('') }}>{t('Cancelar')}</button>
    </span>
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { upload(event.target.files); event.target.value = '' }} />
  </div>

  const current = viewing === null ? null : items[viewing]
  return <div className={`step-evidence ${mode}`}>
    <div className="step-evidence-row">
      {missing && step.completed && <span className="step-evidence-missing">⚠️ {t('Falta la captura que lo confirma')}</span>}
      {items.length > 0 && <>
        <button type="button" className="step-evidence-icon" onClick={() => setViewing(0)} title={t('Ver capturas')} aria-label={t('Ver capturas')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
          {items.length > 1 && <b>{items.length}</b>}
        </button>
        {canEdit && <button type="button" className={`step-evidence-icon ${panel === 'edit' ? 'active' : ''}`} onClick={() => { setPanel(panel === 'edit' ? '' : 'edit'); setError('') }} title={t('Editar capturas')} aria-label={t('Editar capturas')} aria-expanded={panel === 'edit'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
        </button>}
      </>}
      {!items.length && allowUpload && panel !== 'add' && (mode === 'required'
        ? <button type="button" className={`step-evidence-add ${missing ? 'required' : ''}`} onClick={() => setPanel('add')}>📷 {t('Agregar captura')}</button>
        : <button type="button" className="step-evidence-add optional" onClick={() => setPanel('add')} title={t('Agregar captura (opcional)')} aria-label={t('Agregar captura (opcional)')}>📎</button>)}
    </div>

    {panel === 'add' && allowUpload && dropZone}

    {panel === 'edit' && <div className="step-evidence-edit">
      <div className="step-evidence-edit-items">
        {items.map((item, index) => <figure key={item.id}>
          <button type="button" className="step-evidence-thumb" onClick={() => setViewing(index)} title={t('Ver captura')}>
            {item.url ? <img src={item.url} alt={t('Captura de evidencia')} loading="lazy" /> : <span>?</span>}
          </button>
          {canDelete(item) && <button type="button" className="step-evidence-remove" disabled={busy} onClick={() => remove(item)} title={t('Eliminar')} aria-label={t('Eliminar')}>×</button>}
        </figure>)}
        {allowUpload && room > 0 && <button type="button" className="step-evidence-slot" disabled={busy} onClick={() => setPanel('add')}>+ <small>{t('Agregar otra')}</small></button>}
      </div>
      <div className="step-evidence-edit-foot">
        <small className="muted">{t('Máximo 2 capturas por paso.')}</small>
        <button type="button" className="secondary-button compact-button" onClick={() => setPanel('')}>{t('Listo')}</button>
      </div>
    </div>}

    {error && <p className="form-error">{error}</p>}

    {current && <div className="step-evidence-modal" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={current.url} alt={t('Captura de evidencia')} />
        <figcaption>
          {items.length > 1 && <span className="step-evidence-pager">
            <button type="button" className="secondary-button compact-button" onClick={() => setViewing((viewing - 1 + items.length) % items.length)} aria-label={t('Anterior')}>‹</button>
            <span>{viewing + 1} / {items.length}</span>
            <button type="button" className="secondary-button compact-button" onClick={() => setViewing((viewing + 1) % items.length)} aria-label={t('Siguiente')}>›</button>
          </span>}
          <span>{new Date(current.created_at).toLocaleString(locale)}</span>
          <a href={current.url} target="_blank" rel="noreferrer">{t('Abrir en otra pestaña')}</a>
          <button type="button" className="secondary-button compact-button" onClick={() => setViewing(null)}>{t('Cerrar')}</button>
        </figcaption>
      </figure>
    </div>}
  </div>
}
