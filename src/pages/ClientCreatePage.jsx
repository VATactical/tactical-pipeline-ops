import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { buildDossierText } from '../lib/dossierExport'
import { createClient, parseOnboardingPdf, runOnboardingSetup, suggestNextClientCode } from '../services/opsService'

const initialForm = {
  code: '', business_name: '', legal_name: '', owner_name: '', email: '', phone: '', status: 'ONBOARDING',
  phase: 'Perfil', next_action: 'Completar dossier', daily_budget: 30, services: '', markets: '', timezone: '',
}
// Fields the form shows; everything else read from the PDF is saved with the client as well.
const VISIBLE = Object.keys(initialForm)
const EXTRA_LABELS = {
  contact_phone: 'Teléfono de contacto', contact_email: 'Correo de contacto', address: 'Dirección',
  ads_targeting_address: 'Dirección de segmentación', targeting_radius_miles: 'Radio de segmentación (millas)',
  onboarding_call_language: 'Idioma de la llamada', website_url: 'Sitio web', website_build_request: 'Pedido de sitio web',
  offer: 'Oferta', target_zip_codes: 'Códigos ZIP', gbp_email: 'Correo de Google Business Profile', gbp_link: 'Google Business Profile',
  facebook_page_url: 'Página de Facebook', facebook_business_info: 'Facebook', instagram_url: 'Instagram',
  onboarding_date: 'Fecha del formulario',
}

const readAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
  reader.readAsDataURL(file)
})

