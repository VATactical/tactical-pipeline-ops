import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { type DossierField, extractDossierValues, hasRealValue, ONLY_WHEN_EMPTY, sameValue } from "./extract.ts";
import { eodPlainText, reportDay } from "./eod.ts";
import { detectSignals } from "./signals.ts";

// TOPS <-> Slack bridge.
//
// task "outbox": posts the messages queued in public.slack_outbox (ticket changes, client status and
//   board moves, bitácora comments marked for Slack). Needs the chat:write scope. Without it the
//   messages wait in the queue (up to 24 h) and go out as soon as the scope is added.
// task "scan": reads new messages written by people in each client's Slack channel and saves dossier
//   values it recognises (pixel, ad account, landing page, budget, radius, address, links...) as
//   suggestions in public.client_dossier_suggestions. Nothing in the dossier changes until someone
//   applies the suggestion in TOPS. It also reads status signals (campaign launched / paused, payment
//   problem / fixed, client problem) and saves them in public.client_status_signals for someone to confirm.
// task "eod": imports the EODs people post in #eod-reports (last 48 h, so edits are picked up) as their
//   EOD report in TP OPS, and reacts with ✅ (needs reactions:write; skipped without it).
//
// Callers: the scheduler and the outbox trigger (header x-tp-ops-key, integration 'slack_ticket_sync').
// Needs the SLACK_BOT_TOKEN secret.

const SLACK_API = "https://slack.com/api";
const WORKSPACE_URL = Deno.env.get("SLACK_WORKSPACE_URL") || "https://tacticalpipel-cck5989.slack.com";
const FIRST_SCAN_DAYS = 7;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tp-ops-key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Admin = ReturnType<typeof adminClient>;

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
  return await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as Record<string, unknown>;
}

// Errors that mean "the Slack app is not allowed yet": keep the message queued instead of failing it.
const WAIT_FOR_SCOPE = new Set(["missing_scope", "not_allowed_token_type", "invalid_auth", "not_authed", "account_inactive", "token_revoked"]);

type OutboxRow = { id: string; channel_id: string; thread_ts: string | null; body: string; attempts: number; comment_id: string | null };

async function flushOutbox(admin: Admin, token: string) {
  const { data, error } = await admin.rpc("claim_slack_outbox", { p_limit: 30 });
  if (error) throw error;
  const rows = (data || []) as OutboxRow[];
  let sent = 0;
  let waiting = 0;
  let failed = 0;
  for (const row of rows) {
    const params: Record<string, string> = { channel: row.channel_id, text: row.body, unfurl_links: "false", unfurl_media: "false" };
    if (row.thread_ts) params.thread_ts = row.thread_ts;
    let result = await slack(token, "chat.postMessage", params);
    if (!result.ok && result.error === "not_in_channel") {
      const join = await slack(token, "conversations.join", { channel: row.channel_id });
      if (join.ok) result = await slack(token, "chat.postMessage", params);
    }
    if (!result.ok && result.error === "thread_not_found" && row.thread_ts) {
      delete params.thread_ts;
      result = await slack(token, "chat.postMessage", params);
    }
    const now = new Date().toISOString();
    if (result.ok) {
      sent += 1;
      await admin.from("slack_outbox").update({ status: "sent", slack_ts: String(result.ts || ""), sent_at: now, error: "" }).eq("id", row.id);
      if (row.comment_id) await admin.from("client_comments").update({ slack_sent_at: now }).eq("id", row.comment_id);
    } else if (WAIT_FOR_SCOPE.has(String(result.error))) {
      waiting += 1;
      await admin.from("slack_outbox").update({ status: "queued", attempts: Math.max(0, row.attempts - 1), error: `Slack: ${result.error}` }).eq("id", row.id);
    } else {
      failed += 1;
      await admin.from("slack_outbox").update({ status: "failed", error: `Slack: ${result.error}` }).eq("id", row.id);
    }
  }
  return { claimed: rows.length, sent, waiting, failed };
}

type SlackMessage = { ts: string; thread_ts?: string; user?: string; bot_id?: string; subtype?: string; text?: string; user_profile?: { real_name?: string; display_name?: string } };

