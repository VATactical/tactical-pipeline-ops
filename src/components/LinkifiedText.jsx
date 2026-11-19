import { useLanguage } from '../i18n/LanguageContext'

// Shows text with its links clickable and short: Google Drive, Docs, Sheets, Slack, Frame.io…
// get a readable label; any other link shows its domain and a short path. The full URL stays in
// the tooltip and opens in a new tab.

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g
const TRAILING = /[).,;:!?\]]+$/

const GOOGLE_LABELS = [
  [/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//, '📁 Carpeta de Drive'],
  [/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?)/, '📎 Archivo de Drive'],
  [/docs\.google\.com\/document\//, '📄 Google Doc'],
  [/docs\.google\.com\/spreadsheets\//, '📊 Google Sheet'],
  [/docs\.google\.com\/presentation\//, '📽️ Google Slides'],
  [/docs\.google\.com\/forms\/|forms\.gle\//, '📝 Google Form'],
  [/(?:maps\.app\.goo\.gl|g\.page|google\.com\/maps|business\.google\.com)/, '📍 Google Maps / GBP'],
  [/meet\.google\.com\//, '🎥 Google Meet'],
]
const OTHER_LABELS = [
  [/slack\.com\/archives\//, '💬 Mensaje de Slack'],
  [/frame\.io\//, '🎬 Frame.io'],
  [/loom\.com\//, '🎥 Loom'],
  [/(?:youtube\.com|youtu\.be)\//, '▶️ YouTube'],
  [/trello\.com\/c\//, '🗂️ Tarjeta de Trello'],
  [/canva\.com\//, '🎨 Canva'],
]

export function linkLabel(url) {
  for (const [pattern, label] of [...GOOGLE_LABELS, ...OTHER_LABELS]) if (pattern.test(url)) return label
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '')
    if (!path) return host
    const label = `${host}${path.length > 24 ? `${path.slice(0, 22)}…` : path}`
    return label.length > 42 ? `${label.slice(0, 40)}…` : label
  } catch {
    return url.length > 50 ? `${url.slice(0, 47)}…` : url
  }
}

export default function LinkifiedText({ text, className = '', as: Tag = 'p' }) {
  const { t } = useLanguage()
  if (!text) return null
  const parts = String(text).split(URL_PATTERN)
  return <Tag className={className} data-no-translate>{parts.map((part, index) => {
    if (index % 2 === 0) return <span key={index}>{part}</span>
    const trailing = part.match(TRAILING)?.[0] || ''
    const url = trailing ? part.slice(0, -trailing.length) : part
    return <span key={index}><a className="smart-link" href={url} target="_blank" rel="noreferrer" title={url}>{t(linkLabel(url))}</a>{trailing}</span>
  })}</Tag>
}
