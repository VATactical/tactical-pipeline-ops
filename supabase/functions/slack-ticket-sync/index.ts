import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// Syncs the TKT-### tickets that Viktor tracks in Slack (#blocked-accounts-and-pending-tasks)
// into the TOPS Tickets module (public.tickets, ticket_clients, ticket_updates).
//
// Viktor posts a "Blocker sweep" with a table (TKT | Client | Blocker / next fix | Owner | Age)
// and a "Resolved since last sweep" list. Sweeps are read oldest to newest to get each ticket's
// current state: listed tickets are open, resolved ones are closed, and an open ticket missing
// from the latest sweep is closed.
//
// What the sync changes in TOPS:
//   - New ticket number: creates the ticket (source 'slack') with its clients and the owner, matched
//     to a TOPS user by Slack ID in "Contacto de Slack" or by name.
//   - Existing ticket: saves the latest Slack text in slack_summary and logs it as an update when it
//     changed; resolves it when Slack resolved it, reopens it if Slack lists it open again. A status
//     set in TOPS (In progress, Waiting) is kept while the ticket stays open in Slack.
//   - Adds missing client links; never removes links or other TOPS data.
//
// Callers: the hourly scheduler (header x-tp-ops-key, integration 'slack_ticket_sync') or any
// active team member (session) through the "Sincronizar" button.
// Needs the SLACK_BOT_TOKEN secret (channels:history, channels:join). Channel can be overridden
// with SLACK_TICKETS_CHANNEL.

const SLACK_API = "https://slack.com/api";
const DEFAULT_CHANNEL = "C0C8FC8S10F";
const LOOKBACK_DAYS = 90;
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

type SlackMessage = { ts: string; text?: string; blocks?: Array<Record<string, unknown>> };

// Viktor posts the sweep as blocks (markdown or table); `text` is only a short fallback.
// Flatten every block back into plain text so the parser sees the same table people see.
type RichElement = { type?: string; text?: string; url?: string; user_id?: string; elements?: RichElement[] };
function richText(elements: RichElement[] = []): string {
  return elements.map((element) => {
    if (element.type === "text") return element.text || "";
    if (element.type === "link") return element.url ? `<${element.url}|${element.text || element.url}>` : (element.text || "");
    if (element.type === "user") return element.user_id ? `<@${element.user_id}>` : "";
    if (element.type === "emoji") return "";
    if (element.elements) return richText(element.elements) + (element.type === "rich_text_list" || element.type === "rich_text_section" ? "\n" : "");
    return element.text || "";
  }).join("");
}
function blockText(block: Record<string, unknown>): string {
  const type = block.type as string;
  if (type === "markdown") return String(block.text || "");
  if (type === "section" || type === "header" || type === "context") {
    const text = block.text as { text?: string } | undefined;
    const fields = (block.fields as { text?: string }[] | undefined) || [];
    const elements = (block.elements as { text?: string }[] | undefined) || [];
    return [text?.text || "", ...fields.map((field) => field.text || ""), ...elements.map((element) => element.text || "")].join("\n");
  }
  if (type === "rich_text") return richText(block.elements as RichElement[]);
  if (type === "table") {
    const rows = (block.rows as Array<Array<Record<string, unknown>>> | undefined) || [];
    return rows.map((row) => `| ${row.map((cell) => (cell.type === "raw_text" ? String(cell.text || "") : richText(cell.elements as RichElement[]).replace(/\n/g, " "))).join(" | ")} |`).join("\n");
  }
  return "";
}
function messageText(message: SlackMessage): string {
  const fromBlocks = (message.blocks || []).map(blockText).filter(Boolean).join("\n");
  // A table block means the real sweep lives in blocks; `text` is then a one-line fallback.
  if ((message.blocks || []).some((block) => block.type === "table")) return fromBlocks;
  return fromBlocks.length > (message.text || "").length ? fromBlocks : (message.text || "");
}

