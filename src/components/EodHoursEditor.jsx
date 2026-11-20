import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { saveEodHours } from '../services/eodService'
import { formatHoursAndMinutes } from '../utils/timeDuration'

const emptyRow = () => ({ hours: '', minutes: '', memo: '' })
const toRows = (entries) => (entries || []).length
  ? entries.map((entry) => {
    const total = Math.round(Number(entry.hours || 0) * 60)
    return { hours: String(Math.floor(total / 60)), minutes: String(total % 60), memo: entry.memo || '' }
  })
  : [emptyRow()]

// Hours for an EOD saved from Slack: the Slack message has no time log, so the author adds it here.
export default function EodHoursEditor({ report, onSaved }) {
  const { t } = useLanguage()
  const existing = report.time_entries || []
  const [open, setOpen] = useState(!existing.length)
  const [rows, setRows] = useState(() => toRows(existing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const total = rows.reduce((sum, row) => sum + (Number(row.hours) || 0) + (Number(row.minutes) || 0) / 60, 0)
  const update = (index, field, value) => setRows((current) => current.map((row, position) => position === index ? { ...row, [field]: value } : row))

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const entries = await saveEodHours({ reportId: report.id, workDate: report.report_date, entries: rows })
      setRows(toRows(entries))
      setOpen(false)
      onSaved?.(entries)
    } catch (saveError) {
      setError(t(saveError.message || 'No se pudieron guardar las horas.'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return <div className="eod-hours-editor collapsed">
      <span>{existing.length ? <>{t('Horas registradas')}: <strong>{formatHoursAndMinutes(existing.reduce((sum, entry) => sum + Number(entry.hours || 0), 0))}</strong></> : t('Este EOD aún no tiene horas.')}</span>
      <button className="secondary-button compact-button" type="button" onClick={() => setOpen(true)}>{existing.length ? t('Editar horas') : t('Agregar horas')}</button>
    </div>
  }

  return <form className="eod-hours-editor" onSubmit={save}>
    <div className="eod-hours-editor-head">
      <strong>{existing.length ? t('Editar horas del día') : t('Agregar horas del día')}</strong>
      <small>{t('El EOD llegó desde Slack sin horas. Registra el tiempo de cada actividad.')}</small>
    </div>
    {rows.map((row, index) => <div className="eod-hours-row" key={index}>
      <label><span>{t('Horas')}</span><input type="number" min="0" max="24" step="1" inputMode="numeric" value={row.hours} onChange={(event) => update(index, 'hours', event.target.value)} /></label>
      <label><span>{t('Min')}</span><input type="number" min="0" max="59" step="5" inputMode="numeric" value={row.minutes} onChange={(event) => update(index, 'minutes', event.target.value)} /></label>
      <label className="eod-hours-memo"><span>{t('Actividad')}</span><input maxLength="500" value={row.memo} onChange={(event) => update(index, 'memo', event.target.value)} placeholder={t('Ej. C12 seguimiento de onboarding')} /></label>
      {rows.length > 1 && <button className="icon-button" type="button" aria-label={t('Quitar')} onClick={() => setRows((current) => current.filter((_row, position) => position !== index))}>×</button>}
    </div>)}
    <div className="eod-hours-actions">
      <button className="secondary-button compact-button" type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>{t('Agregar otra actividad')}</button>
      <span>{t('Total')}: <strong>{formatHoursAndMinutes(total)}</strong></span>
      {existing.length > 0 && <button className="secondary-button compact-button" type="button" onClick={() => { setRows(toRows(existing)); setOpen(false) }}>{t('Cancelar')}</button>}
      <button className="primary-button compact-button" disabled={saving}>{saving ? t('Guardando…') : t('Guardar horas')}</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>
}