export default function ClientCreatePage() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const canCreate = profile?.role === 'superadmin' || Boolean(profile?.permissions?.clients_create)
  const [form, setForm] = useState(initialForm)
  const [extra, setExtra] = useState({})
  const [pdf, setPdf] = useState(null) // { name, filled: [field...] }
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoSetup, setAutoSetup] = useState(true)
  const [savingStep, setSavingStep] = useState('')
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    suggestNextClientCode().then((code) => setForm((current) => (current.code ? current : { ...current, code }))).catch(() => {})
  }, [])

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const readPdf = async (file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError(t('Sube el PDF del formulario de onboarding.')); return }
    if (file.size > 10 * 1024 * 1024) { setError(t('El PDF pesa más de 10 MB.')); return }
    setReading(true); setError('')
    try {
      const { fields } = await parseOnboardingPdf(await readAsBase64(file))
      const visible = {}
      const hidden = {}
      for (const [key, value] of Object.entries(fields || {})) (VISIBLE.includes(key) ? visible : hidden)[key] = value
      setForm((current) => ({ ...current, ...visible }))
      setExtra(hidden)
      setPdf({ name: file.name, filled: Object.keys(fields || {}).filter((key) => key in EXTRA_LABELS || VISIBLE.includes(key)) })
    } catch (readError) { setError(t(readError.message || 'No se pudo leer el PDF.')) }
    finally { setReading(false) }
  }
  const clearPdf = () => {
    setForm((current) => ({ ...initialForm, code: current.code }))
    setExtra({}); setPdf(null)
  }

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      setSavingStep('Guardando…')
      const client = await createClient({ ...extra, ...form })
      if (autoSetup) {
        // Slack channel, Drive folder and dossier Doc. A step that fails can be retried from the client page.
        setSavingStep('Creando canal de Slack y carpeta de Drive…')
        await runOnboardingSetup(client.id, { dossierText: buildDossierText(client, profile?.full_name || 'TP OPS') }).catch(() => {})
      }
      navigate(`/clientes/${client.id}`)
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setSaving(false); setSavingStep('') }
  }

  const extraRows = Object.entries(extra).filter(([key]) => EXTRA_LABELS[key])
  if (!canCreate) return <div className="page-stack"><p className="form-error">{t('No tienes permiso para crear clientes.')}</p><Link to="/clientes">← {t('Volver a clientes')}</Link></div>
  return (
    <div className="page-stack">
      <header className="page-header"><div><Link className="text-button" to="/clientes">← {t('Volver a clientes')}</Link><p className="eyebrow">{t('Nuevo expediente')}</p><h2>{t('Crear cliente')}</h2><p className="muted">{t('Sube el PDF del formulario de onboarding para rellenar el dossier, o registra lo esencial a mano.')}</p></div></header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section
        className={`content-card pdf-intake ${dragging ? 'dragging' : ''} ${pdf ? 'loaded' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); readPdf(event.dataTransfer?.files?.[0]) }}
      >
        <span className="pdf-intake-icon" aria-hidden="true">📄</span>
        <div>
          <strong>{pdf ? t('Datos tomados del PDF') : t('Rellenar desde el PDF del formulario')}</strong>
          <p className="muted">{reading ? t('Leyendo el PDF…')
            : pdf ? <><span data-no-translate>{pdf.name}</span> · {t(`${pdf.filled.length} campos completados. Revísalos antes de crear el cliente.`)}</>
              : t('Arrastra aquí el PDF de "Client Onboarding Form" de GHL o elígelo.')}</p>
        </div>
        <div className="pdf-intake-actions">
          <button type="button" className="secondary-button compact-button" disabled={reading} onClick={() => inputRef.current?.click()}>{pdf ? t('Cambiar PDF') : t('Elegir PDF')}</button>
          {pdf && <button type="button" className="text-button" onClick={clearPdf}>{t('Quitar')}</button>}
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { readPdf(event.target.files?.[0]); event.target.value = '' }} />
      </section>

      <form className="content-card client-form" onSubmit={submit}>
        <div><label>{t('Código')}</label><input required placeholder="C10" value={form.code} onChange={(event) => update('code', event.target.value)} /></div>
        <div><label>{t('Nombre comercial')}</label><input required value={form.business_name} onChange={(event) => update('business_name', event.target.value)} /></div>
        <div><label>{t('Nombre legal del negocio')}</label><input value={form.legal_name} onChange={(event) => update('legal_name', event.target.value)} /></div>
        <div><label>{t('Propietario')}</label><input value={form.owner_name} onChange={(event) => update('owner_name', event.target.value)} /></div>
        <div><label>{t('Correo')}</label><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></div>
        <div><label>{t('Teléfono')}</label><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></div>
        <div><label>{t('Zona horaria')}</label><input placeholder="Eastern Time" value={form.timezone} onChange={(event) => update('timezone', event.target.value)} /></div>
        <div><label>{t('Estado')}</label><select value={form.status} onChange={(event) => update('status', event.target.value)}><option>ONBOARDING</option><option>A2P SUBMITTED</option><option>ADS LIVE</option></select></div>
        <div><label>{t('Presupuesto diario')}</label><input min="0" type="number" value={form.daily_budget} onChange={(event) => update('daily_budget', event.target.value)} /></div>
        <div className="wide"><label>{t('Servicios')}</label><textarea rows={form.services.length > 90 ? 3 : 1} value={form.services} onChange={(event) => update('services', event.target.value)} /></div>
        <div className="wide"><label>{t('Mercados')}</label><textarea rows={form.markets.length > 90 ? 3 : 1} value={form.markets} onChange={(event) => update('markets', event.target.value)} /></div>
        <div className="wide"><label>{t('Próxima acción')}</label><input required value={form.next_action} onChange={(event) => update('next_action', event.target.value)} /></div>
        {extraRows.length > 0 && <details className="wide pdf-extra" open>
          <summary>{t('También se guardará en el dossier')} ({extraRows.length})</summary>
          <dl>{extraRows.map(([key, value]) => <div key={key}><dt>{t(EXTRA_LABELS[key])}</dt><dd data-no-translate>{String(value)}</dd></div>)}</dl>
          <p className="muted">{t('Las respuestas completas del formulario quedan en "Notas originales del formulario".')}</p>
        </details>}
        <label className="auto-setup-option"><input type="checkbox" checked={autoSetup} onChange={(event) => setAutoSetup(event.target.checked)} /> <span>{t('Crear también el canal de Slack, la carpeta de Drive y el dossier en Google Docs')}</span></label>
        <button className="primary-button wide" disabled={saving || reading}>{saving ? t(savingStep || 'Guardando…') : t('Crear cliente')}</button>
      </form>
    </div>
  )
}
