import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Pulls leads (contacts with an opportunity), qualified leads and booked appointments for the current billing
// period of each client from its GHL sub-account (API v2, Private Integration Token).
//
// Callers:
//   - A signed-in team member: { clientId } syncs one client's current cycle.
//     { clientId, history: N } also stores the N-1 previous billing cycles (max 12).
//     { clientId, from, to } returns live counts for any date range without storing them
//     (used by the period filter and to fill ADS reports).
//   - Superadmin / operations_admin: {} syncs every connected client.
//   - Scheduler: header x-tp-ops-key checked against private.integration_webhook_tokens
//     ('ghl_metrics_sync'), syncs every connected client.
//
// Ad spend for the same period comes from the Meta Marketing API (Insights) when the client has
// a Meta ad account ID and a token is available: the portfolio-wide META_ACCESS_TOKEN secret
// (system user with ads_read) or, as a fallback, the client's own token in private.client_secrets.
// A Meta failure never blocks the GHL counts; it is stored in meta_spend_error.
//
// Slack cross-check: with the SLACK_BOT_TOKEN secret (scopes channels:history, channels:join,
// groups:history), the LeadConnector notices in the client channel are counted for the same
// period (new lead / appointment booked). It is a verification only and never blocks the sync.

const GHL_BASE = "https://services.leadconnectorhq.com";
const META_GRAPH = "https://graph.facebook.com/v23.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tp-ops-key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Target = {
  client_id: string;
  location_id: string;
  token: string;
  qualified_tag: string;
  billing_cycle_anchor: string | null;
  billing_cycle_days: number;
  meta_ad_account_id: string;
  meta_token: string;
  slack_channel_id: string;
};

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

async function ghl(token: string, path: string, version: string, init: RequestInit = {}) {
  const response = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { message?: string | string[] }).message;
    throw new Error(`GHL ${response.status} on ${path.split("?")[0]}: ${Array.isArray(message) ? message.join(", ") : message || response.statusText}`);
  }
  return body as Record<string, unknown>;
}

// Eastern time is the agency reference; the offset is close enough for daily buckets.
const dayStart = (date: string) => `${date}T00:00:00-05:00`;
const dayEnd = (date: string) => `${date}T23:59:59-05:00`;
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

// Test submissions made by the team ("Test", "Test Lead", "This is a test", test@…).
const isTestContact = (contact: Record<string, unknown>) => {
  const name = `${contact.firstNameLowerCase ?? contact.firstName ?? ""} ${contact.lastNameLowerCase ?? contact.lastName ?? ""}`;
  const emailUser = String(contact.email ?? "").split("@")[0];
  return /\btest\b/i.test(name) || /^test/i.test(emailUser);
};

// A lead is a contact created in the period that entered a pipeline (has an opportunity).
// Lead forms and integrations often create extra fragment contacts (only a phone or only an
// email, no name) that never get an opportunity, and test contacts; counting every contact
// inflates the number versus what the team sees in Opportunities.
// If the API response carries no opportunities field at all, every contact is counted.
async function countLeads(target: Target, start: string, end: string) {
  const dateFilter = { field: "dateAdded", operator: "range", value: { gte: dayStart(start), lte: dayEnd(end) } };
  const pageLimit = 100;
  const contacts: Array<Record<string, unknown>> = [];
  let total = 0;
  for (let page = 1; page <= 50; page += 1) {
    const body = await ghl(target.token, "/contacts/search", "2021-07-28", {
      method: "POST",
      body: JSON.stringify({ locationId: target.location_id, page, pageLimit, filters: [dateFilter] }),
    });
    const rows = (body.contacts as Array<Record<string, unknown>> | undefined) || [];
    total = Number(body.total ?? rows.length);
    contacts.push(...rows);
    if (rows.length < pageLimit || contacts.length >= total) break;
  }
  const hasOpportunityField = contacts.some((contact) => Array.isArray(contact.opportunities));
  const leads = (hasOpportunityField
    ? contacts.filter((contact) => Array.isArray(contact.opportunities) && contact.opportunities.length > 0)
    : contacts).filter((contact) => !isTestContact(contact));
  const tag = (target.qualified_tag || "").trim().toLowerCase();
  const qualified = tag
    ? leads.filter((contact) =>
      Array.isArray(contact.tags) && contact.tags.some((value) => String(value).trim().toLowerCase() === tag)).length
    : 0;
  return { leads: leads.length, qualified, contacts: total };
}