async function readChannel(token: string, channel: string) {
  const oldest = String(Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400);
  const messages: SlackMessage[] = [];
  let cursor = "";
  let joined = false;
  for (let page = 0; page < 20; page += 1) {
    const params: Record<string, string> = { channel, oldest, limit: "200" };
    if (cursor) params.cursor = cursor;
    const body = await slack(token, "conversations.history", params);
    if (!body.ok && body.error === "not_in_channel" && !joined) {
      joined = true;
      const join = await slack(token, "conversations.join", { channel });
      if (!join.ok) throw new Error(`Slack join: ${join.error}`);
      page -= 1;
      continue;
    }
    if (!body.ok) throw new Error(`Slack: ${body.error}`);
    messages.push(...((body.messages as SlackMessage[]) || []));
    cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
    if (!body.has_more || !cursor) break;
  }
  return messages.sort((a, b) => Number(a.ts) - Number(b.ts));
}

type ParsedTicket = {
  code: string; title: string; scope: string; clientCodes: string[];
  ownerId: string; ownerName: string; ageDays: number | null; sourceUrl: string;
};
type Sweep = { ts: string; at: Date; open: ParsedTicket[]; resolved: { code: string; note: string }[] };

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const clean = (text: string) => decode(text)
  .replace(/:[a-z0-9_+-]+:/g, "")        // emoji shortcodes
  .replace(/[*_~`]/g, "")
  .replace(/\s+/g, " ")
  .trim();

// "C4/C12/C22", "C17/18/19", "C16–C22", "C23 MNJ", "Agency" -> ["C4", "C12", ...]
function clientCodesFrom(cell: string): string[] {
  if (!/C\s?\d/i.test(cell)) return [];
  const codes = new Set<string>();
  const pattern = /C?\s?(\d{1,3})(?:\s*[–—-]\s*C?\s?(\d{1,3}))?/gi;
  for (const match of cell.matchAll(pattern)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!start) continue;
    if (end > start && end - start <= 15) {
      for (let value = start; value <= end; value += 1) codes.add(`C${value}`);
    } else {
      codes.add(`C${start}`);
    }
  }
  return [...codes];
}

function parseSweep(message: SlackMessage): Sweep | null {
  const raw = messageText(message);
  if (!/TKT|sweep/i.test(raw) || !/\|/.test(raw)) return null;
  const lines = raw.split("\n");
  const open: ParsedTicket[] = [];
  const resolved: { code: string; note: string }[] = [];
  let inResolved = false;

  for (const original of lines) {
    // Protect mentions/links that contain "|" before splitting table cells.
    const mentions: { id: string; name: string }[] = [];
    let line = original.replace(/<@([A-Z0-9]+)(?:\\?\|([^>]+))?>/g, (_all, id, name) => {
      mentions.push({ id, name: name ? decode(name) : "" });
      return `@@${mentions.length - 1}@@`;
    });
    let sourceUrl = "";
    line = line.replace(/<(https?:[^|>]+)\\?\|([^>]+)>/g, (_all, url, label) => {
      if (/TKT|^\s*\d{3}\s*$/.test(label) && !sourceUrl) sourceUrl = url;
      return label;
    }).replace(/<(https?:[^>]+)>/g, "$1");

    // "Resolved since …" / "Closed since …" opens the resolved list; the sweep headline also says
    // "N resolved since" but carries "open" too, so it is skipped.
    if (/(resolved|closed) since/i.test(line) && !/\bopen\b/i.test(line)) { inResolved = true; continue; }
    if (inResolved && /^\s*(each owner|owners:|coverage)/i.test(clean(line))) inResolved = false;

    if (line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      const index = cells.findIndex((cell) => /^(?:TKT-)?\d{3,5}$/i.test(clean(cell)));
      if (index < 0) continue;
      const number = clean(cells[index]).replace(/^TKT-/i, "");
      const scope = clean(cells[index + 1] || "");
      const title = clean(cells[index + 2] || "");
      const ownerCell = cells[index + 3] || "";
      const ownerRef = ownerCell.match(/@@(\d+)@@/);
      const owner = ownerRef ? mentions[Number(ownerRef[1])] : { id: "", name: clean(ownerCell) };
      const ageMatch = clean(cells[index + 4] || "").match(/(\d+)\s*d/);
      open.push({
        code: `TKT-${number.padStart(3, "0")}`, title, scope, clientCodes: clientCodesFrom(scope),
        ownerId: owner?.id || "", ownerName: owner?.name || "", ageDays: ageMatch ? Number(ageMatch[1]) : null, sourceUrl,
      });
      continue;
    }

    if (inResolved) {
      const text = clean(line.replace(/@@(\d+)@@/g, (_all, i) => mentions[Number(i)]?.name || ""));
      const match = text.match(/^[•\-\s]*(?:TKT-)?(\d{3,5})\b[,\s]*([^:]*):\s*(.+)$/i);
      if (match) resolved.push({ code: `TKT-${match[1].padStart(3, "0")}`, note: `${match[2].trim()}: ${match[3].trim()}`.replace(/^:\s*/, "") });
    }
  }
  if (!open.length && !resolved.length) return null;
  return { ts: message.ts, at: new Date(Number(message.ts) * 1000), open, resolved };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = adminClient();
    const requestBody = await request.json().catch(() => ({})) as { debug?: boolean; full?: string };
    const scheduleKey = request.headers.get("x-tp-ops-key")?.trim() || "";
    if (scheduleKey) {
      const { data: valid } = await admin.rpc("verify_integration_webhook_token", {
        p_integration_name: "slack_ticket_sync", p_token_sha256: await sha256(scheduleKey),
      });
      if (valid !== true) return json({ error: "Invalid key" }, 401);
    } else {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Session required" }, 401);
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
      const { data: profile } = await admin.from("profiles").select("active").eq("id", userData.user.id).single();
      if (!profile?.active) return json({ error: "Inactive user" }, 403);
    }

    const slackToken = Deno.env.get("SLACK_BOT_TOKEN") || "";
    if (!slackToken) return json({ error: "SLACK_BOT_TOKEN is not configured" }, 400);
    const channel = Deno.env.get("SLACK_TICKETS_CHANNEL") || DEFAULT_CHANNEL;
    const messages = await readChannel(slackToken, channel);
    const sweeps = messages.map(parseSweep).filter((sweep): sweep is Sweep => sweep !== null);
    if (requestBody.debug) {
      // Diagnostics: how each candidate message looks and what the parser got from it.
      return json({
        messages: messages.length,
        candidates: messages.filter((message) => /sweep|TKT/i.test(`${message.text || ""} ${JSON.stringify(message.blocks || [])}`)).map((message) => {
          const parsed = parseSweep(message);
          const raw = message as Record<string, unknown>;
          return {
            ts: message.ts, subtype: raw.subtype || "", blocks: (message.blocks || []).map((block) => block.type),
            attachments: Array.isArray(raw.attachments) ? (raw.attachments as unknown[]).length : 0,
            files: Array.isArray(raw.files) ? (raw.files as unknown[]).length : 0,
            textLength: (message.text || "").length, flattened: requestBody.full === message.ts ? messageText(message) : messageText(message).slice(0, 300),
            open: parsed?.open.length || 0, resolved: parsed?.resolved.length || 0,
          };
        }),
      });
    }
    if (!sweeps.length) {
      // Report what the channel looks like so a format change is easy to diagnose.
      const sample = messages.filter((message) => /sweep|TKT/i.test(messageText(message))).slice(-1)[0];
      return json({
        synced: 0, note: "No ticket sweeps found in the channel", messages: messages.length,
        sample: sample ? { blocks: (sample.blocks || []).map((block) => block.type), text: messageText(sample).slice(0, 400) } : null,
      });
    }

    // Mentions sometimes come without the display name: reuse a name seen in any sweep, then ask
    // Slack (users.info needs the users:read scope; without it the name stays empty and the TOPS
    // user name is used when the owner maps to a TOPS user).
    const ownerNames = new Map<string, string>();
    for (const sweep of sweeps) for (const item of sweep.open) if (item.ownerId && item.ownerName) ownerNames.set(item.ownerId, item.ownerName);
    const unnamed = new Set<string>();
    for (const sweep of sweeps) for (const item of sweep.open) if (item.ownerId && !ownerNames.has(item.ownerId)) unnamed.add(item.ownerId);
    for (const userId of unnamed) {
      const info = await slack(slackToken, "users.info", { user: userId });
      if (!info.ok) { if (info.error === "missing_scope") break; continue; }
      const user = info.user as { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } | undefined;
      const name = user?.profile?.real_name || user?.real_name || user?.profile?.display_name || user?.name || "";
      if (name) ownerNames.set(userId, name);
    }
    for (const sweep of sweeps) for (const item of sweep.open) if (item.ownerId && !item.ownerName) item.ownerName = ownerNames.get(item.ownerId) || "";

    // Final Slack state per ticket after reading every sweep in order.
    type SlackState = {
      code: string; title: string; scope: string; clientCodes: string[]; ownerId: string; ownerName: string;
      openedOn: string | null; sourceUrl: string; open: boolean; resolution: string; at: Date; firstSeen: Date;
    };
    const states = new Map<string, SlackState>();
    for (const sweep of sweeps) {
      for (const item of sweep.open) {
        const current = states.get(item.code);
        const opened = item.ageDays === null ? null : isoDay(new Date(sweep.at.getTime() - item.ageDays * 86400000));
        states.set(item.code, {
          code: item.code,
          title: item.title || current?.title || "",
          scope: item.scope || current?.scope || "",
          clientCodes: item.clientCodes.length ? item.clientCodes : (current?.clientCodes || []),
          ownerId: item.ownerId || current?.ownerId || "",
          ownerName: item.ownerId ? item.ownerName : (item.ownerName || current?.ownerName || ""),
          openedOn: [current?.openedOn, opened].filter(Boolean).sort()[0] || null,
          sourceUrl: current?.sourceUrl || item.sourceUrl,
          open: true, resolution: "", at: sweep.at, firstSeen: current?.firstSeen || sweep.at,
        });
      }
      for (const item of sweep.resolved) {
        const current = states.get(item.code);
        states.set(item.code, {
          code: item.code, title: current?.title || "", scope: current?.scope || "",
          clientCodes: current?.clientCodes?.length ? current.clientCodes : clientCodesFrom(item.note.split(":")[0]),
          ownerId: current?.ownerId || "", ownerName: current?.ownerName || "", openedOn: current?.openedOn || null,
          sourceUrl: current?.sourceUrl || "", open: false, resolution: item.note, at: sweep.at,
          firstSeen: current?.firstSeen || sweep.at,
        });
      }
    }
    const latest = sweeps[sweeps.length - 1];
    if (latest.open.length) {
      const listed = new Set(latest.open.map((item) => item.code));
      for (const [code, state] of states) {
        if (state.open && !listed.has(code)) {
          states.set(code, { ...state, open: false, resolution: state.resolution || "Ya no aparece en el último sweep de Viktor.", at: latest.at });
        }
      }
    }

    const [{ data: ticketRows, error: ticketError }, { data: clientRows, error: clientError }, { data: profileRows, error: profileError }] = await Promise.all([
      admin.from("tickets").select("id, ticket_number, title, status, assigned_to, slack_summary, source"),
      admin.from("clients").select("id, code, business_name"),
      admin.from("profiles").select("id, full_name, slack_contact, active").eq("active", true).is("deleted_at", null),
    ]);
    if (ticketError || clientError || profileError) throw ticketError || clientError || profileError;
    const ticketsByNumber = new Map((ticketRows || []).map((row) => [String(row.ticket_number).toUpperCase(), row]));
    const clientsByCode = new Map((clientRows || []).map((row) => [String(row.code).toUpperCase(), row]));

    // Slack owner -> TOPS user: Slack ID in "Contacto de Slack", same full name, or a unique first name.
    const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    const profiles = profileRows || [];
    const profileFor = (ownerId: string, ownerName: string) => {
      if (ownerId) {
        const byId = profiles.find((profile) => String(profile.slack_contact || "").includes(ownerId));
        if (byId) return byId.id as string;
      }
      const name = normalize(ownerName);
      if (!name) return null;
      const exact = profiles.filter((profile) => normalize(String(profile.full_name || "")) === name);
      if (exact.length === 1) return exact[0].id as string;
      const first = name.split(" ")[0];
      const byFirst = profiles.filter((profile) => normalize(String(profile.full_name || "")).split(" ")[0] === first);
      return byFirst.length === 1 ? byFirst[0].id as string : null;
    };

    const VIKTOR = "Viktor (Slack)";
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const profileNames = new Map(profiles.map((profile) => [profile.id as string, String(profile.full_name || "").replace(/\s+/g, " ").trim()]));
    for (const state of states.values()) {
      const assignee = profileFor(state.ownerId, state.ownerName);
      // Slack mentions in blocks carry only the user ID: use the TOPS name when the owner maps to a user.
      if (!state.ownerName && assignee) state.ownerName = profileNames.get(assignee) || "";
      const priority = /priority\s*#?\s*1/i.test(state.title) ? "Urgent" : "Medium";
      const slackFields = {
        source: "slack", slack_summary: state.open ? state.title : state.resolution, slack_owner_id: state.ownerId,
        slack_owner_name: state.ownerName, source_url: state.sourceUrl, slack_synced_at: now,
      };
      let ticket = ticketsByNumber.get(state.code);
      if (!ticket) {
        const createdAt = state.openedOn ? `${state.openedOn}T12:00:00Z` : state.firstSeen.toISOString();
        const { data: inserted, error } = await admin.from("tickets").insert({
          ticket_number: state.code,
          title: (state.title || state.scope || state.code).slice(0, 240),
          description: state.scope ? `Clientes en Slack: ${state.scope}` : "",
          status: state.open ? "Open" : "Resolved", priority, assigned_to: assignee,
          created_at: createdAt, updated_at: now, ...slackFields,
        }).select("id, ticket_number, title, status, assigned_to, slack_summary, source").single();
        if (error) throw error;
        ticket = inserted;
        created += 1;
        await admin.from("ticket_updates").insert({
          ticket_id: inserted.id, author_name: VIKTOR, status_after: inserted.status,
          body: `Ticket importado desde Slack. ${state.open ? state.title : state.resolution}`.slice(0, 5000),
        });
      } else {
        const changes: Record<string, unknown> = { ...slackFields };
        const notes: { body: string; status: string | null }[] = [];
        const terminal = ticket.status === "Resolved" || ticket.status === "Closed";
        if (!state.open && !terminal) {
          changes.status = "Resolved";
          notes.push({ body: `Resuelto en Slack: ${state.resolution}`, status: "Resolved" });
        } else if (state.open && terminal) {
          changes.status = "Open";
          notes.push({ body: `Reabierto en Slack: ${state.title}`, status: "Open" });
        } else if (state.open && state.title && state.title !== ticket.slack_summary) {
          notes.push({ body: state.title, status: null });
        }
        if (!ticket.assigned_to && assignee) changes.assigned_to = assignee;
        const meaningful = notes.length || changes.status || changes.assigned_to || ticket.source !== "slack";
        if (meaningful) changes.updated_at = now;
        const { error } = await admin.from("tickets").update(changes).eq("id", ticket.id);
        if (error) throw error;
        for (const note of notes) {
          await admin.from("ticket_updates").insert({ ticket_id: ticket.id, author_name: VIKTOR, body: note.body.slice(0, 5000), status_after: note.status });
        }
        if (notes.length) updated += 1;
      }

      const links = state.clientCodes
        .map((code) => clientsByCode.get(code.toUpperCase()))
        .filter(Boolean)
        .map((client) => ({ ticket_id: ticket!.id, client_id: client!.id, client_code_snapshot: client!.code, business_name_snapshot: client!.business_name }));
      if (links.length) {
        const { error } = await admin.from("ticket_clients").upsert(links, { onConflict: "ticket_id,client_code_snapshot", ignoreDuplicates: true });
        if (error) throw error;
      }
    }

    return json({
      tickets: states.size, open: [...states.values()].filter((state) => state.open).length,
      created, updated, sweeps: sweeps.length, latestSweep: latest.at.toISOString(),
    });
  } catch (error) {
    console.error("Slack ticket sync failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
