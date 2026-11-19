// Finds dossier values in a Slack message written by the team in a client channel.
// Only clear patterns are used; every result is a suggestion that a person approves in TOPS.

export type DossierField =
  | "meta_pixel_id" | "meta_ad_account_id" | "meta_business_portfolio_id" | "landing_page_url" | "website_url"
  | "facebook_page_url" | "instagram_url" | "gbp_link" | "drive_folder_link" | "google_docs_url" | "make_scenario_link"
  | "retell_agent_id" | "daily_budget" | "targeting_radius_miles" | "ads_targeting_address";

export type Found = { field: DossierField; value: string };

// Links that are never a dossier value (calls, files, Slack itself, TOPS, video review...).
const IGNORED_HOSTS = /(^|\.)(slack\.com|meet\.google\.com|zoom\.us|frame\.io|loom\.com|calendly\.com|tacticalpipeline\.com|youtube\.com|youtu\.be|tiktok\.com|wa\.me|whatsapp\.com|leadconnectorhq\.com|gohighlevel\.com|retellai\.com|canva\.com|capcut\.com|figma\.com|notion\.so|trello\.com|airtable\.com|dropbox\.com|wetransfer\.com|vimeo\.com|imgur\.com|bit\.ly)$/i;

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Slack markup "<https://x|label>" and "<https://x>" -> the URL; mentions are dropped.
export function plainText(raw: string) {
  return decode(raw
    .replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, " $1 ")
    .replace(/<(https?:\/\/[^>]+)>/g, " $1 ")
    .replace(/<[@#!][^>]*>/g, " "));
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

// Long numbers are Meta IDs; the nearest keyword before/after the number says which one.
const ID_KEYWORDS: [DossierField, RegExp][] = [
  ["meta_pixel_id", /pixel|dataset/i],
  ["meta_ad_account_id", /ad\s*account|ads\s*account|act_|ad\s*acc\b|cuenta\s*publicitaria/i],
  ["meta_business_portfolio_id", /business\s*(portfolio|manager|id)|portfolio|\bBM\b|\bBP\b/i],
];

function idField(text: string, index: number, length: number): DossierField | null {
  // Look only between this number and its neighbours, so "ad account 1… and BM 2…" stays apart.
  let before = text.slice(Math.max(0, index - 45), index);
  before = before.slice(before.search(/\d{6,}(?!.*\d{6,})/) >= 0 ? before.search(/\d{6,}(?!.*\d{6,})/) : 0).replace(/^\d+/, "");
  let after = text.slice(index + length, index + length + 45);
  const next = after.search(/\d{6,}/);
  if (next >= 0) after = after.slice(0, next);
  let best: { field: DossierField; distance: number } | null = null;
  for (const [field, pattern] of ID_KEYWORDS) {
    for (const match of before.matchAll(new RegExp(pattern.source, "gi"))) {
      const distance = before.length - (match.index ?? 0);
      if (!best || distance < best.distance) best = { field, distance };
    }
  }
  if (best) return best.field;
  for (const [field, pattern] of ID_KEYWORDS) {
    const first = after.search(pattern);
    if (first >= 0 && (!best || first < best.distance)) best = { field, distance: first };
  }
  return best?.field ?? null;
}

export function extractDossierValues(raw: string): Found[] {
  const text = plainText(raw);
  const found: Found[] = [];
  const add = (field: DossierField, value: string) => {
    const clean = value.trim();
    if (clean && !found.some((item) => item.field === field && item.value === clean)) found.push({ field, value: clean });
  };

  // Meta IDs.
  for (const match of text.matchAll(/act_(\d{10,20})\b/gi)) add("meta_ad_account_id", match[1]);
  for (const match of text.matchAll(/(?<![\d/=.])(\d{14,17})(?![\d/])/g)) {
    const field = idField(text, match.index ?? 0, match[0].length);
    if (field) add(field, match[1]);
  }

  // Retell agent.
  for (const match of text.matchAll(/\b(agent_[a-z0-9]{16,40})\b/gi)) add("retell_agent_id", match[1]);

  // Daily budget: "$50 a day", "$50/day", "daily budget $50", "budget: 50 per day".
  const budget = text.match(/\$\s?(\d{1,5}(?:\.\d{1,2})?)\s*(?:usd\s*)?(?:\/\s*day|a\s*day|per\s*day|daily|al\s*d[ií]a|diarios?)/i)
    || text.match(/daily\s*(?:ad\s*)?(?:budget|spend|spent)\D{0,15}\$?\s?(\d{1,5}(?:\.\d{1,2})?)/i)
    || text.match(/presupuesto\s*diario\D{0,15}\$?\s?(\d{1,5}(?:\.\d{1,2})?)/i);
  if (budget && Number(budget[1]) >= 5 && Number(budget[1]) <= 5000) add("daily_budget", String(Number(budget[1])));

  // Radius: "15 mile radius", "radius of 20 miles". When a message names several distances
  // ("from 15 miles to 7 mile radius", "8-10 miles") only the one written right before "radius" counts.
  const miles = new Set([...text.matchAll(/(\d{1,3})\s*-?\s*(?:mi|miles?|millas?)\b/gi)].map((match) => Number(match[1])));
  const tight = text.match(/(\d{1,3})\s*-?\s*(?:mi|miles?|millas?)\s+radi(?:us|o)/i)
    || text.match(/radi(?:us|o)\s+(?:of\s+|de\s+)?(\d{1,3})\s*(?:mi|miles?|millas?)\b/i);
  const radius = tight ? Number(tight[1]) : (miles.size === 1 && /radi(?:us|o)/i.test(text) ? [...miles][0] : 0);
  if (radius >= 1 && radius <= 500) add("targeting_radius_miles", String(radius));

  // US street address with state and ZIP: "246 Plain St, Brockton, MA 02302".
  const address = text.match(/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,5}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway|Pkwy|Parkway|Ter|Terrace|Cir|Circle|Sq|Square|Trl|Trail)\.?(?:,?\s*(?:Suite|Ste|Unit|Apt|#)\s*[\w-]+)?,?\s+[A-Za-z .'-]{2,40},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/);
  if (address) add("ads_targeting_address", address[0].replace(/\s+/g, " "));

  // Links.
  const mentionsLanding = /landing|\blp\b|funnel|lead\s*form page/i.test(text);
  const mentionsWebsite = /website|web\s*site|\bsite\b|sitio|p[aá]gina web/i.test(text);
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'|]+/g)) {
    const url = match[0].replace(/[).,;:!?]+$/, "");
    const host = hostOf(url);
    if (!host || IGNORED_HOSTS.test(host)) continue;
    if (host === "drive.google.com") { if (/\/folders\//.test(url)) add("drive_folder_link", url); continue; }
    if (host === "docs.google.com") { if (/\/document\//.test(url)) add("google_docs_url", url); continue; }
    if (/(^|\.)make\.com$/.test(host)) { if (/scenarios?\//.test(url)) add("make_scenario_link", url); continue; }
    if (host === "g.page" || host === "maps.app.goo.gl" || host === "business.google.com" || host === "share.google"
      || (/(^|\.)google\.com$/.test(host) && /\/maps\b/.test(url))) { add("gbp_link", url); continue; }
    if (/(^|\.)google\.com$/.test(host) || host === "goo.gl") continue;
    if (/(^|\.)instagram\.com$/.test(host)) { add("instagram_url", url); continue; }
    if (/(^|\.)(facebook\.com|fb\.com)$/.test(host)) {
      if (!/business\.facebook|adsmanager|\/ads\/|events_manager|\/business\/|\/settings|\/billing|\/share\/|\/groups\//i.test(url)) add("facebook_page_url", url);
      continue;
    }
    if (/(^|\.)mylocalestimate\.com$/.test(host) || mentionsLanding) { add("landing_page_url", url); continue; }
    if (mentionsWebsite) add("website_url", url);
  }
  return found;
}

// Same value? (case, protocol, "www." and trailing slash do not matter; numbers compare as numbers)
export function sameValue(field: DossierField, a: unknown, b: unknown) {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();
  if (field === "daily_budget" || field === "targeting_radius_miles") return left !== "" && Number(left) === Number(right);
  const norm = (value: string) => value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").replace(/\s+/g, " ");
  return norm(left) === norm(right);
}

// Is the current dossier value a real one? Placeholders ("N/A", "Needs one", "0", a bare Drive URL) are not.
export function hasRealValue(field: DossierField, value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || /^(n\/?a|na|none|pending|pendiente|tbd|-|0|0\.00)$/i.test(text)) return false;
  if (field === "daily_budget") return Number(text) > 0;
  if (field.endsWith("_url") || field.endsWith("_link")) {
    if (!/^https?:\/\//i.test(text)) return false;
    if (field === "drive_folder_link") return /\/folders\//.test(text);
  }
  return true;
}

// Links that can point at many sub-items (Drive folders, Docs, Make): only suggest when the dossier has none.
export const ONLY_WHEN_EMPTY = new Set<DossierField>(["drive_folder_link", "google_docs_url", "make_scenario_link"]);