const FIELDS: DossierField[] = [
  "meta_pixel_id", "meta_ad_account_id", "meta_business_portfolio_id", "landing_page_url", "website_url", "facebook_page_url",
  "instagram_url", "gbp_link", "drive_folder_link", "google_docs_url", "make_scenario_link", "retell_agent_id", "daily_budget",
  "targeting_radius_miles", "ads_targeting_address",
];

async function scanChannels(admin: Admin, token: string) {
  const [{ data: clients, error: clientError }, { data: states, error: stateError }, { data: profiles }, { data: pending }] = await Promise.all([
    admin.from("clients").select(["id", "code", "status", "ads_pause_reason", "slack_channel_link", ...FIELDS].join(", ")).eq("archived", false),
    admin.from("slack_channel_scan_state").select("channel_id, last_ts"),
    admin.from("profiles").select("full_name, slack_contact").eq("active", true),
    admin.from("client_dossier_suggestions").select("client_id, field, suggested_value"),
  ]);
  if (clientError || stateError) throw clientError || stateError;
  const lastTs = new Map((states || []).map((row) => [row.channel_id as string, row.last_ts as string]));
  const knownSuggestions = new Set((pending || []).map((row) => `${row.client_id}|${row.field}|${row.suggested_value}`));
  const names = new Map<string, string>();
  for (const profile of profiles || []) {
    const id = String(profile.slack_contact || "").match(/U[A-Z0-9]{8,}/)?.[0];
    if (id) names.set(id, String(profile.full_name || "").replace(/\s+/g, " ").trim());
  }
  const nameOf = async (message: SlackMessage) => {
    const id = message.user || "";
    if (names.has(id)) return names.get(id)!;
    const fromMessage = message.user_profile?.real_name || message.user_profile?.display_name || "";
    if (fromMessage) { names.set(id, fromMessage); return fromMessage; }
    const info = await slack(token, "users.info", { user: id });
    const user = info.user as { real_name?: string; profile?: { real_name?: string; display_name?: string } } | undefined;
    const name = user?.profile?.real_name || user?.real_name || user?.profile?.display_name || "";
    names.set(id, name);
    return name;
  };

  let channels = 0;
  let messagesRead = 0;
  let created = 0;
  let signalsCreated = 0;
  const errors: string[] = [];
  for (const client of (clients || []) as Record<string, unknown>[]) {
    const channel = String(client.slack_channel_link || "").match(/C[A-Z0-9]{8,}/)?.[0];
    if (!channel) continue;
    channels += 1;
    const oldest = lastTs.get(channel) || String(Math.floor(Date.now() / 1000) - FIRST_SCAN_DAYS * 86400);
    const messages: SlackMessage[] = [];
    let cursor = "";
    let joined = false;
    let failure = "";
    for (let page = 0; page < 10; page += 1) {
      const params: Record<string, string> = { channel, oldest, limit: "200" };
      if (cursor) params.cursor = cursor;
      const body = await slack(token, "conversations.history", params);
      if (!body.ok && body.error === "not_in_channel" && !joined) {
        joined = true;
        const join = await slack(token, "conversations.join", { channel });
        if (!join.ok) { failure = `join: ${join.error}`; break; }
        page -= 1;
        continue;
      }
      if (!body.ok) { failure = String(body.error); break; }
      messages.push(...((body.messages as SlackMessage[]) || []));
      cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
      if (!body.has_more || !cursor) break;
    }
    if (failure) {
      errors.push(`${client.code}: ${failure}`);
      await admin.from("slack_channel_scan_state").upsert({ channel_id: channel, last_ts: oldest, last_error: failure, updated_at: new Date().toISOString() });
      continue;
    }
    messages.sort((a, b) => Number(a.ts) - Number(b.ts));
    messagesRead += messages.length;

    const rows: Record<string, unknown>[] = [];
    const signalRows: Record<string, unknown>[] = [];
    const live = client.status === "ADS LIVE" || client.status === "CRUISE CONTROL";
    const pausedForPayment = client.status === "ADS PAUSED" && /payment|pago/i.test(String(client.ads_pause_reason || ""));
    for (const message of messages) {
      // People only: no bots (Viktor, LeadConnector, TOPS itself) and no join/leave notices.
      if (message.bot_id || !message.user || (message.subtype && !["thread_broadcast", "file_share"].includes(message.subtype))) continue;
      for (const signal of detectSignals(message.text || "")) {
        // Skip what TP OPS already shows: a launch for a live client, a payment problem already recorded.
        if ((signal === "ads_live" || signal === "payment_fixed") && live) continue;
        if (signal === "ads_paused" && client.status === "ADS PAUSED") continue;
        if (signal === "payment_error" && pausedForPayment) continue;
        signalRows.push({
          client_id: client.id, signal, slack_user_id: message.user, slack_user_name: await nameOf(message), message_ts: message.ts,
          excerpt: (message.text || "").replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, "$1").replace(/<(https?:\/\/[^>]+)>/g, "$1").slice(0, 600),
          source_url: `${WORKSPACE_URL}/archives/${channel}/p${message.ts.replace(".", "")}`,
          created_at: new Date(Number(message.ts) * 1000).toISOString(),
        });
      }
      const found = extractDossierValues(message.text || "");
      for (const item of found) {
        const current = client[item.field];
        if (sameValue(item.field, current, item.value)) continue;
        if (ONLY_WHEN_EMPTY.has(item.field) && hasRealValue(item.field, current)) continue;
        const key = `${client.id}|${item.field}|${item.value}`;
        if (knownSuggestions.has(key)) continue;
        knownSuggestions.add(key);
        rows.push({
          client_id: client.id, field: item.field, suggested_value: item.value,
          current_value: hasRealValue(item.field, current) ? String(current ?? "") : "",
          excerpt: (message.text || "").replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, "$1").replace(/<(https?:\/\/[^>]+)>/g, "$1").slice(0, 600),
          slack_user_id: message.user, slack_user_name: await nameOf(message),
          source_url: `${WORKSPACE_URL}/archives/${channel}/p${message.ts.replace(".", "")}`, message_ts: message.ts,
          created_at: new Date(Number(message.ts) * 1000).toISOString(),
        });
      }
    }
    if (signalRows.length) {
      const { error } = await admin.from("client_status_signals").upsert(signalRows, { onConflict: "client_id,signal,message_ts", ignoreDuplicates: true });
      if (error) errors.push(`${client.code} signals: ${error.message}`);
      else signalsCreated += signalRows.length;
    }
    if (rows.length) {
      const { error } = await admin.from("client_dossier_suggestions").upsert(rows, { onConflict: "client_id,field,suggested_value", ignoreDuplicates: true });
      if (error) { errors.push(`${client.code}: ${error.message}`); continue; }
      created += rows.length;
    }
    const newest = messages.length ? messages[messages.length - 1].ts : oldest;
    await admin.from("slack_channel_scan_state").upsert({ channel_id: channel, last_ts: newest, last_error: "", updated_at: new Date().toISOString() });
  }
  return { channels, messagesRead, suggestions: created, signals: signalsCreated, errors };
}

