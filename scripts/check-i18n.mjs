import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const sourceFiles = []
function collect(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name)
    if (statSync(file).isDirectory()) collect(file)
    else if (/\.(js|jsx)$/.test(name)) sourceFiles.push(file)
  }
}
collect('src')

const violations = []
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8')
  if (!file.endsWith('LanguageContext.jsx') && /Intl\.DateTimeFormat\(['"]es(?:-NI)?['"]/.test(source)) {
    violations.push(`${file}: uses a fixed Spanish locale; use the locale from useLanguage().`)
  }
  if (/window\.confirm\(\s*['"]/.test(source)) {
    violations.push(`${file}: contains an untranslated window.confirm() literal; wrap it with t().`)
  }
}

const languageSource = readFileSync('src/i18n/LanguageContext.jsx', 'utf8')
const dictionaryKeys = [...languageSource.matchAll(/^\s*'((?:\\'|[^'])+)'\s*:/gm)].map((match) => match[1])
const duplicateKeys = [...new Set(dictionaryKeys.filter((key, index) => dictionaryKeys.indexOf(key) !== index))]
for (const key of duplicateKeys) violations.push(`Duplicate translation key: ${key}`)

const criticalPhrases = [
  'Centro de revisión diaria',
  'Cumplimiento EOD',
  'Trabajando después de las 8 PM',
  'Verificando EOD…',
  'Archivar cliente',
  'Bóveda de credenciales',
  'Formulario del cliente recibido',
  '¿Eliminar este módulo y sus lecciones?',
  'Todos los usuarios',
  'Título (ES)',
  'Control del cliente',
  'Estado de plataformas',
  'Cambiar estado',
  'Acceso a GoHighLevel',
  'Método de pago en GHL',
  'Sincronización de onboarding',
  'Motivo del envío atrasado',
  'Datos y accesos',
  'Configuración técnica',
  'Campaña lista',
  'Próximo paso',
  'Puntuación del 1 al 5',
]
for (const phrase of criticalPhrases) {
  if (!languageSource.includes(`'${phrase}':`)) violations.push(`Missing critical English translation: ${phrase}`)
}

const taskProgressSource = readFileSync('src/pages/TasksPage.jsx', 'utf8')
const taskProgressServiceSource = readFileSync('src/services/opsService.js', 'utf8')
if (!taskProgressSource.includes('updateTaskProgress')) violations.push('TasksPage must save status notes with task progress.')
if (!taskProgressServiceSource.includes('status_note')) violations.push('Task progress updates must persist status_note.')

const trainingSource = readFileSync('src/pages/TrainingPage.jsx', 'utf8')
if (!trainingSource.includes("localize(module, 'title')") || !trainingSource.includes("localize(item, 'title')")) {
  violations.push('TrainingPage must render bilingual module and lesson titles.')
}

const trainingServiceSource = readFileSync('src/services/trainingService.js', 'utf8')
if (!trainingServiceSource.includes('title_es:') || !trainingServiceSource.includes('title_en:')) {
  violations.push('trainingService must save Spanish and English content separately.')
}

const tasksSource = readFileSync('src/pages/TasksPage.jsx', 'utf8')
const opsServiceSource = readFileSync('src/services/opsService.js', 'utf8')
if (!tasksSource.includes("supabase.rpc('get_team_directory')") || !opsServiceSource.includes('assigned_to:')) {
  violations.push('Tasks must support assignment to individual active team members.')
}
if (!tasksSource.includes('updateTaskDetails')) {
  violations.push('Tasks must keep the full edit workflow available to operations admins.')
}

const eodSource = readFileSync('src/services/eodService.js', 'utf8')
const eodPageSource = readFileSync('src/pages/EodReportsPage.jsx', 'utf8')
if (!eodPageSource.includes('productivityScore) <= 5') || !eodPageSource.includes('Array.from({ length: 5 }') || !eodPageSource.includes("+ '/5'")) violations.push('EOD productivity score must be limited and displayed from 1 to 5.')
if (!eodSource.includes('Number(productivityScore) > 5')) violations.push('EOD save must reject productivity scores above 5.')
const dashboardSource = readFileSync('src/pages/DashboardPage.jsx', 'utf8')
const adsSource = readFileSync('src/services/adsReportService.js', 'utf8')
if (!eodSource.includes('replace_eod_time_entries')) violations.push('EOD must persist weekly manual time atomically.')
if (!dashboardSource.includes('markGeneralNoteSeen') || !dashboardSource.includes('loadTicketWorkspace') || dashboardSource.includes('convertGeneralNoteToTask')) violations.push('Dashboard communications must support seen receipts and ticket follow-up, without converting notes into tasks.')
if (!adsSource.includes('ad_performance_reports')) violations.push('Client follow-up must persist dated ADS reports.')


const clientOpsSource = readFileSync('src/components/ClientOpsPanel.jsx', 'utf8')
const clientDetailSource = readFileSync('src/pages/ClientDetailPage.jsx', 'utf8')
const onboardingSource = readFileSync('supabase/functions/ghl-onboarding/index.ts', 'utf8')
const lifecycleMigration = readdirSync('supabase/migrations').filter((name) => name.includes('client_ops_lifecycle_followups')).map((name) => readFileSync(join('supabase/migrations', name), 'utf8')).join('\n')
if (clientOpsSource.includes('client_field_verifications')) violations.push('Client operations must not render the confusing per-field verification panel.')
if (clientOpsSource.includes('client_interactions') || clientOpsSource.includes('client-contact-summary') || !clientOpsSource.includes('ghl_form_imports')) violations.push('Client operations must omit the manual contact log while retaining onboarding sync history.')
if (!clientDetailSource.includes('savePlatformStatus') || !['gbp_access_confirmed', 'meta_payment_method_confirmed', 'payment_method_confirmed'].every((field) => clientDetailSource.includes(field))) violations.push('Client dossier must expose editable GBP access and Meta/GHL payment statuses.')
if (!onboardingSource.includes('target_zip_codes: value(payload, "target_zip_codes"') || !onboardingSource.includes('markets: value(payload, "service_areas"')) violations.push('Onboarding must map ZIP codes separately from service areas.')
if (!clientDetailSource.includes("'contact_email'") || !onboardingSource.includes('contact_email: value(payload, "contact_email"') || !readFileSync('src/lib/dossierExport.js', 'utf8').includes('client.contact_email')) violations.push('Client contact email must be separate from the business email in the dossier and export.')
if (onboardingSource.includes('payment_method_confirmed: booleanValue') || onboardingSource.includes('meta_campaign_live: booleanValue')) violations.push('Operations-confirmed payment and campaign status must not be imported from the onboarding form.')
const dossierExportSource = readFileSync('src/lib/dossierExport.js', 'utf8')
const onboardingFieldsMigration = readdirSync('supabase/migrations').filter((name) => name.includes('onboarding_dossier_details')).map((name) => readFileSync(join('supabase/migrations', name), 'utf8')).join('\n')
const newOnboardingFields = ['onboarding_call_language', 'appointment_availability', 'website_build_request', 'website_timeline', 'instagram_needed', 'timezone_verified']
for (const field of newOnboardingFields) {
  if (!clientDetailSource.includes(`'${field}'`)) violations.push(`Client dossier is missing the ${field} field.`)
  if (field !== 'timezone_verified' && !onboardingSource.includes(`${field}:`)) violations.push(`Onboarding sync is missing the ${field} mapping.`)
}
if (!onboardingSource.includes('daily_budget: dailyBudget')) violations.push('Onboarding must leave a missing daily budget as zero/Pending instead of applying the database default.')
for (const field of newOnboardingFields) {
  if (!onboardingFieldsMigration.includes(`add column if not exists ${field}`)) violations.push(`Migration is missing the ${field} column.`)
  if (!dossierExportSource.includes(`client.${field}`)) violations.push(`English dossier export is missing the ${field} field.`)
}
if (!onboardingSource.includes('attempt_count') || !onboardingSource.includes('sync_stage')) violations.push('Onboarding sync must keep retry and stage details.')
if (!lifecycleMigration.includes('reassign_client_code') || !lifecycleMigration.includes('client_code_history')) violations.push('Visible client-code changes must keep a history and stable client IDs.')
if (!lifecycleMigration.includes('require_eod_late_reason')) violations.push('Database must require a reason for a late EOD.')
if (!eodSource.includes("DEFAULT_KEVIN_TIME_ZONE = 'America/New_York'") || !eodSource.includes('late_reason: cleanLateReason')) violations.push('EOD must use New York time and persist late reasons.')
if (!taskProgressServiceSource.includes('next_step: nextStep.trim()')) violations.push('Tasks must persist a next step.')
if (!clientDetailSource.includes('showAllWorkflowSteps') || !clientDetailSource.includes('visibleWorkflowSteps')) violations.push('Client workflow must focus on the current stage and allow opening the full checklist.')

if (violations.length) {
  console.error('Bilingual QA failed:\n' + violations.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log(`Bilingual QA passed for ${sourceFiles.length} source files.`)
