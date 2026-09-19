import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { downloadAdsReportPdf } from '../lib/reportExports'
import { loadAdsReports, saveAdsReport } from '../services/adsReportService'
import { loadCompanySettings } from '../services/companyService'

const today = new Date().toISOString().slice(0, 10)
const initial = { reportDate: today, periodStart: today, periodEnd: today, reportStatus: 'Activa', spend: '', impressions: '', reach: '', clicks: '', leads: '', appointments: '', summary: '', wins: '', issues: '', nextSteps: '' }
const money = (value) => `$${Number(value || 0).toFixed(2)}`

export default function AdsReportsPanel({ client, canEdit }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const [reports, setReports] = useState([])
  const [form, setForm] = useState(initial)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const refresh = () => loadAdsReports(client.id).then(setReports)
  useEffect(() => { refresh().catch((loadError) => setError(t(loadError.message))) }, [client.id, t])

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      await saveAdsReport(client.id, profile.id, form)
      await refresh(); setForm(initial); setOpen(false); setMessage(t('Reporte ADS guardado.'))
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false) }
  }
  const exportPdf = async (report) => {
    try {
      const company = await loadCompanySettings()
      await downloadAdsReportPdf({ report, client, authorName: report.author?.full_name || t('Equipo'), company })
    } catch (exportError) { setError(t(exportError.message)) }
  }

  return <section className="content-card ads-reports-panel">
    <div className="section-heading"><div><p className="eyebrow">{t('Seguimiento de campaña')}</p><h3>{t('Reportes ADS')}</h3><p className="muted">{t('Histórico por fecha con métricas, observaciones y responsable.')}</p></div>{canEdit && <button className="primary-button compact-button" type="button" onClick={() => setOpen((current) => !current)}>{t(open ? 'Cancelar' : 'Crear reporte ADS')}</button>}</div>
    {error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}
    {open && <form className="ads-report-form" onSubmit={submit}>
      <div className="ads-report-grid">
        <label>{t('Fecha del reporte')}<input type="date" value={form.reportDate} onChange={(e) => setField('reportDate', e.target.value)} required /></label>
        <label>{t('Desde')}<input type="date" value={form.periodStart} onChange={(e) => setField('periodStart', e.target.value)} required /></label>
        <label>{t('Hasta')}<input type="date" value={form.periodEnd} onChange={(e) => setField('periodEnd', e.target.value)} required /></label>
        <label>{t('Estado de campaña')}<select value={form.reportStatus} onChange={(e) => setField('reportStatus', e.target.value)}><option value="Activa">{t('Activa')}</option><option value="Requiere atención">{t('Requiere atención')}</option><option value="Pausada">{t('Pausada')}</option></select></label>
        {[['spend', 'Gasto'], ['impressions', 'Impresiones'], ['reach', 'Alcance'], ['clicks', 'Clics'], ['leads', 'Leads'], ['appointments', 'Citas']].map(([key, label]) => <label key={key}>{t(label)}<input type="number" min="0" step={key === 'spend' ? '0.01' : '1'} value={form[key]} onChange={(e) => setField(key, e.target.value)} /></label>)}
        <label className="wide">{t('Resumen ejecutivo')}<textarea rows="3" value={form.summary} onChange={(e) => setField('summary', e.target.value)} /></label>
        <label className="wide">{t('Resultados positivos')}<textarea rows="2" value={form.wins} onChange={(e) => setField('wins', e.target.value)} /></label>
        <label className="wide">{t('Problemas o riesgos')}<textarea rows="2" value={form.issues} onChange={(e) => setField('issues', e.target.value)} /></label>
        <label className="wide">{t('Próximos pasos')}<textarea rows="2" value={form.nextSteps} onChange={(e) => setField('nextSteps', e.target.value)} /></label>
      </div>
      <button className="primary-button compact-button" disabled={saving}>{t(saving ? 'Guardando…' : 'Guardar reporte')}</button>
    </form>}
    <div className="ads-report-history">{reports.length === 0 && <p className="muted">{t('Todavía no hay reportes ADS para este cliente.')}</p>}{reports.map((report) => <article className="ads-report-card" key={report.id}>
      <div className="ads-report-title"><div><strong>{new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(`${report.report_date}T12:00:00`))}</strong><small>{report.period_start} — {report.period_end} · <span data-no-translate>{report.author?.full_name || t('Equipo')}</span></small></div><span className={`lifecycle ${report.report_status === 'Pausada' ? 'ads-paused' : report.report_status === 'Requiere atención' ? 'a2p-submitted' : 'ads-live'}`}>{t(report.report_status)}</span></div>
      <div className="ads-metric-strip"><span>{t('Gasto')}<b>{money(report.spend)}</b></span><span>CTR<b>{Number(report.ctr).toFixed(2)}%</b></span><span>CPC<b>{money(report.cpc)}</b></span><span>{t('Leads')}<b>{report.leads}</b></span><span>CPL<b>{money(report.cpl)}</b></span><span>{t('Citas')}<b>{report.appointments}</b></span></div>
      {report.summary && <p data-no-translate>{report.summary}</p>}
      <button className="secondary-button" type="button" onClick={() => exportPdf(report)}>{t('Exportar PDF para cliente')}</button>
    </article>)}</div>
  </section>
}