const EOD_CHANNEL = Deno.env.get("SLACK_EOD_CHANNEL") || "C0C0ZK4HYFK";
const EOD_LOOKBACK_HOURS = 48;

// A top-level message by a person that reads like an EOD report ("EOD Report – …" near the top).
const looksLikeEod = (text: string) => text.length >= 150 && /\bEOD\b/i.test(text.slice(0, 200));

async function importEods(admin: Admin, token: string) {
  const { data: profileRows, error } = await admin.from("profiles")
    .select("id, full_name, role, slack_contact, permissions").eq("active", true).is("deleted_at", null);
  if (error) throw error;
  const names = new Map<string, string>();
  const authors = new Map<string, { id: string; name: string }>();
  for (const profile of profileRows || []) {
    const id = String(profile.slack_contact || "").match(/[UW][A-Z0-9]{8,}/)?.[0];
    if (!id) continue;
    const name = String(profile.full_name || "").replace(/\s+/g, " ").trim();
    names.set(id, name);
    const permissions = (profile.permissions || {}) as Record<string, boolean>;
    if (profile.role !== "superadmin" && permissions.eod_reports) authors.set(id, { id: profile.id as string, name });
  }

  const oldest = String(Math.floor(Date.now() / 1000) - EOD_LOOKBACK_HOURS * 3600);
  const messages: SlackMessage[] = [];
  let cursor = "";
  let joined = false;
  for (let page = 0; page < 5; page += 1) {
    const params: Record<string, string> = { channel: EOD_CHANNEL, oldest, limit: "200" };
    if (cursor) params.cursor = cursor;
    const body = await slack(token, "conversations.history", params);
    if (!body.ok && body.error === "not_in_channel" && !joined) {
      joined = true;
      const join = await slack(token, "conversations.join", { channel: EOD_CHANNEL });
      if (!join.ok) return { error: `join: ${join.error}` };
      page -= 1;
      continue;
    }
    if (!body.ok) return { error: String(body.error) };
    messages.push(...((body.messages as SlackMessage[]) || []));
    cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
    if (!body.has_more || !cursor) break;
  }

  // Newest EOD per person and day.
  const latest = new Map<string, { message: SlackMessage; author: { id: string; name: string }; day: string; notes: string }>();
  for (const message of messages) {
    if (message.bot_id || !message.user || (message.subtype && message.subtype !== "thread_broadcast")) continue;
    if (message.thread_ts && message.thread_ts !== message.ts && message.subtype !== "thread_broadcast") continue;
    const author = authors.get(message.user);
    if (!author) continue;
    const notes = eodPlainText(message.text || "", names);
    if (!looksLikeEod(notes)) continue;
    const { day } = reportDay(notes, new Date(Number(message.ts) * 1000), "America/New_York");
    const key = `${author.id}|${day}`;
    const current = latest.get(key);
    if (!current || Number(current.message.ts) < Number(message.ts)) latest.set(key, { message, author, day, notes });
  }

  const results: Record<string, number> = {};
  const errors: string[] = [];
  for (const { message, author, day, notes } of latest.values()) {
    const { data: result, error: importError } = await admin.rpc("import_slack_eod", {
      p_user_id: author.id, p_report_date: day, p_notes: notes.length > 5000 ? `${notes.slice(0, 4990)}…` : notes,
      p_slack_channel_id: EOD_CHANNEL, p_slack_ts: message.ts,
      p_slack_permalink: `${WORKSPACE_URL}/archives/${EOD_CHANNEL}/p${message.ts.replace(".", "")}`,
      p_submitted_at: new Date(Number(message.ts) * 1000).toISOString(),
    });
    if (importError) { errors.push(`${author.name} ${day}: ${importError.message}`); continue; }
    const outcome = String(result);
    results[outcome] = (results[outcome] || 0) + 1;
    if (outcome === "created" || outcome === "updated") {
      await slack(token, "reactions.add", { channel: EOD_CHANNEL, timestamp: message.ts, name: "white_check_mark" });
    }
  }
  return { read: messages.length, eods: latest.size, results, errors };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = adminClient();
    const scheduleKey = request.headers.get("x-tp-ops-key")?.trim() || "";
    if (!scheduleKey) return json({ error: "Key required" }, 401);
    const { data: valid } = await admin.rpc("verify_integration_webhook_token", {
      p_integration_name: "slack_ticket_sync", p_token_sha256: await sha256(scheduleKey),
    });
    if (valid !== true) return json({ error: "Invalid key" }, 401);

    const token = Deno.env.get("SLACK_BOT_TOKEN") || "";
    if (!token) return json({ error: "SLACK_BOT_TOKEN is not configured" }, 400);
    const body = await request.json().catch(() => ({})) as { task?: string };
    if (body.task === "outbox") return json(await flushOutbox(admin, token));
    if (body.task === "scan") return json(await scanChannels(admin, token));
    if (body.task === "eod") return json(await importEods(admin, token));
    return json({ error: "Unknown task" }, 400);
  } catch (error) {
    console.error("Slack bridge failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
