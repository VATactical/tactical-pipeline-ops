import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { eodPlainText, reportDay } from "./eod.ts";

// Slack interactivity endpoint for the TP OPS app.
//
// Message shortcut "Send to TP OPS" (callback_id send_to_tp_ops): saves the selected Slack message as
// its author's EOD report in TP OPS. The author must be linked to a TP OPS user (Slack ID in
// "Contacto de Slack") who files EOD reports. The author or an operations admin can send it.
// The answer is shown only to the person who pressed the shortcut (ephemeral).
//
// Slack signs every request: it is checked with the SLACK_SIGNING_SECRET secret. Uses SLACK_BOT_TOKEN
// for the permalink and names.

const APP_URL = "https://app.tacticalpipeline.com";
const SLACK_API = "https://slack.com/api";
const encoder = new TextEncoder();

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function validSignature(request: Request, body: string) {
  const secret = Deno.env.get("SLACK_SIGNING_SECRET") || "";
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const signature = request.headers.get("x-slack-signature") || "";
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`)));
  const expected = `v0=${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return diff === 0;
}

async function slack(method: string, params: Record<string, string>) {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN") || ""}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return await response.json().catch(() => ({ ok: false })) as Record<string, unknown>;
}

async function reply(responseUrl: string, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => undefined);
}

type Profile = { id: string; full_name: string; role: string; timezone: string; slack_contact: string; permissions: Record<string, boolean> | null };
type MessageAction = {
  type: string; callback_id: string; response_url: string;
  user: { id: string }; channel: { id: string };
  message: { ts: string; user?: string; bot_id?: string; text?: string };
};

const prettyDate = (day: string) => new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

async function sendEodToTpOps(action: MessageAction) {
  const admin = adminClient();
  const { data, error } = await admin.from("profiles").select("id, full_name, role, timezone, slack_contact, permissions").eq("active", true).is("deleted_at", null);
  if (error) throw error;
  const profiles = (data || []) as Profile[];
  const bySlack = (slackId: string) => profiles.find((profile) => String(profile.slack_contact || "").includes(slackId));
  const names = new Map<string, string>();
  for (const profile of profiles) {
    const id = String(profile.slack_contact || "").match(/U[A-Z0-9]{8,}/)?.[0];
    if (id) names.set(id, profile.full_name.replace(/\s+/g, " ").trim());
  }

  const message = action.message;
  if (!message?.user || message.bot_id) {
    return reply(action.response_url, ":warning: Solo se pueden enviar a TP OPS los EOD escritos por una persona.");
  }
  const author = bySlack(message.user);
  if (!author) {
    return reply(action.response_url, ":warning: El autor de este mensaje no está vinculado a un usuario de TP OPS. Agrega su Slack en *Contacto de Slack* (Equipo) y vuelve a intentarlo.");
  }
  if (author.role === "superadmin" || !author.permissions?.eod_reports) {
    return reply(action.response_url, `:warning: ${author.full_name} no entrega reportes EOD en TP OPS.`);
  }
  const presser = bySlack(action.user.id);
  const isAdmin = presser && (presser.role === "superadmin" || Boolean(presser.permissions?.operations_admin));
  if (!presser || (presser.id !== author.id && !isAdmin)) {
    return reply(action.response_url, ":lock: Solo el autor del EOD o un administrador de operaciones puede enviarlo a TP OPS.");
  }

  const notes = eodPlainText(message.text || "", names);
  if (notes.length < 20) return reply(action.response_url, ":warning: Este mensaje es muy corto para ser un reporte EOD.");
  const postedAt = new Date(Number(message.ts) * 1000);
  // EOD days follow US Eastern time (Kevin's time), like the EOD reports page.
  const { day, fromText } = reportDay(notes, postedAt, "America/New_York");
  const permalink = await slack("chat.getPermalink", { channel: action.channel.id, message_ts: message.ts });

  const { data: result, error: importError } = await admin.rpc("import_slack_eod", {
    p_user_id: author.id, p_report_date: day, p_notes: notes.length > 5000 ? `${notes.slice(0, 4990)}…` : notes,
    p_slack_channel_id: action.channel.id, p_slack_ts: message.ts,
    p_slack_permalink: String(permalink.permalink || ""), p_submitted_at: postedAt.toISOString(),
  });
  if (importError) {
    console.error("EOD import failed", importError);
    return reply(action.response_url, `:x: No se pudo guardar el EOD en TP OPS: ${importError.message}`);
  }
  const who = author.full_name.replace(/\s+/g, " ").trim();
  const when = `${prettyDate(day)}${fromText ? "" : " (fecha del mensaje)"}`;
  if (result === "exists_in_tops") {
    return reply(action.response_url, `:information_source: ${who} ya tiene un EOD del ${when} escrito en TP OPS, así que no lo reemplacé. <${APP_URL}/eod-reports|Ver en TP OPS>`);
  }
  if (result === "unchanged") {
    return reply(action.response_url, `:white_check_mark: Este EOD de ${who} del ${when} ya estaba guardado en TP OPS. <${APP_URL}/eod-reports|Ver en TP OPS>`);
  }
  if (result === "newer_exists") {
    return reply(action.response_url, `:information_source: Ya hay un EOD más reciente de ${who} para el ${when} guardado desde Slack, así que no lo reemplacé. <${APP_URL}/eod-reports|Ver en TP OPS>`);
  }
  if (result === "created" || result === "updated") {
    await slack("reactions.add", { channel: action.channel.id, timestamp: message.ts, name: "white_check_mark" });
  }
  return reply(action.response_url, `:white_check_mark: EOD de ${who} del ${when} ${result === "updated" ? "actualizado" : "guardado"} en TP OPS. <${APP_URL}/eod-reports|Ver en TP OPS>`);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.text();
  if (!(await validSignature(request, body))) return new Response("Invalid signature", { status: 401 });
  let action: MessageAction;
  try {
    action = JSON.parse(new URLSearchParams(body).get("payload") || "{}");
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  if (action.type === "message_action" && action.callback_id === "send_to_tp_ops") {
    // Slack needs an answer within 3 seconds: acknowledge now, save and reply in the background.
    const work = sendEodToTpOps(action).catch(async (error) => {
      console.error("Send to TP OPS failed", error);
      await reply(action.response_url, ":x: No se pudo guardar el EOD en TP OPS. Inténtalo de nuevo en un momento.");
    });
    // deno-lint-ignore no-explicit-any
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
  }
  return new Response("", { status: 200 });
});
