import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Pulls leads, qualified leads and booked appointments for the current billing
// period of each client from its GHL sub-account (API v2, Private Integration Token).
//
// Callers:
//   - A signed-in team member: { clientId } syncs one client.
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

async function syncTarget(admin: ReturnType<typeof adminClient>, target: Target, actorId: string | null) {
  const { data: periodRows, error: periodError } = await admin.rpc("client_billing_period", {
    p_anchor: target.billing_cycle_anchor,
    p_days: target.billing_cycle_days || 30,
  });
  if (periodError) throw periodError;
  const period = (periodRows as Array<{ period_start: string; period_end: string }>)[0];
  const row: Record<string, unknown> = {
    client_id: target.client_id,
    period_start: period.period_start,
    period_end: period.period_end,
    synced_at: new Date().toISOString(),
    synced_by: actorId,
  };
  try {
    const [leads, qualified, appointments] = await Promise.all([
      countContacts(target, period.period_start, period.period_end),
      target.qualified_tag ? countContacts(target, period.period_start, period.period_end, target.qualified_tag) : Promise.resolve(0),
      countAppointments(target, period.period_start, period.period_end),
    ]);
    Object.assign(row, {
      leads,
      qualified_leads: qualified,
      appointments_booked: appointments.booked,
      appointments_cancelled: appointments.cancelled,
      sync_status: "ok",
      error_message: "",
    });
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = adminClient();
    const body = await request.json().catch(() => ({})) as { clientId?: string };
    const clientId = typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : null;

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

    const results = [];
    for (const target of targets as Target[]) {
      const row = await syncTarget(admin, target, actorId);
      results.push({ clientId: target.client_id, status: row.sync_status, error: row.error_message || undefined });
    }
    return json({ synced: results.filter((item) => item.status === "ok").length, failed: results.filter((item) => item.status === "error").length, results });
  } catch (error) {
    console.error("GHL metrics sync failed", error);
    return json({ error: "Sync failed" }, 500);
  }
});
