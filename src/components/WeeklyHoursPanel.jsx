import { useMemo, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { formatHoursAndMinutes } from '../utils/timeDuration'

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

  return <section className="content-card weekly-hours-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Resumen quincenal')}</p><h3>{t('Horas registradas en la quincena')}</h3><p className="muted">{start} — {end} · {t('Las horas se registran dentro del reporte EOD diario.')}</p></div></div>
    <div className="weekly-hours-filters">
      <label>{t('Mes')}<input aria-label={t('Mes')} type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
      <div className="eod-payroll-period-options" role="group" aria-label={t('Periodo quincenal')}>
        <button type="button" className={period === 'first' ? 'active' : ''} aria-pressed={period === 'first'} onClick={() => setPeriod('first')}>{t('Del 1 al 13')}</button>
        <button type="button" className={period === 'second' ? 'active' : ''} aria-pressed={period === 'second'} onClick={() => setPeriod('second')}>{t('Del 14 al fin de mes')}</button>
      </div>
      {canReviewAll && <label>{t('Integrante')}<select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="all">{t('Todo el equipo')}</option>{directory.filter((member) => member.role !== 'superadmin').map((member) => <option value={member.id} key={member.id}>{member.full_name}</option>)}</select></label>}
    </div>
    <div className="weekly-hours-total"><div><span>{t('Total de la quincena')}</span><small data-no-translate>{userLabel}</small></div><strong>{formatHoursAndMinutes(total)}</strong></div>
    <div className="weekly-day-grid">{byDay.map((day) => <article className="weekly-day-card" key={day.date}><div><strong>{new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</strong><b>{formatHoursAndMinutes(day.total)}</b></div>{day.items.length === 0 ? <small>{t('Sin horas')}</small> : day.items.map((entry) => <p key={entry.id}><span data-no-translate>{entry.memo}</span><small><b>{formatHoursAndMinutes(Number(entry.hours))}</b>{userId === 'all' && <> · <span data-no-translate>{entry.profiles?.full_name}</span></>}</small></p>)}</article>)}</div>
  </section>
}
