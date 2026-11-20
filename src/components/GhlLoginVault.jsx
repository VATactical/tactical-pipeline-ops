import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { loadGhlLoginStatus, revealGhlLogin, saveGhlLogin } from '../services/opsService'

// Client's GHL / LeadConnector login (email + password) in the credential vault.
// Everyone sees whether it is saved; only Superadmin or people with the "sensitive credentials"
// permission can view or change it, and every view is logged. It never goes into the dossier,
// PDF, Google Docs, notes or search.
const HIDE_AFTER_MS = 60000

export default function GhlLoginVault({ clientId, archived }) {
  const { profile } = useAuth()
  const { t, locale } = useLanguage()
  const canUse = profile?.role === 'superadmin' || Boolean(profile?.permissions?.sensitive_credentials_view)
  const [status, setStatus] = useState(null)
  const [revealed, setRevealed] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const reload = useCallback(async () => {
    try { setStatus(await loadGhlLoginStatus(clientId)) } catch (loadError) { setError(t(loadError.message)) }
  }, [clientId, t])
  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if (!revealed) return undefined
    const timer = window.setTimeout(() => { setRevealed(null); setShowPassword(false) }, HIDE_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [revealed])

  const reveal = async () => {
    setBusy(true); setError('')
    try { setRevealed(await revealGhlLogin(clientId)) } catch (revealError) { setError(t(revealError.message)) }
    finally { setBusy(false) }
  }
  const startEdit = async () => {
    setBusy(true); setError('')
    try {
      const current = status?.saved ? await revealGhlLogin(clientId) : { email: '', password: '' }
      setDraft({ email: current.email || '', password: current.password || '' })
      setEditing(true); setRevealed(null)
    } catch (editError) { setError(t(editError.message)) }
    finally { setBusy(false) }
  }
  const save = async (event) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await saveGhlLogin(clientId, draft)
      setEditing(false); setDraft({ email: '', password: '' }); setShowPassword(false)
      await reload()
    } catch (saveError) { setError(t(saveError.message)) }
    finally { setBusy(false) }
  }
  const copy = async (label, value) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
  }
  const when = status?.updated_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.updated_at)) : ''

  return <section className="content-card credential-vault client-tab-section tab-dossier">
    <div className="section-heading">
      <div><p className="eyebrow">{t('Bóveda de credenciales')}</p><h3>{t('Acceso GHL / LeadConnector del cliente')}</h3>
        <p className="muted">{t('Correo y contraseña con los que el cliente entra a GHL y a la app LeadConnector. No se incluye en el dossier, PDF, Google Docs ni búsquedas.')}</p></div>
      <span className={`credential-state ${status?.saved ? '' : 'empty'}`}>{status?.saved ? t('Guardado') : t('Sin guardar')}</span>
    </div>
    {status?.saved && when && <p className="muted credential-meta">{t('Actualizado')} {when}{status.updated_by ? <> · <span data-no-translate>{status.updated_by}</span></> : null}</p>}
    {!canUse
      ? <p className="credential-restricted">{t('Acceso restringido. Un administrador puede habilitar el permiso individual desde Usuarios.')}</p>
      : <div className="credential-controls">
        {revealed && !editing && <div className="credential-value ghl-login-value">
          <div><span>{t('Correo')}</span><code data-no-translate>{revealed.email || '—'}</code>{revealed.email && <button type="button" className="text-button" onClick={() => copy('email', revealed.email)}>{copied === 'email' ? t('Copiado') : t('Copiar')}</button>}</div>
          <div><span>{t('Contraseña')}</span><code data-no-translate>{showPassword ? (revealed.password || '—') : '••••••••••'}</code>
            <button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t('Ocultar') : t('Mostrar')}</button>
            {revealed.password && <button type="button" className="text-button" onClick={() => copy('password', revealed.password)}>{copied === 'password' ? t('Copiado') : t('Copiar')}</button>}</div>
          <small className="muted">{t('Se oculta solo en 1 minuto.')}</small>
        </div>}
        {!editing && <span className="section-actions">
          {status?.saved && !revealed && <button type="button" className="secondary-button compact-button" disabled={busy} onClick={reveal}>{t('Ver acceso')}</button>}
          {revealed && <button type="button" className="secondary-button compact-button" onClick={() => { setRevealed(null); setShowPassword(false) }}>{t('Ocultar')}</button>}
          {!archived && <button type="button" className="primary-button compact-button" disabled={busy} onClick={startEdit}>{status?.saved ? t('Editar') : t('Agregar acceso')}</button>}
        </span>}
        {editing && <form className="credential-editor" onSubmit={save} autoComplete="off">
          <label>{t('Correo de acceso')}<input type="email" required maxLength={320} autoComplete="off" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
          <label>{t('Contraseña')}<span className="ghl-password-input">
            <input type={showPassword ? 'text' : 'password'} required maxLength={200} autoComplete="new-password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            <button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t('Ocultar') : t('Mostrar')}</button>
          </span></label>
          <div className="section-actions">
            <button type="button" className="secondary-button compact-button" disabled={busy} onClick={() => { setEditing(false); setDraft({ email: '', password: '' }); setShowPassword(false) }}>{t('Cancelar')}</button>
            <button className="primary-button compact-button" disabled={busy}>{busy ? t('Guardando…') : t('Guardar')}</button>
          </div>
        </form>}
      </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
