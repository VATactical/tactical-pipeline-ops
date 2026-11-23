import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Reads the GHL (LeadConnector) lead and appointment notices posted in every client Slack channel
// and stores one row per notice in client_lead_notices. Those rows feed the no-leads alert and the
// weekly report drafts (SQL: private.check_no_lead_clients / private.draft_weekly_client_reports).
// Callers: the scheduler (x-tp-ops-key, integration 'slack_ticket_sync'). Body { task: "scan" }.
// Needs SLACK_BOT_TOKEN (channels:history, channels:join). Body { task: "meta" } also needs META_ACCESS_TOKEN.

const SLACK_API = "https://slack.com/api";
const FIRST_SCAN_DAYS = 35;
type Row = Record<string, unknown>;

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function sha256(input: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function slack(token: string, method: string, params: Record<string, string>) {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as Row;
}

// Same rules as the GHL metrics cross-check: only the headline decides the kind, test notices are skipped.
const isTestNotice = (text: string) => /\btest\b/i.test(text.split("\n").slice(0, 3).join(" "));
const isAppointmentNotice = (text: string) => /appointment|booked|locked in|scheduled|\bcita\b/i.test(text.split("\n")[0] || "");
const isLeadNotice = (text: string) => /\blead\b|lead information|nuevo lead/i.test(text.split("\n").slice(0, 3).join(" "));

async function scan(admin: ReturnType<typeof adminClient>, token: string) {
  const [{ data: clients, error }, { data: states }] = await Promise.all([
    admin.from("clients").select("id, code, slack_channel_link").eq("archived", false),
    admin.from("client_pulse_scan_state").select("channel_id, last_ts"),
  ]);
  if (error) throw error;
  const lastTs = new Map((states || []).map((row) => [String(row.channel_id), String(row.last_ts)]));
  let channels = 0, stored = 0;
  const errors: string[] = [];
  for (const client of clients || []) {
    const channel = String(client.slack_channel_link || "").match(/C[A-Z0-9]{8,}/)?.[0];
    if (!channel) continue;
    channels += 1;
    const oldest = lastTs.get(channel) || String(Math.floor(Date.now() / 1000) - FIRST_SCAN_DAYS * 86400);
    let newest = oldest, cursor = "", joined = false, failure = "";
    const rows: Row[] = [];
    for (let page = 0; page < 20; page += 1) {
      const params: Record<string, string> = { channel, oldest, limit: "200" };
      if (cursor) params.cursor = cursor;
      const body = await slack(token, "conversations.history", params);
      if (!body.ok && body.error === "not_in_channel" && !joined) {
        joined = true;
        const join = await slack(token, "conversations.join", { channel });
        if (join.ok) { page -= 1; continue; }
      }
      if (!body.ok) { failure = `Slack: ${body.error}`; break; }
      for (const message of (body.messages as Row[]) || []) {
        const ts = String(message.ts || "");
        if (Number(ts) > Number(newest)) newest = ts;
        const profile = message.bot_profile as { name?: string } | undefined;
        const author = String(profile?.name || message.username || "");
        if (!message.bot_id || !/leadconnector|highlevel|ghl/i.test(author)) continue;
        const text = String(message.text || "");
        if (isTestNotice(text)) continue;
        const kind = isAppointmentNotice(text) ? "appointment" : isLeadNotice(text) ? "lead" : null;
        if (!kind) continue;
        rows.push({
          client_id: client.id, channel_id: channel, message_ts: ts, kind,
          headline: (text.split("\n")[0] || "").replace(/[*_:]/g, "").trim().slice(0, 200),
          posted_at: new Date(Number(ts) * 1000).toISOString(),
        });
      }
      cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
      if (!body.has_more || !cursor) break;
    }
    if (rows.length) {
      const { error: insertError } = await admin.from("client_lead_notices").upsert(rows, { onConflict: "channel_id,message_ts", ignoreDuplicates: true });
      if (insertError) failure = insertError.message; else stored += rows.length;
    }
    if (failure) errors.push(`${client.code}: ${failure}`);
    await admin.from("client_pulse_scan_state").upsert({
      channel_id: channel, last_ts: failure ? oldest : newest, last_error: failure, updated_at: new Date().toISOString(),
    });
  }
  return { channels, stored, errors };
}

// --- Meta: what is really running ---------------------------------------------------------------
// For every client with a Meta ad account ID: account status, ads by effective status, and daily
// spend + Meta-reported leads for the last 8 days. Uses the portfolio META_ACCESS_TOKEN (system
// user with ads_read). Stored in client_meta_status / client_meta_daily; compared with TOPS by
// private.check_meta_mismatches.
const META_GRAPH = "https://graph.facebook.com/v23.0";
const ACCOUNT_STATUS: Record<number, string> = {
  1: "active", 2: "disabled", 3: "unsettled (payment due)", 7: "pending risk review", 8: "pending settlement",
  9: "in grace period", 100: "pending closure", 101: "closed", 201: "active", 202: "closed",
};
const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"]);

async function meta(token: string, path: string, params: Record<string, string> = {}) {
  const response = await fetch(`${META_GRAPH}/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({})) as Row & { error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(`Meta ${response.status}: ${body.error?.message || response.statusText}`);
  return body;
}

async function metaCheck(admin: ReturnType<typeof adminClient>) {
  const token = Deno.env.get("META_ACCESS_TOKEN") || "";
  if (!token) return { error: "META_ACCESS_TOKEN is not configured" };
  const { data: clients, error } = await admin.from("clients").select("id, code, meta_ad_account_id").eq("archived", false);
  if (error) throw error;
  const today = new Date();
  const since = new Date(today.getTime() - 8 * 86400000).toISOString().slice(0, 10);
  const until = today.toISOString().slice(0, 10);
  let checked = 0;
  const errors: string[] = [];
  for (const client of clients || []) {
    const digits = String(client.meta_ad_account_id || "").replace(/\D/g, "");
    if (!digits) continue;
    checked += 1;
    const now = new Date().toISOString();
    try {
      const account = await meta(token, `act_${digits}`, { fields: "name,account_status,disable_reason,currency,timezone_name" });
      const ads = await meta(token, `act_${digits}/ads`, {
        fields: "effective_status", limit: "500",
        effective_status: JSON.stringify(["ACTIVE", "DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "PAUSED"]),
      });
      const counts: Record<string, number> = {};
      for (const ad of (ads.data as Row[]) || []) counts[String(ad.effective_status)] = (counts[String(ad.effective_status)] || 0) + 1;
      const insights = await meta(token, `act_${digits}/insights`, {
        fields: "spend,actions", level: "account", time_increment: "1",
        time_range: JSON.stringify({ since, until }), limit: "31",
      });
      const days = ((insights.data as Row[]) || []).map((row) => ({
        client_id: client.id, day: String(row.date_start), spend: Number(row.spend) || 0,
        meta_leads: ((row.actions as Row[]) || []).filter((action) => LEAD_ACTIONS.has(String(action.action_type)))
          .reduce((max, action) => Math.max(max, Number(action.value) || 0), 0),
        synced_at: now,
      }));
      if (days.length) {
        const { error: dayError } = await admin.from("client_meta_daily").upsert(days, { onConflict: "client_id,day" });
        if (dayError) throw dayError;
      }
      const status = Number(account.account_status);
      const { error: statusError } = await admin.from("client_meta_status").upsert({
        client_id: client.id, ad_account_id: digits, account_name: String(account.name || ""),
        account_status: status, account_status_label: ACCOUNT_STATUS[status] || `status ${status}`,
        disable_reason: Number(account.disable_reason) || 0, currency: String(account.currency || ""),
        active_ads: counts.ACTIVE || 0, disapproved_ads: counts.DISAPPROVED || 0, issue_ads: counts.WITH_ISSUES || 0,
        pending_review_ads: counts.PENDING_REVIEW || 0, error: "", checked_at: now,
      });
      if (statusError) throw statusError;
    } catch (failure) {
      const message = String((failure as Error).message || failure).slice(0, 300);
      errors.push(`${client.code}: ${message}`);
      await admin.from("client_meta_status").upsert({ client_id: client.id, ad_account_id: digits, error: message, checked_at: now });
    }
  }
  return { checked, errors };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = adminClient();
    const key = request.headers.get("x-tp-ops-key")?.trim() || "";
    if (!key) return json({ error: "Key required" }, 401);
    const { data: valid } = await admin.rpc("verify_integration_webhook_token", { p_integration_name: "slack_ticket_sync", p_token_sha256: await sha256(key) });
    if (valid !== true) return json({ error: "Invalid key" }, 401);
    const token = Deno.env.get("SLACK_BOT_TOKEN") || "";
    if (!token) return json({ error: "SLACK_BOT_TOKEN is not configured" }, 400);
    const body = await request.json().catch(() => ({})) as { task?: string; channel?: string };
    if (body.task === "scan") return json(await scan(admin, token));
    if (body.task === "meta") return json(await metaCheck(admin));
    if (body.task === "archive_channel") {
      // Archives a duplicate channel, only if the TP OPS bot created it and no client links to it.
      const channel = String((body as { channel?: string }).channel || "");
      if (!/^C[A-Z0-9]{8,}$/.test(channel)) return json({ error: "channel required" }, 400);
      const [me, info] = await Promise.all([slack(token, "auth.test", {}), slack(token, "conversations.info", { channel })]);
      const creator = String((info.channel as Row | undefined)?.creator || "");
      if (!info.ok || !me.ok || creator !== String(me.user_id)) return json({ error: "Only channels created by TP OPS can be archived here." }, 403);
      const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).like("slack_channel_link", `%${channel}%`);
      if (count) return json({ error: "A client still links to this channel." }, 409);
      const done = await slack(token, "conversations.archive", { channel });
      return json({ ok: done.ok === true, error: done.ok ? undefined : done.error });
    }
    return json({ error: "Unknown task" }, 400);
  } catch (error) {
    console.error("Client pulse failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
