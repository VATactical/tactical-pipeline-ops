import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { deleteStepEvidence, uploadStepEvidence } from '../services/opsService'

// Screenshots attached to one checklist step. Paste (Ctrl/Cmd+V) into the drop zone,
// drag a file onto it or pick one with the button.
// step.evidence says what proof the step expects:
//   required: a clear "Agregar captura" button; once the step is checked without one, it is flagged.
//   optional: a small 📎 button.
//   none:     no upload button (existing screenshots are still shown).
export default function StepEvidence({ clientId, step, items, canUpload, canDelete, onChange, autoOpen = false }) {
  const { t } = useLanguage()
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const dropRef = useRef(null)
  const mode = step.evidence || 'optional'
  const allowUpload = canUpload && mode !== 'none'
  useEffect(() => { if (autoOpen && allowUpload) setOpen(true) }, [autoOpen, allowUpload])
  useEffect(() => { if (open) dropRef.current?.focus() }, [open])
  useEffect(() => {
    if (!preview) return undefined
    const close = (event) => { if (event.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [preview])

  const upload = async (files) => {
    const images = [...(files || [])].filter((file) => file.type?.startsWith('image/'))
    if (!images.length) { setError(t('Pega o elige una imagen.')); return }
    setBusy(true); setError('')
    try {
      for (const file of images.slice(0, 5)) await uploadStepEvidence({ clientId, stepId: step.id, file })
      await onChange()
    } catch (uploadError) { setError(t(uploadError.message || 'No se pudo subir la imagen.')) }
    finally { setBusy(false) }
  }
  const remove = async (item) => {
    if (!window.confirm(t('¿Eliminar esta captura?'))) return
    setBusy(true); setError('')
    try { await deleteStepEvidence(item); setPreview(null); await onChange() }
    catch (deleteError) { setError(t(deleteError.message)) }
    finally { setBusy(false) }
  }

  const missing = mode === 'required' && !items.length
  if (!items.length && !allowUpload && !(missing && step.completed)) return null
  return <div className={`step-evidence ${mode}`}>
    <div className="step-evidence-row">
      {missing && step.completed && <span className="step-evidence-missing">⚠️ {t('Falta la captura que lo confirma')}</span>}
      {items.map((item) => <button type="button" className="step-evidence-thumb" key={item.id} onClick={() => setPreview(item)} title={t('Ver captura')}>
        {item.url ? <img src={item.url} alt={t('Captura de evidencia')} loading="lazy" /> : <span>?</span>}
      </button>)}
      {allowUpload && (mode === 'required' || items.length
        ? <button type="button" className={`step-evidence-add ${missing ? 'required' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {items.length ? '+' : `📷 ${t('Agregar captura')}`}
        </button>
        : <button type="button" className="step-evidence-add optional" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={t('Agregar captura (opcional)')} aria-label={t('Agregar captura (opcional)')}>📎</button>)}
    </div>
    {open && allowUpload && <div
      className={`step-evidence-drop ${busy ? 'busy' : ''}`}
      ref={dropRef}
      tabIndex={0}
      onPaste={(event) => { event.preventDefault(); upload(event.clipboardData?.files) }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); upload(event.dataTransfer?.files) }}
    >
      <span>{busy ? t('Subiendo…') : missing && step.completed ? t('Paso marcado. Pega aquí la captura que lo confirma (Ctrl+V) o arrástrala.') : t('Haz clic aquí y pega la captura (Ctrl+V), o arrástrala')}</span>
      <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => inputRef.current?.click()}>{t('Elegir imagen')}</button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { upload(event.target.files); event.target.value = '' }} />
    </div>}
    {error && <p className="form-error">{error}</p>}
    {preview && <div className="step-evidence-modal" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={preview.url} alt={t('Captura de evidencia')} />
        <figcaption>
          <span data-no-translate>{preview.file_name}</span>
          <span>{new Date(preview.created_at).toLocaleString()}</span>
          <a href={preview.url} target="_blank" rel="noreferrer">{t('Abrir en otra pestaña')}</a>
          {canDelete(preview) && <button type="button" className="danger-button compact-button" disabled={busy} onClick={() => remove(preview)}>{t('Eliminar')}</button>}
          <button type="button" className="secondary-button compact-button" onClick={() => setPreview(null)}>{t('Cerrar')}</button>
        </figcaption>
      </figure>
    </div>}
  </div>
}
