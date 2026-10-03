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
  'Verificación del dossier',
  'Sincronización de onboarding',
  'Motivo del envío atrasado',
  'No puedes completar un campo vacío.',
  'Datos y accesos',
  'Configuración técnica',
  'Campaña lista',
  'Próximo paso',
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
const dashboardSource = readFileSync('src/pages/DashboardPage.jsx', 'utf8')
const adsSource = readFileSync('src/services/adsReportService.js', 'utf8')
if (!eodSource.includes('replace_eod_time_entries')) violations.push('EOD must persist weekly manual time atomically.')
if (!dashboardSource.includes('markGeneralNoteSeen') || !dashboardSource.includes('convertGeneralNoteToTask')) violations.push('Communications must support seen receipts and task conversion.')
if (!adsSource.includes('ad_performance_reports')) violations.push('Client follow-up must persist dated ADS reports.')


const clientOpsSource = readFileSync('src/components/ClientOpsPanel.jsx', 'utf8')
const onboardingSource = readFileSync('supabase/functions/ghl-onboarding/index.ts', 'utf8')
const lifecycleMigration = readdirSync('supabase/migrations').filter((name) => name.includes('client_ops_lifecycle_followups')).map((name) => readFileSync(join('supabase/migrations', name), 'utf8')).join('\n')
if (!clientOpsSource.includes('client_field_verifications') || !clientOpsSource.includes('verified_by')) violations.push('Client dossier verification must save status, actor, and time.')
if (!clientOpsSource.includes('client_interactions') || !clientOpsSource.includes('next_follow_up_at')) violations.push('Client contact logs must support an owner and next follow-up.')
if (!onboardingSource.includes('target_zip_codes: payloadValue(payload, "target_zip_codes"')) violations.push('Onboarding must map ZIP codes separately from service areas.')
if (!onboardingSource.includes('attempt_count') || !onboardingSource.includes('sync_stage')) violations.push('Onboarding sync must keep retry and stage details.')
if (!lifecycleMigration.includes('reassign_client_code') || !lifecycleMigration.includes('client_code_history')) violations.push('Visible client-code changes must keep a history and stable client IDs.')
if (!lifecycleMigration.includes('require_eod_late_reason')) violations.push('Database must require a reason for a late EOD.')
if (!eodSource.includes("DEFAULT_KEVIN_TIME_ZONE = 'America/New_York'") || !eodSource.includes('late_reason: cleanLateReason')) violations.push('EOD must use New York time and persist late reasons.')
if (!taskProgressServiceSource.includes('next_step: nextStep.trim()')) violations.push('Tasks must persist a next step.')
const clientDetailSource = readFileSync('src/pages/ClientDetailPage.jsx', 'utf8')
if (!clientDetailSource.includes('showAllWorkflowSteps') || !clientDetailSource.includes('visibleWorkflowSteps')) violations.push('Client workflow must focus on the current stage and allow opening the full checklist.')

if (violations.length) {
  console.error('Bilingual QA failed:\n' + violations.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log(`Bilingual QA passed for ${sourceFiles.length} source files.`)
