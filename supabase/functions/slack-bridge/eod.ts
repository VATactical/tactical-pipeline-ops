// Turns an EOD posted in Slack into plain text for TP OPS and finds the day it reports on.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1, feb: 2, february: 2, febrero: 2, mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, june: 6, junio: 6, jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8, sep: 9, sept: 9, september: 9, septiembre: 9, set: 9, oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11, dec: 12, december: 12, dic: 12, diciembre: 12,
};

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Slack markup -> readable text: links keep the URL, mentions become @Name, bold/italic marks go away.
export function eodPlainText(raw: string, names: Map<string, string>) {
  return decode(raw
    .replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, (_all, url, label) => (label && label !== url ? `${label} (${url})` : url))
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_all, id, label) => `@${label || names.get(id) || id}`)
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1"))
    .replace(/(^|[\s(])[*_~]+(?=\S)|(?<=\S)[*_~]+(?=$|[\s).,:;!?])/gm, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const iso = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
};

// Date of the message in the author's time zone (YYYY-MM-DD).
export function localDay(at: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

// The report day written in the first lines ("EOD Report – Aryan Umair – November 13, 2026", "Oct 31",
// "13 de noviembre"), otherwise the day the message was posted. A date more than 2 days after the
// message or more than 10 days before it is ignored.
export function reportDay(text: string, postedAt: Date, timeZone: string) {
  const posted = localDay(postedAt, timeZone);
  const postedYear = Number(posted.slice(0, 4));
  const head = text.split("\n").slice(0, 3).join(" ");
  const candidates: (string | null)[] = [];
  for (const match of head.matchAll(/\b([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g)) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) candidates.push(iso(Number(match[3] || postedYear), month, Number(match[2])));
  }
  for (const match of head.matchAll(/\b(\d{1,2})\s+(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?(?:,?\s+(?:de\s+)?(\d{4}))?\b/g)) {
    const month = MONTHS[match[2].toLowerCase()];
    if (month) candidates.push(iso(Number(match[3] || postedYear), month, Number(match[1])));
  }
  for (const match of head.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) candidates.push(iso(Number(match[1]), Number(match[2]), Number(match[3])));
  for (const match of head.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : postedYear;
    candidates.push(iso(year, Number(match[1]), Number(match[2])));
  }
  const postedTime = Date.parse(`${posted}T00:00:00Z`);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const days = (Date.parse(`${candidate}T00:00:00Z`) - postedTime) / 86400000;
    if (days <= 2 && days >= -10) return { day: candidate, fromText: true };
  }
  return { day: posted, fromText: false };
}
