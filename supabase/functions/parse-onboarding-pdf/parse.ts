// Reads the GHL "Client Onboarding Form" submission PDF and maps it to client dossier fields.
//
// The PDF is a two-column table: the question on the left, the answer on the right. Answers are
// vertically centred on their question, so a long answer can start above the question's first line.
// Text items are grouped into lines, each line split into the question part (left column) and the
// answer part (right column); answer blocks are then attached to the question block they overlap.

export type TextItem = { str: string; x: number; y: number; width: number; height: number; page: number };
export type Pair = { label: string; value: string };

type Line = { page: number; y: number; height: number; left: string; right: string };

export function buildLines(items: TextItem[]): Line[] {
  const real = items.filter((item) => item.str.trim());
  if (!real.length) return [];
  const minX = Math.min(...real.map((item) => item.x));
  const rows: { page: number; y: number; height: number; items: TextItem[] }[] = [];
  for (const item of [...real].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) < Math.max(2, item.height * 0.45));
    if (row) row.items.push(item); else rows.push({ page: item.page, y: item.y, height: item.height || 10, items: [item] });
  }
  return rows.map((row) => {
    const sorted = row.items.sort((a, b) => a.x - b.x)
    let left = ""
    let right = ""
    for (const item of sorted) {
      // Answers start well to the right of the question column.
      if (item.x >= minX + 110) right += (right && !right.endsWith(" ") ? " " : "") + item.str
      else left += (left && !left.endsWith(" ") ? " " : "") + item.str
    }
    return { page: row.page, y: row.y, height: row.height, left: left.replace(/\s+/g, " ").trim(), right: right.replace(/\s+/g, " ").trim() }
  }).sort((a, b) => a.page - b.page || b.y - a.y);
}

type Block = { page: number; top: number; bottom: number; lines: string[] };

function blocks(lines: Line[], side: "left" | "right"): Block[] {
  const result: Block[] = [];
  for (const line of lines) {
    const text = line[side];
    if (!text) continue;
    const last = result[result.length - 1];
    // Same block when the next line follows closely (wrapped text).
    if (last && last.page === line.page && last.bottom - line.y <= line.height * 1.7) {
      last.lines.push(text);
      last.bottom = line.y;
    } else {
      result.push({ page: line.page, top: line.y, bottom: line.y, lines: [text] });
    }
  }
  return result;
}

const joinLines = (lines: string[]) => lines.reduce((text, line) => {
  if (!text) return line;
  // Re-join words and URLs that the PDF wrapped with a hyphen ("roofing-" + "contractor").
  if (/[-/]$/.test(text) && /^\S/.test(line) && /https?:\/\/\S*$/.test(text)) return text + line;
  return `${text} ${line}`;
}, "");

