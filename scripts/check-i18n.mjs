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
]
for (const phrase of criticalPhrases) {
  if (!languageSource.includes(`'${phrase}':`)) violations.push(`Missing critical English translation: ${phrase}`)
}

if (violations.length) {
  console.error('Bilingual QA failed:\n' + violations.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}

console.log(`Bilingual QA passed for ${sourceFiles.length} source files.`)
