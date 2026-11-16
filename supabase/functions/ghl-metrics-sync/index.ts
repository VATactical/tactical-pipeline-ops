import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Pulls leads, qualified leads and booked appointments for the current billing
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

const GHL_BASE = "https://services.leadconnectorhq.com";
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

async function countContacts(target: Target, start: string, end: string, tag?: string) {
  const dateFilter = { field: "dateAdded", operator: "range", value: { gte: dayStart(start), lte: dayEnd(end) } };
  const search = (filters: unknown[]) =>
    ghl(target.token, "/contacts/search", "2021-07-28", {
      method: "POST",
      body: JSON.stringify({ locationId: target.location_id, page: 1, pageLimit: 1, filters }),
    });
  if (!tag) return Number((await search([dateFilter])).total ?? 0);
  try {
    return Number((await search([dateFilter, { field: "tags", operator: "contains", value: tag }])).total ?? 0);
  } catch {
    // Some accounts only accept an array for the tags filter.
    return Number((await search([dateFilter, { field: "tags", operator: "contains", value: [tag] }])).total ?? 0);
  }
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
      if (status === "cancelled" || status === "invalid") cancelled += 1;
      else booked += 1;
    }
  }
  return { booked, cancelled };
}

type Period = { period_start: string; period_end: string };

async function countPeriod(target: Target, start: string, end: string) {
  const [leads, qualified, appointments] = await Promise.all([
    countContacts(target, start, end),
    target.qualified_tag ? countContacts(target, start, end, target.qualified_tag) : Promise.resolve(0),
    countAppointments(target, start, end),
  ]);
  return { leads, qualified_leads: qualified, appointments_booked: appointments.booked, appointments_cancelled: appointments.cancelled };
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
        sync_status: "error", error_message: row.error_message, synced_at: row.synced_at, synced_by: actorId,
      }).eq("id", existing.id);
      if (error) throw error;
      return row;
    }
  }
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
        const counts = await countPeriod(target, body.from!, body.to!);
        return json({ clientId: target.client_id, period_start: body.from, period_end: body.to, ...counts });
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
