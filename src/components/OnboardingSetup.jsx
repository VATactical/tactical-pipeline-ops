import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { runOnboardingSetup } from '../services/opsService'

const STEPS = [
  ['slack', 'Canal de Slack', 'slack_channel_link', 'Canal público c#-nombre, con el equipo invitado y el enlace a TP OPS.'],
  ['drive', 'Carpeta de Drive', 'drive_folder_link', 'Carpeta #C# Nombre con Images, Documents, VIDEOS y Ad Creatives.'],
  ['doc', 'Dossier en Google Docs', 'google_docs_url', 'Copia del dossier dentro de Documents.'],
]
const STATUS_TEXT = {
  created: 'Creado', linked: 'Vinculado', exists: 'Ya existía', skipped: 'Omitido', not_configured: 'Falta configurar', error: 'Error',
}

// "Onboarding con un clic": creates what the client is missing (Slack channel, Drive folder, dossier Doc).
export default function OnboardingSetup({ client, canEdit, dossierText, onDone, className = '' }) {
  const { t } = useLanguage()
  const [running, setRunning] = useState('')
  const [results, setResults] = useState({})
  const [error, setError] = useState('')
  const missing = STEPS.filter(([, , field]) => !String(client[field] || '').trim())
  if (client.archived) return null

  const run = async (steps) => {
    setRunning(steps.join(',')); setError('')
    try {
      const next = await runOnboardingSetup(client.id, { steps, dossierText })
      setResults((current) => ({ ...current, ...next }))
      await onDone?.()
    } catch (runError) {
      setError(t(runError.message))
    } finally {
      setRunning('')
    }
  }

  return <section className={`content-card onboarding-setup ${className}`}>
    <div className="section-heading">
      <div><p className="eyebrow">{t('Onboarding con un clic')}</p><h3>{missing.length ? t('Crea lo que le falta a este cliente') : t('Todo listo')}</h3>
        <p className="muted">{t('Cada paso guarda el enlace en el dossier. La tarjeta del tablero se crea sola con el cliente.')}</p></div>
      {canEdit && missing.length > 0 && <button className="primary-button" type="button" disabled={Boolean(running)} onClick={() => run(missing.map(([key]) => key))}>
        {running ? t('Creando…') : t('Crear lo que falta')}</button>}
    </div>
    <ul className="onboarding-steps">{STEPS.map(([key, label, field, help]) => {
      const url = String(client[field] || '').trim()
      const result = results[key]
      const state = url ? 'done' : result?.status === 'error' || result?.status === 'not_configured' ? 'problem' : 'pending'
      return <li key={key} className={state}>
        <span className="onboarding-step-icon" aria-hidden="true">{url ? '✓' : state === 'problem' ? '!' : '○'}</span>
        <div>
          <strong>{t(label)}</strong>
          <small>{url ? <a href={url} target="_blank" rel="noreferrer">{t('Abrir')} ↗</a> : t(help)}</small>
          {result && <small className={`onboarding-result ${result.status}`}>{t(STATUS_TEXT[result.status] || result.status)}{result.message ? ` · ${t(result.message)}` : ''}</small>}
        </div>
        {canEdit && !url && <button className="secondary-button compact-button" type="button" disabled={Boolean(running)} onClick={() => run([key])}>{running === key ? t('Creando…') : t('Crear')}</button>}
      </li>
    })}
      <li className="done"><span className="onboarding-step-icon" aria-hidden="true">✓</span><div><strong>{t('Tarjeta en el tablero')}</strong><small>{t('Se crea automáticamente al dar de alta al cliente.')}</small></div></li>
    </ul>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}
