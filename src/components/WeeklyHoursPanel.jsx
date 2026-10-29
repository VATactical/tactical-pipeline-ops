import { useEffect, useMemo, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { formatHoursAndMinutes } from '../utils/timeDuration'
import { loadOwnEodTimeEntries } from '../services/eodService'
import { downloadOwnHoursPdf } from '../lib/reportExports'

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function getSemiMonthlyRange(month, period) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return period === 'first'
    ? { start: `${month}-01`, end: `${month}-13` }
    : { start: `${month}-14`, end: `${month}-${String(lastDay).padStart(2, '0')}` }
}

export default function WeeklyHoursPanel({ entries, directory, profile, canReviewAll, currentDate }) {
  const { t, locale } = useLanguage()
  const currentMonth = currentDate.slice(0, 7)
  const currentPeriod = Number(currentDate.slice(8, 10)) < 14 ? 'first' : 'second'
  const [month, setMonth] = useState(currentMonth)
  const [period, setPeriod] = useState(currentPeriod)
  const [userId, setUserId] = useState(canReviewAll ? 'all' : profile.id)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [selectedDay, setSelectedDay] = useState(null)
  useEffect(() => {
    if (!selectedDay) return undefined
    const closeOnEscape = (event) => event.key === 'Escape' && setSelectedDay(null)
    document.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [selectedDay])
  const { start, end } = getSemiMonthlyRange(month, period)
  const visible = useMemo(() => entries.filter((entry) => entry.work_date >= start && entry.work_date <= end && (userId === 'all' || entry.user_id === userId)), [entries, end, start, userId])
  const total = visible.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
  const byDay = useMemo(() => {
    const dayCount = Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1
    return Array.from({ length: dayCount }, (_, index) => {
      const date = addDays(start, index)
      const items = visible.filter((entry) => entry.work_date === date)
      return { date, items, total: items.reduce((sum, entry) => sum + Number(entry.hours || 0), 0) }
    })
  }, [end, start, visible])
  const selectedMember = directory.find((member) => member.id === userId)
  const userLabel = userId === 'all' ? t('Todo el equipo') : selectedMember?.full_name || profile.full_name

  const downloadPersonalReport = async () => {
    setExporting(true)
    setExportError('')
    try {
      const ownEntries = await loadOwnEodTimeEntries(profile, start, end)
      await downloadOwnHoursPdf({ entries: ownEntries, startDate: start, endDate: end, userLabel: profile.full_name })
    } catch {
      setExportError(t('No se pudo descargar el reporte de horas.'))
    } finally {
      setExporting(false)
    }
  }

  return <section className="content-card weekly-hours-panel">
    <div className="section-heading weekly-hours-heading"><div><p className="eyebrow">{t('Resumen quincenal')}</p><h3>{t('Horas registradas en la quincena')}</h3><p className="muted">{start} — {end} · {t('Las horas se registran dentro del reporte EOD diario.')}</p></div><button className="secondary-button compact-button" type="button" onClick={downloadPersonalReport} disabled={exporting}>{t(exporting ? 'Preparando PDF…' : 'Descargar mis horas en PDF')}</button></div>
    {exportError && <p className="form-error" role="alert">{exportError}</p>}
    <div className="weekly-hours-filters">
      <label>{t('Mes')}<input aria-label={t('Mes')} type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
      <div className="eod-payroll-period-options" role="group" aria-label={t('Periodo quincenal')}>
        <button type="button" className={period === 'first' ? 'active' : ''} aria-pressed={period === 'first'} onClick={() => setPeriod('first')}>{t('Del 1 al 13')}</button>
        <button type="button" className={period === 'second' ? 'active' : ''} aria-pressed={period === 'second'} onClick={() => setPeriod('second')}>{t('Del 14 al fin de mes')}</button>
      </div>
      {canReviewAll && <label>{t('Integrante')}<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="all">{t('Todo el equipo')}</option>{directory.filter((member) => member.role !== 'superadmin').map((member) => <option value={member.id} key={member.id}>{member.full_name}</option>)}</select></label>}
    </div>
    <div className="weekly-hours-total"><div><span>{t('Total de la quincena')}</span><small data-no-translate>{userLabel}</small></div><strong>{formatHoursAndMinutes(total)}</strong></div>
    <div className="weekly-day-grid">{byDay.map((day) => {
      const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))
      return <article className="weekly-day-card" key={day.date}>
        <div><strong>{dayLabel}</strong><b>{formatHoursAndMinutes(day.total)}</b></div>
        {day.items.length === 0 ? <small>{t('Sin horas')}</small> : <>
          {day.items.slice(0, 2).map((entry) => <p key={entry.id}><span data-no-translate>{entry.memo}</span><small><b>{formatHoursAndMinutes(Number(entry.hours))}</b>{userId === 'all' && <> · <span data-no-translate>{entry.profiles?.full_name}</span></>}</small></p>)}
          <button className="weekly-day-more" type="button" onClick={() => setSelectedDay({ ...day, label: dayLabel })}>{t('Mostrar más')}</button>
        </>}
      </article>
    })}</div>
    {selectedDay && <div className="weekly-day-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-day-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDay(null) }}>
      <article className="weekly-day-modal-card">
        <header className="weekly-day-modal-header">
          <div><p className="eyebrow">{t('Detalle de horas')}</p><h3 id="weekly-day-modal-title">{selectedDay.label}</h3><p>{t('Total del día')}: <strong>{formatHoursAndMinutes(selectedDay.total)}</strong></p></div>
          <button className="secondary-button compact-button" type="button" onClick={() => setSelectedDay(null)}>{t('Cerrar')}</button>
        </header>
        <div className="weekly-day-modal-list">{selectedDay.items.map((entry) => <article className="weekly-day-detail-entry" key={entry.id}>
          <div><strong>{formatHoursAndMinutes(Number(entry.hours))}</strong>{userId === 'all' && <small data-no-translate>{entry.profiles?.full_name}</small>}</div>
          <p className="formatted-text" data-no-translate>{entry.memo}</p>
        </article>)}</div>
      </article>
    </div>}
  </section>
}