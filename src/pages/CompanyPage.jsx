import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import { loadCompanySettings, saveCompanySettings, uploadCompanyLogo } from '../services/companyService'

export default function CompanyPage() {
  const { profile } = useAuth()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { loadCompanySettings().then(setForm).catch((e) => setError(e.message)) }, [])
  if (!form && !error) return <LoadingScreen />
  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const uploadLogo = async (event) => { const file = event.target.files?.[0]; if (!file) return; setSaving(true); setError(''); try { const logoUrl = await uploadCompanyLogo(file); setField('logo_url', logoUrl); setMessage('Logo cargado. Guarda los cambios para aplicarlo.') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  const submit = async (event) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { const saved = await saveCompanySettings(form, profile.id); setForm(saved); setMessage('Identidad de TP | Ops actualizada.'); window.dispatchEvent(new CustomEvent('company-settings-updated', { detail: saved })) } catch (e) { setError(e.message) } finally { setSaving(false) } }
  return <div className="page-stack compact-page"><header className="page-header"><div><p className="eyebrow">Superadmin</p><h2>Mi empresa</h2><p className="muted">Configura la identidad que aparece en la navegación, el footer y el navegador.</p></div></header>{error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}{form && <form className="content-card company-form" onSubmit={submit}><div className="company-logo-editor"><img src={form.logo_url || '/tp-logo.png'} alt="Logo actual" /><label className="secondary-button">Cambiar logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} hidden /></label><small>PNG, JPG o WebP · máximo 5 MB</small></div><div className="company-fields"><label>Nombre del sistema<input value={form.system_name} onChange={(e) => setField('system_name', e.target.value)} required /></label><label>Empresa<input value={form.company_name} onChange={(e) => setField('company_name', e.target.value)} required /></label><label>Correo empresarial<input type="email" value={form.company_email} onChange={(e) => setField('company_email', e.target.value)} /></label><label>Sitio web<input type="url" value={form.company_website} onChange={(e) => setField('company_website', e.target.value)} placeholder="https://…" /></label><button className="primary-button compact-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar empresa'}</button></div></form>}</div>
}