export function extractPairs(items: TextItem[]): { pairs: Pair[]; submittedAt: string } {
  const lines = buildLines(items);
  let submittedAt = "";
  const body: Line[] = [];
  for (const line of lines) {
    const text = `${line.left} ${line.right}`.trim();
    if (/^Form Submission\b/i.test(line.left)) { submittedAt = line.right || text.replace(/^Form Submission\s*/i, ""); continue; }
    if (/^Text$/i.test(line.left) && /onboarding form/i.test(line.right)) continue;
    body.push(line);
  }
  // A question whose text continues at the top of the next page is one question.
  const questions: Block[] = [];
  for (const block of blocks(body, "left")) {
    const previous = questions[questions.length - 1];
    const firstOnPage = !questions.some((question) => question.page === block.page);
    if (previous && firstOnPage && previous.page === block.page - 1 && !questionKey(joinLines(block.lines))) {
      previous.lines.push(...block.lines);
      continue;
    }
    questions.push(block);
  }
  const answers = blocks(body, "right");
  const values = new Map<Block, string[]>();
  for (const answer of answers) {
    const center = (answer.top + answer.bottom) / 2;
    let best: Block | null = null;
    let bestDistance = Infinity;
    for (const question of questions) {
      if (question.page !== answer.page) continue;
      const distance = center > question.top ? center - question.top : center < question.bottom ? question.bottom - center : 0;
      if (distance < bestDistance) { best = question; bestDistance = distance; }
    }
    // An answer that runs past the end of a page continues above the first question of the next page.
    const firstQuestion = questions.find((question) => question.page === answer.page);
    if (firstQuestion && answer.bottom > firstQuestion.top && bestDistance > 0) {
      const previous = [...questions].reverse().find((question) => question.page < answer.page);
      if (previous) best = previous;
    }
    if (best) values.set(best, [...(values.get(best) || []), ...answer.lines]);
  }
  const pairs: Pair[] = [];
  for (const question of questions) {
    const pair = { label: joinLines(question.lines), value: joinLines(values.get(question) || []) };
    // A stray piece of a wrapped question (no answer, not a known question) belongs to the previous one.
    if (!pair.value && !questionKey(pair.label) && pairs.length) { pairs[pairs.length - 1].label += ` ${pair.label}`; continue; }
    pairs.push(pair);
  }
  return { pairs, submittedAt };
}

const URL_PATTERN = /https?:\/\/[^\s]+/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const empty = (value: string) => !value || /^(n\/?a|none|no|not needed|not available|-|null)$/i.test(value.trim());
const firstUrl = (value: string) => value.match(URL_PATTERN)?.[0].replace(/[).,;]+$/, "") || "";

// Question text (normalized) -> what it is.
const QUESTIONS: [RegExp, string][] = [
  [/^first name/, "first_name"], [/^last name/, "last_name"], [/^(full )?name$/, "full_name"],
  [/^business phone/, "business_phone"], [/^phone/, "phone"],
  [/^business email/, "business_email"], [/^email/, "email"],
  [/registered business name|business name/, "business_name"],
  [/^ads targeting address/, "ads_targeting_address"],
  [/^address/, "address"], [/^city$/, "city"], [/^state$/, "state"], [/^country$/, "country"], [/^postal code|^zip/, "postal_code"],
  [/language.*onboarding call|onboarding call.*language/, "language"],
  [/website link/, "website"],
  [/discounts|packages|special deals/, "offer"],
  [/cities or regions|zip codes/, "markets"],
  [/google business profile/, "gbp"],
  [/all services/, "services"],
  [/facebook/, "facebook"],
  [/instagram/, "instagram"],
  [/anything else we should know/, "notes"],
  [/^timezone|time zone/, "timezone"],
  [/^ip address/, "ip"],
  [/upload any brand photos/, "upload"],
];

export function questionKey(label: string) {
  const normalized = label.toLowerCase().replace(/[.:?]+/g, " ").replace(/\s+/g, " ").trim();
  return QUESTIONS.find(([pattern]) => pattern.test(normalized))?.[1] || "";
}

