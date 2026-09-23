import { useMemo, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { downloadWeeklyHoursPdf } from '../lib/reportExports'
import { loadCompanySettings } from '../services/companyService'
import { deleteStandaloneTimeEntry, saveStandaloneTimeEntry } from '../services/eodService'

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function mondayFor(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`)
  const day = date.getUTCDay() || 7
  return addDays(dateString, 1 - day)
}

export default function WeeklyHoursPanel({ entries, directory, profile, canReviewAll, currentDate, onChanged }) {
  const { t, locale } = useLanguage()
  const [weekStart, setWeekStart] = useState(() => mondayFor(currentDate))
  const [userId, setUserId] = useState(canReviewAll ? 'all' : profile.id)
  const [error, setError] = useState('')
  const [entryDate, setEntryDate] = useState(currentDate)
  const [entryHours, setEntryHours] = useState('')
  const [entryMemo, setEntryMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const weekEnd = addDays(weekStart, 6)
  const currentWeekStart = mondayFor(currentDate)
  const canEditWeek = Boolean(profile?.permissions?.eod_reports) && weekStart === currentWeekStart
  const dateMax = weekEnd < currentDate ? weekEnd : currentDate
  const visible = useMemo(() => entries.filter((entry) => entry.work_date >= weekStart && entry.work_date <= weekEnd && (userId === 'all' || entry.user_id === userId)), [entries, userId, weekEnd, weekStart])
  const total = visible.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
  const byDay = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    const items = visible.filter((entry) => entry.work_date === date)
    return { date, items, total: items.reduce((sum, entry) => sum + Number(entry.hours || 0), 0) }
  }), [visible, weekStart])
  const selectedMember = directory.find((member) => member.id === userId)
  const userLabel = userId === 'all' ? t('Todo el equipo') : selectedMember?.full_name || profile.full_name

  const exportPdf = async () => {
    try {
      const company = await loadCompanySettings()
      await downloadWeeklyHoursPdf({ entries: visible, weekStart, weekEnd, userLabel, company })
    } catch (exportError) { setError(t(exportError.message)) }
  }

  const chooseWeek = (date) => {
    const nextWeek = mondayFor(date)
    setWeekStart(nextWeek)
    setEntryDate(nextWeek <= currentWeekStart ? (nextWeek === currentWeekStart ? currentDate : addDays(nextWeek, 6)) : currentDate)
  }

  const addEntry = async (event) => {
    event.preventDefault()
    setError('')
    if (!canEditWeek) return
    if (entryDate < weekStart || entryDate > weekEnd || entryDate > dateMax) {
      setError(t('Selecciona una fecha válida dentro de la semana activa.'))
      return
    }
    setSaving(true)
    try {
      await saveStandaloneTimeEntry({ profileId: profile.id, workDate: entryDate, hours: entryHours, memo: entryMemo })
      setEntryHours('')
      setEntryMemo('')
      await onChanged?.()
    } catch (saveError) {
      setError(t(saveError.message))
    } finally { setSaving(false) }
  }

  const removeEntry = async (entry) => {
    setError(''); setDeleting(entry.id)
    try {
      await deleteStandaloneTimeEntry({ entryId: entry.id, profileId: profile.id })
      await onChanged?.()
    } catch (deleteError) {
      setError(t(deleteError.message))
    } finally { setDeleting(null) }
  }

  return <section className="content-card weekly-hours-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Registro tipo Upwork')}</p><h3>{t('Horas registradas · lunes a domingo')}</h3><p className="muted">{weekStart} — {weekEnd} · {canEditWeek ? t('Puedes agregar horas hasta el domingo.') : t('Semana cerrada para edición.')}</p></div><button className="secondary-button" type="button" onClick={exportPdf}>{t('Exportar horas PDF')}</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="weekly-hours-filters"><button className="text-button" type="button" onClick={() => chooseWeek(addDays(weekStart, -7))}>← {t('Semana anterior')}</button><input aria-label={t('Semana')} type="date" value={weekStart} onChange={(event) => chooseWeek(event.target.value)} />{canReviewAll && <select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="all">{t('Todo el equipo')}</option>{directory.filter((member) => member.role !== 'superadmin').map((member) => <option value={member.id} key={member.id}>{member.full_name}</option>)}</select>}<button className="text-button" type="button" onClick={() => chooseWeek(addDays(weekStart, 7))}> {t('Semana siguiente')} →</button></div>
    {canEditWeek && <form className="weekly-hours-entry-form" onSubmit={addEntry}><div><label>{t('Fecha')}<input type="date" value={entryDate} min={weekStart} max={dateMax} onChange={(event) => setEntryDate(event.target.value)} required /></label><label>{t('Horas')}<input type="number" min="0.01" max="24" step="0.01" value={entryHours} onChange={(event) => setEntryHours(event.target.value)} placeholder="0.00" required /></label></div><label>{t('Memo')}<input maxLength="500" value={entryMemo} onChange={(event) => setEntryMemo(event.target.value)} placeholder={t('Describe el trabajo realizado…')} required /></label><button className="primary-button compact-button" type="submit" disabled={saving}>{saving ? t('Guardando…') : t('Agregar horas')}</button></form>}
    <div className="weekly-hours-total"><span>{t('Total semanal')}</span><strong>{total.toFixed(2)} h</strong><small data-no-translate>{userLabel}</small></div>
    <div className="weekly-day-grid">{byDay.map((day) => <article className="weekly-day-card" key={day.date}><div><strong>{new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</strong><b>{day.total.toFixed(2)} h</b></div>{day.items.length === 0 ? <small>{t('Sin horas')}</small> : day.items.map((entry) => <p key={entry.id}><span data-no-translate>{entry.memo}</span><small><b>{Number(entry.hours).toFixed(2)} h</b>{userId === 'all' && <> · <span data-no-translate>{entry.profiles?.full_name}</span></>}{canEditWeek && entry.user_id === profile.id && !entry.eod_report_id && <button className="text-button inline-delete" type="button" disabled={deleting === entry.id} onClick={() => removeEntry(entry)}>{deleting === entry.id ? '…' : t('Quitar')}</button>}</small></p>)}{canEditWeek && <button className="text-button day-add-button" type="button" onClick={() => setEntryDate(day.date)}>{t('Agregar en este día')}</button>}</article>)}</div>
  </section>
}
