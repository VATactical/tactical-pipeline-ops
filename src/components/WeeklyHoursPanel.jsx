import { useMemo, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { downloadWeeklyHoursPdf } from '../lib/reportExports'
import { loadCompanySettings } from '../services/companyService'

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

export default function WeeklyHoursPanel({ entries, directory, profile, canReviewAll, currentDate }) {
  const { t, locale } = useLanguage()
  const [weekStart, setWeekStart] = useState(() => mondayFor(currentDate))
  const [userId, setUserId] = useState(canReviewAll ? 'all' : profile.id)
  const [error, setError] = useState('')
  const weekEnd = addDays(weekStart, 6)
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

  return <section className="content-card weekly-hours-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Resumen semanal')}</p><h3>{t('Horas registradas · lunes a domingo')}</h3><p className="muted">{weekStart} — {weekEnd} · {t('Las horas se registran dentro del reporte EOD diario.')}</p></div><button className="secondary-button" type="button" onClick={exportPdf}>{t('Exportar horas PDF')}</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="weekly-hours-filters"><button className="text-button" type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>← {t('Semana anterior')}</button><input aria-label={t('Semana')} type="date" value={weekStart} onChange={(event) => setWeekStart(mondayFor(event.target.value))} />{canReviewAll && <select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="all">{t('Todo el equipo')}</option>{directory.filter((member) => member.role !== 'superadmin').map((member) => <option value={member.id} key={member.id}>{member.full_name}</option>)}</select>}<button className="text-button" type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>{t('Semana siguiente')} →</button></div>
    <div className="weekly-hours-total"><span>{t('Total semanal')}</span><strong>{total.toFixed(2)} h</strong><small data-no-translate>{userLabel}</small></div>
    <div className="weekly-day-grid">{byDay.map((day) => <article className="weekly-day-card" key={day.date}><div><strong>{new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</strong><b>{day.total.toFixed(2)} h</b></div>{day.items.length === 0 ? <small>{t('Sin horas')}</small> : day.items.map((entry) => <p key={entry.id}><span data-no-translate>{entry.memo}</span><small><b>{Number(entry.hours).toFixed(2)} h</b>{userId === 'all' && <> · <span data-no-translate>{entry.profiles?.full_name}</span></>}</small></p>)}</article>)}</div>
  </section>
}
