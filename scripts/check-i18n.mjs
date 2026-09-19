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

if (violations.length) {
  console.error('Bilingual QA failed:\n' + violations.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log(`Bilingual QA passed for ${sourceFiles.length} source files.`)
