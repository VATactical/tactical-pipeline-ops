import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// GHL "Customer Booked Appointment" (onboarding calendar) → TOPS → Slack #onboarding.
// Auth: header x-tp-ops-key, same key as the onboarding form (integration 'ghl_onboarding').
// Accepts GHL's standard Webhook payload (contact fields + `calendar` object + `customData`).
// Matches the TOPS client, saves the call (client_onboarding_calls + clients.onboarding_call_at)
// and posts the time in EST with the client's info; a reschedule posts again.

type Payload = Record<string, unknown>;
const ONBOARDING_CHANNEL = Deno.env.get("SLACK_ONBOARDING_CHANNEL") || "C0C3LEA2CK0";
const APP_URL = Deno.env.get("TP_OPS_APP_URL") || "https://app.tacticalpipeline.com";
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const filled = (value: unknown) => { const v = text(value); return v && !/^(null|undefined|n\/?a|none)$/i.test(v) ? v : ""; };
const pick = (payload: Payload, ...keys: string[]) => { for (const key of keys) { const v = filled(payload[key]); if (v) return v; } return ""; };
const slackText = (value: unknown, max = 200) => text(value, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const likeLiteral = (input: string) => input.replace(/[\\%_]/g, (c) => `\\${c}`);

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function sha256(input: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// "2026-11-23T10:00:00" in America/Chicago → UTC Date. Strings with Z or an offset are parsed as is.
function toUtc(raw: string, timeZone: string): Date | null {
  if (!raw) return null;
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(raw)) { const d = new Date(raw); return isNaN(d.getTime()) ? null : d; }
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) { const d = new Date(raw); return isNaN(d.getTime()) ? null : d; }
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return new Date(asUtc - (shown - asUtc));
  } catch { return new Date(asUtc); }
}
const est = (date: Date) => date.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " EST";

