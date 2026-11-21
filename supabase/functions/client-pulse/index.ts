import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Reads the GHL (LeadConnector) lead and appointment notices posted in every client Slack channel
// and stores one row per notice in client_lead_notices. Those rows feed the no-leads alert and the
// weekly report drafts (SQL: private.check_no_lead_clients / private.draft_weekly_client_reports).
// Callers: the scheduler (x-tp-ops-key, integration 'slack_ticket_sync'). Body { task: "scan" }.
// Needs SLACK_BOT_TOKEN (channels:history, channels:join).

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
    const body = await request.json().catch(() => ({})) as { task?: string };
    if (body.task === "scan") return json(await scan(admin, token));
    return json({ error: "Unknown task" }, 400);
  } catch (error) {
    console.error("Client pulse failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