async function countAppointments(target: Target, start: string, end: string) {
  const calendars = (await ghl(target.token, `/calendars/?locationId=${encodeURIComponent(target.location_id)}`, "2021-04-15"))
    .calendars as Array<{ id: string }> | undefined;
  const from = new Date(dayStart(start)).getTime();
  const to = new Date(dayEnd(end)).getTime();
  // Appointments booked in the period may be scheduled weeks later.
  const windowEnd = new Date(dayEnd(addDays(end, 120))).getTime();
  const seen = new Set<string>();
  let booked = 0;
  let cancelled = 0;
  let confirmed = 0;
  let showed = 0;
  let noshow = 0;
  for (const calendar of calendars || []) {
    const query = new URLSearchParams({
      locationId: target.location_id,
      calendarId: calendar.id,
      startTime: String(from),
      endTime: String(windowEnd),
    });
    const events = (await ghl(target.token, `/calendars/events?${query}`, "2021-04-15")).events as Array<Record<string, unknown>> | undefined;
    for (const event of events || []) {
      const id = String(event.id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const created = new Date(String(event.dateAdded || event.startTime || "")).getTime();
      if (!(created >= from && created <= to)) continue;
      const status = String(event.appointmentStatus || "").toLowerCase();
      if (status === "cancelled" || status === "invalid") { cancelled += 1; continue; }
      // Booked = every appointment that was not cancelled (new, confirmed, showed, no-show).
      booked += 1;
      if (status === "confirmed") confirmed += 1;
      else if (status === "showed") showed += 1;
      else if (status === "noshow" || status === "no_show") noshow += 1;
    }
  }
  return { booked, cancelled, confirmed, showed, noshow };
}

type Period = { period_start: string; period_end: string };

async function countPeriod(target: Target, start: string, end: string) {
  const [{ leads, qualified }, appointments] = await Promise.all([
    countLeads(target, start, end),
    countAppointments(target, start, end),
  ]);
  return {
    leads, qualified_leads: qualified,
    appointments_booked: appointments.booked, appointments_cancelled: appointments.cancelled,
    appointments_confirmed: appointments.confirmed, appointments_showed: appointments.showed, appointments_noshow: appointments.noshow,
  };
}

// Meta ad spend for the period. Returns null when the client has no ad account or no token.
async function metaSpend(target: Target, start: string, end: string): Promise<number | null> {
  const accountDigits = (target.meta_ad_account_id || "").replace(/\D/g, "");
  const token = Deno.env.get("META_ACCESS_TOKEN") || target.meta_token || "";
  if (!accountDigits || !token) return null;
  const query = new URLSearchParams({
    fields: "spend",
    level: "account",
    time_range: JSON.stringify({ since: start, until: end }),
  });
  const response = await fetch(`${META_GRAPH}/act_${accountDigits}/insights?${query}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({})) as { data?: Array<{ spend?: string }>; error?: { message?: string } };
  if (!response.ok || body.error) {
    throw new Error(`Meta ${response.status}: ${body.error?.message || response.statusText}`);
  }
  return (body.data || []).reduce((total, row) => total + (Number(row.spend) || 0), 0);
}

// Counts LeadConnector notices in the client Slack channel for the period.
const SLACK_API = "https://slack.com/api";
const isTestNotice = (text: string) => /\btest\b/i.test(text.split("\n").slice(0, 3).join(" "));
// Only the headline decides: lead notices often say "book an appointment" further down.
const isAppointmentNotice = (text: string) => /appointment|booked|locked in|scheduled|\bcita\b/i.test(text.split("\n")[0] || "");
const isLeadNotice = (text: string) => /\blead\b|lead information|nuevo lead/i.test(text.split("\n").slice(0, 3).join(" "));

async function slack(token: string, method: string, params: Record<string, string>) {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as Record<string, unknown>;
}

async function slackColumns(target: Target, start: string, end: string) {
  const token = Deno.env.get("SLACK_BOT_TOKEN") || "";
  if (!token || !target.slack_channel_id) return {};
  try {
    const oldest = String(new Date(dayStart(start)).getTime() / 1000);
    const latest = String(new Date(dayEnd(end)).getTime() / 1000);
    let leads = 0;
    let appointments = 0;
    let first: number | null = null;
    let cursor = "";
    let joined = false;
    for (let page = 0; page < 20; page += 1) {
      const params: Record<string, string> = { channel: target.slack_channel_id, oldest, latest, limit: "200", inclusive: "true" };
      if (cursor) params.cursor = cursor;
      const body = await slack(token, "conversations.history", params);
      if (!body.ok && body.error === "not_in_channel" && !joined) {
        joined = true;
        const join = await slack(token, "conversations.join", { channel: target.slack_channel_id });
        if (!join.ok) throw new Error(`Slack: ${join.error}`);
        page -= 1;
        continue;
      }
      if (!body.ok) throw new Error(`Slack: ${body.error}`);
      for (const message of (body.messages as Array<Record<string, unknown>>) || []) {
        const profile = message.bot_profile as { name?: string } | undefined;
        const author = String(profile?.name || message.username || "");
        if (!message.bot_id || !/leadconnector|highlevel|ghl/i.test(author)) continue;
        const text = String(message.text || "");
        if (isTestNotice(text)) continue;
        const kind = isAppointmentNotice(text) ? "appointment" : isLeadNotice(text) ? "lead" : null;
        if (!kind) continue;
        if (kind === "lead") leads += 1; else appointments += 1;
        const ts = Number(message.ts) * 1000;
        if (first === null || ts < first) first = ts;
      }
      cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
      if (!body.has_more || !cursor) break;
    }
    return {
      slack_leads: leads,
      slack_appointments: appointments,
      slack_first_notice_at: first === null ? null : new Date(first).toISOString(),
      slack_error: "",
    };
  } catch (error) {
    return { slack_error: String((error as Error).message || error).slice(0, 300) };
  }
}

// Spend columns for a stored period; on error the last good meta_spend is kept.
async function spendColumns(target: Target, start: string, end: string) {
  try {
    const spend = await metaSpend(target, start, end);
    if (spend === null) return { meta_spend_error: "" };
    return { meta_spend: Math.round(spend * 100) / 100, meta_spend_synced_at: new Date().toISOString(), meta_spend_error: "" };
  } catch (error) {
    return { meta_spend_error: String((error as Error).message || error).slice(0, 300) };
  }
}

async function cyclesFor(admin: ReturnType<typeof adminClient>, target: Target, count: number): Promise<Period[]> {
  const { data, error } = await admin.rpc("client_billing_period", {
    p_anchor: target.billing_cycle_anchor,
    p_days: target.billing_cycle_days || 30,
  });
  if (error) throw error;
  const current = (data as Period[])[0];
  const days = target.billing_cycle_days || 30;
  const periods: Period[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = addDays(current.period_start, -days * index);
    // Never go back before the first cycle of the contract.
    if (target.billing_cycle_anchor && start < target.billing_cycle_anchor) break;
    periods.push({ period_start: start, period_end: addDays(start, days - 1) });
  }
  return periods;
}

async function storePeriod(admin: ReturnType<typeof adminClient>, target: Target, period: Period, actorId: string | null) {
  const row: Record<string, unknown> = {
    client_id: target.client_id,
    period_start: period.period_start,
    period_end: period.period_end,
    synced_at: new Date().toISOString(),
    synced_by: actorId,
  };
  const [spend, slackCheck] = await Promise.all([
    spendColumns(target, period.period_start, period.period_end),
    slackColumns(target, period.period_start, period.period_end),
  ]);
  try {
    Object.assign(row, await countPeriod(target, period.period_start, period.period_end), { sync_status: "ok", error_message: "" });
  } catch (error) {
    Object.assign(row, { sync_status: "error", error_message: String((error as Error).message || error).slice(0, 500) });
  }
  // On error keep the last good counts: only the status columns are overwritten.
  if (row.sync_status === "error") {
    const { data: existing } = await admin.from("client_ghl_metrics").select("id")
      .eq("client_id", target.client_id).eq("period_start", period.period_start).maybeSingle();
    if (existing) {
      const { error } = await admin.from("client_ghl_metrics").update({
        sync_status: "error", error_message: row.error_message, synced_at: row.synced_at, synced_by: actorId, ...spend, ...slackCheck,
      }).eq("id", existing.id);
      if (error) throw error;
      return row;
    }
  }
  Object.assign(row, spend, slackCheck);
  const { error } = await admin.from("client_ghl_metrics").upsert(row, { onConflict: "client_id,period_start" });
  if (error) throw error;
  return row;
}

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const body = await request.json().catch(() => ({})) as { clientId?: string; history?: number; from?: string; to?: string };
    const clientId = typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null;
    const history = Math.min(Math.max(Math.trunc(Number(body.history) || 1), 1), 12);
    const wantsRange = body.from !== undefined || body.to !== undefined;
    if (wantsRange) {
      if (!clientId) return json({ error: "Choose a client for a custom range" }, 400);
      if (!isDate(body.from) || !isDate(body.to) || body.from > body.to) return json({ error: "Invalid date range" }, 400);
      const spanDays = (new Date(`${body.to}T12:00:00Z`).getTime() - new Date(`${body.from}T12:00:00Z`).getTime()) / 86400000;
      if (spanDays > 366) return json({ error: "The range can be at most one year" }, 400);
    }

    let actorId: string | null = null;
    const scheduleKey = request.headers.get("x-tp-ops-key")?.trim() || "";
    if (scheduleKey) {
      const { data: valid } = await admin.rpc("verify_integration_webhook_token", {
        p_integration_name: "ghl_metrics_sync",
        p_token_sha256: await sha256(scheduleKey),
      });
      if (valid !== true) return json({ error: "Invalid key" }, 401);
    } else {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Session required" }, 401);
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
      const { data: profile } = await admin.from("profiles").select("role, active, permissions").eq("id", userData.user.id).single();
      if (!profile?.active) return json({ error: "Inactive user" }, 403);
      const isAdmin = profile.role === "superadmin" || profile.permissions?.operations_admin === true;
      if (!clientId && !isAdmin) return json({ error: "Only admins can sync every client" }, 403);
      actorId = userData.user.id;
    }

    const { data: targets, error: targetError } = await admin.rpc("get_ghl_sync_targets", { p_client_id: clientId });
    if (targetError) throw targetError;
    if (!targets?.length) {
      return json({ error: clientId ? "This client has no GHL Location ID or token configured" : "No clients connected to GHL" }, 400);
    }

    if (wantsRange) {
      const target = (targets as Target[])[0];
      try {
        const [counts, spend, slackCheck] = await Promise.all([
          countPeriod(target, body.from!, body.to!),
          spendColumns(target, body.from!, body.to!),
          slackColumns(target, body.from!, body.to!),
        ]);
        return json({ clientId: target.client_id, period_start: body.from, period_end: body.to, ...counts, ...spend, ...slackCheck });
      } catch (error) {
        return json({ error: String((error as Error).message || error).slice(0, 500) }, 502);
      }
    }

    const results = [];
    for (const target of targets as Target[]) {
      const periods = await cyclesFor(admin, target, clientId ? history : 1);
      for (const period of periods) {
        const row = await storePeriod(admin, target, period, actorId);
        results.push({ clientId: target.client_id, period_start: period.period_start, status: row.sync_status, error: row.error_message || undefined });
      }
    }
    return json({ synced: results.filter((item) => item.status === "ok").length, failed: results.filter((item) => item.status === "error").length, results });
  } catch (error) {
    console.error("GHL metrics sync failed", error);
    return json({ error: "Sync failed" }, 500);
  }
});