// Dossier fields for a new client, plus the readable Q&A kept as the original form notes.
export function mapToClient(pairs: Pair[], submittedAt: string) {
  const answers: Record<string, string> = {};
  for (const pair of pairs) {
    const key = questionKey(pair.label);
    if (key && pair.value && !answers[key]) answers[key] = pair.value.trim();
  }
  const fields: Record<string, unknown> = {};
  const set = (field: string, value: unknown) => { if (value !== "" && value !== null && value !== undefined) fields[field] = value; };

  const businessName = (answers.business_name || "").replace(/\s*-\s*business name\s*$/i, "").trim();
  set("business_name", businessName);
  set("legal_name", businessName);
  set("owner_name", answers.full_name || [answers.first_name, answers.last_name].filter(Boolean).join(" "));
  set("phone", answers.business_phone || answers.phone);
  set("email", (answers.business_email || answers.email || "").match(EMAIL)?.[0] || "");
  set("contact_phone", answers.phone);
  set("contact_email", (answers.email || "").match(EMAIL)?.[0] || "");

  const street = answers.address || "";
  const cityStateZip = [answers.city, [answers.state, answers.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const addressHasCity = answers.city && street.toLowerCase().includes(answers.city.toLowerCase());
  set("address", addressHasCity || !cityStateZip ? street : [street, cityStateZip].filter(Boolean).join(", "));

  set("ads_targeting_address", answers.ads_targeting_address);
  // Radius only when the answer names a single distance ("20 miles around…", "+ 30 Miles").
  const milesIn = (text: string) => [...new Set([...text.matchAll(/(\d{1,3})\s*(?:-|\s)?(?:mi\b|miles?|millas)/gi)].map((match) => Number(match[1])))];
  const targetMiles = milesIn(answers.ads_targeting_address || "");
  const marketMiles = milesIn(answers.markets || "");
  const radius = targetMiles.length === 1 ? targetMiles[0] : !targetMiles.length && marketMiles.length === 1 ? marketMiles[0] : 0;
  if (radius >= 1 && radius <= 500) set("targeting_radius_miles", radius);

  set("onboarding_call_language", answers.language);
  const website = answers.website || "";
  const wantsWebsite = /would like (a )?website|website included|fully built.*website|ai website|need (a )?website|necesito.*sitio/i.test(website);
  set("website_url", firstUrl(website));
  if (wantsWebsite) { set("needs_website_funnel", true); set("website_build_request", website); }
  else if (firstUrl(website)) set("needs_website_funnel", false);

  set("offer", answers.offer);
  set("markets", answers.markets);
  const zips = [...new Set(`${answers.markets || ""}`.match(/\b\d{5}\b/g) || [])];
  if (zips.length) set("target_zip_codes", zips.join(", "));
  set("services", (answers.services || "").replace(/^services\s*:\s*/i, ""));

  const gbp = answers.gbp || "";
  set("gbp_email", gbp.match(EMAIL)?.[0] || "");
  // A Google Business link can come in any answer (often next to the offer).
  const googleLink = pairs.map((pair) => firstUrl(pair.value)).find((url) => /share\.google|g\.page|maps\.app\.goo\.gl|google\.com\/maps|business\.google/i.test(url));
  set("gbp_link", googleLink || "");

  const facebook = answers.facebook || "";
  if (firstUrl(facebook) && /facebook\.com|fb\.com/i.test(facebook)) set("facebook_page_url", firstUrl(facebook));
  else if (!empty(facebook)) set("facebook_business_info", facebook);
  const instagramAsked = pairs.some((pair) => questionKey(pair.label) === "instagram");
  const instagram = answers.instagram || "";
  if (/instagram\.com/i.test(instagram)) set("instagram_url", firstUrl(instagram));
  else if (instagramAsked && (empty(instagram) || /not needed|not required/i.test(instagram))) set("instagram_needed", false);

  // "Timezone" is the browser zone of whoever filled in the form, not the client's: kept only in the notes.

  // GHL prints the submission time in the agency's time (US Eastern).
  const parsedDate = Date.parse(`${submittedAt.replace(/,(?=\s*\d{1,2}:\d{2})/, "")} GMT-0500`);
  const submitted = Number.isNaN(parsedDate) ? null : new Date(parsedDate);
  if (submitted) { set("onboarding_date", submitted.toISOString().slice(0, 10)); set("intake_form_completed_at", submitted.toISOString()); }
  set("intake_form_completed", true);
  set("intake_source", "ghl_form");

  const notes = pairs.filter((pair) => pair.value && !["ip", "upload"].includes(questionKey(pair.label)))
    .map((pair) => `${pair.label}\n${pair.value}`).join("\n\n");
  set("onboarding_form_notes", `Formulario de onboarding (PDF${submittedAt ? `, ${submittedAt}` : ""})\n\n${notes}`.slice(0, 5000));
  return fields;
}