const MISSING: [string, string][] = [
  ["meta_ad_account_id", "Meta ad account"], ["facebook_page_url", "Facebook page"], ["gbp_link", "Google Business Profile"],
  ["daily_budget", "Daily budget"], ["services", "Services"], ["markets", "Service area"],
];

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  const key = request.headers.get("x-tp-ops-key")?.trim() || "";
  if (key.length < 32) return json({ error: "Unauthorized" }, 401);
  const { data: valid } = await admin.rpc("verify_integration_webhook_token", { p_integration_name: "ghl_onboarding", p_token_sha256: await sha256(key) });
  if (valid !== true) return json({ error: "Unauthorized" }, 401);

  const raw = await request.text();
  if (raw.length > 100_000) return json({ error: "Payload too large" }, 413);
  let payload: Payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: "Invalid JSON" }, 400); }
  const custom = (payload.customData && typeof payload.customData === "object") ? payload.customData as Payload : {};
  for (const [k, v] of Object.entries(custom)) if (filled(v)) payload[k] = v;
  const location = payload.location as Payload | undefined;
  const calendar = (payload.calendar && typeof payload.calendar === "object") ? payload.calendar as Payload : {};

  const contactId = pick(payload, "contact_id", "contactId");
  const locationId = pick(payload, "location_id", "locationId") || filled(location?.id);
  const timeZone = pick(calendar, "selectedTimezone", "timezone") || pick(payload, "timezone", "appointment_timezone") || "America/New_York";
  const startRaw = pick(payload, "start_time_iso") || pick(calendar, "startTime", "start_time") || pick(payload, "start_time");
  const startsAt = toUtc(startRaw, timeZone);
  const endsAt = toUtc(pick(calendar, "endTime", "end_time") || pick(payload, "end_time"), timeZone);
  const appointmentId = pick(calendar, "appointmentId", "id") || pick(payload, "appointment_id") || `${contactId}:${startRaw}`;
  if (!contactId || !startsAt) return json({ error: "contact_id and the appointment start time are required" }, 422);

  const email = pick(payload, "email", "personal_email");
  const company = pick(payload, "company_name", "business_name");
  const name = pick(payload, "full_name", "contact_name") || [pick(payload, "first_name"), pick(payload, "last_name")].filter(Boolean).join(" ");
  const phone = pick(payload, "phone");

  // Match the TOPS client: GHL ids, then email, then business name (only when unique).
  let client: Payload | null = null;
  const one = async (column: string, value: string) => {
    if (!value) return null;
    const { data } = await admin.from("clients").select("*").eq("archived", false).ilike(column, likeLiteral(value)).limit(2);
    return data?.length === 1 ? data[0] : null;
  };
  if (contactId) {
    const { data } = await admin.from("clients").select("*").eq("archived", false).eq("ghl_contact_id", contactId).limit(2);
    if (data?.length === 1) client = data[0];
  }
  client = client || await one("email", email) || await one("contact_email", email) || await one("business_name", company) || await one("legal_name", company);

  const { data: prior } = await admin.from("client_onboarding_calls").select("starts_at").eq("appointment_id", appointmentId).maybeSingle();
  const rescheduled = !!prior && new Date(String(prior.starts_at)).getTime() !== startsAt.getTime();
  const { error: saveError } = await admin.from("client_onboarding_calls").upsert({
    appointment_id: appointmentId, client_id: client?.id ?? null, ghl_contact_id: contactId, ghl_location_id: locationId,
    contact_name: name, contact_email: email, contact_phone: phone, company_name: company,
    calendar_name: pick(calendar, "calendarName", "title") || pick(payload, "calendar_name"),
    starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() ?? null, time_zone: timeZone,
    status: pick(calendar, "status", "appoinmentStatus", "appointmentStatus") || "booked",
    meeting_link: pick(calendar, "address") || pick(payload, "meeting_location"), updated_at: new Date().toISOString(),
  }, { onConflict: "appointment_id" });
  if (saveError) { console.error("Could not save onboarding call", saveError.message); return json({ error: "Could not save" }, 500); }
  if (prior && !rescheduled) return json({ ok: true, duplicate: true });

  if (client) {
    await admin.from("clients").update({ onboarding_call_at: startsAt.toISOString(), updated_at: new Date().toISOString() }).eq("id", client.id);
    await admin.from("client_audit_log").insert({
      client_id: client.id, actor_name: "GHL Calendar", actor_role: "system", action: "onboarding_call_booked",
      changed_fields: ["onboarding_call_at"], summary: `Onboarding call ${rescheduled ? "rescheduled" : "booked"} for ${est(startsAt)}`,
    });
  }

  const when = est(startsAt);
  const local = timeZone !== "America/New_York"
    ? ` (client's time: ${startsAt.toLocaleString("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" })})` : "";
  const link = pick(calendar, "address") || pick(payload, "meeting_location");
  const head = rescheduled ? ":arrows_counterclockwise: *Onboarding call rescheduled*" : ":calendar: *Onboarding call booked*";
  const lines: string[] = [];
  if (client) {
    const missing = MISSING.filter(([k]) => !filled(client![k])).map(([, label]) => label);
    lines.push(`${head} · *${slackText(client.code, 20)} ${slackText(client.business_name)}*`, `*${when}*${local}`);
    lines.push(`• Contact: ${[slackText(client.owner_name || name), slackText(client.phone || phone), slackText(client.contact_email || client.email || email)].filter(Boolean).join(" · ")}`);
    if (filled(client.onboarding_call_language)) lines.push(`• Call language: ${slackText(client.onboarding_call_language, 40)}`);
    if (filled(client.services)) lines.push(`• Services: ${slackText(String(client.services).replace(/\s*\n\s*/g, ", "), 200)}`);
    if (filled(client.markets)) lines.push(`• Service area: ${slackText(client.markets, 150)}`);
    if (link) lines.push(`• Meeting: ${slackText(link, 200)}`);
    lines.push(missing.length ? `:warning: Still missing for the call: ${missing.join(", ")}` : ":white_check_mark: Dossier has the key fields.");
    lines.push(`<${APP_URL}/clientes/${client.id}|Open in TOPS>`);
  } else {
    lines.push(`${head} · *${slackText(company || name || "New contact")}*`, `*${when}*${local}`);
    lines.push(`• Contact: ${[slackText(name), slackText(phone), slackText(email)].filter(Boolean).join(" · ")}`);
    if (link) lines.push(`• Meeting: ${slackText(link, 200)}`);
    lines.push(":grey_question: Not in TOPS yet: the onboarding form has not arrived for this contact.");
  }
  const body = lines.join("\n");
  const stamp = startsAt.toISOString();
  const rows = [{ kind: "onboarding_call", client_id: client?.id ?? null, channel_id: ONBOARDING_CHANNEL, body, dedupe_key: `onb_call:${appointmentId}:${stamp}` }];
  const clientChannel = String(client?.slack_channel_link || "").match(/C[A-Z0-9]{8,}/)?.[0];
  if (clientChannel) rows.push({ kind: "onboarding_call", client_id: client!.id as string, channel_id: clientChannel, body, dedupe_key: `onb_call_client:${appointmentId}:${stamp}` });
  for (const row of rows) {
    const { error } = await admin.from("slack_outbox").insert(row);
    if (error && error.code !== "23505") console.error("Could not queue onboarding call notice", error.message);
  }
  return json({ ok: true, client_code: client?.code ?? null, starts_at_est: when, rescheduled });
});
