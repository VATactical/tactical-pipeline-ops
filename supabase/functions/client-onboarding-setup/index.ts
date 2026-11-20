import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

// One-click onboarding for a client, from TP OPS:
//   slack: creates the public channel "c25-business-name", invites the linked team, sets the topic
//          and posts a welcome note (Slack scope channels:manage; chat:write).
//   drive: creates "#C25 Business Name" with Images / Documents / VIDEOS ( Raw Videos ) / Ad Creatives
//          in the agency's clients folder (Google service account in GOOGLE_SERVICE_ACCOUNT_JSON, added to
//          that Shared Drive; folder in GOOGLE_DRIVE_CLIENTS_FOLDER_ID).
//   doc:   creates the dossier as a Google Doc inside Documents, from the text TP OPS sends.
// Each step only runs when the client does not have it yet, and saves the link in the dossier.
// The board card already exists: every new client starts on the lifecycle board.
// Caller: a signed-in TP OPS user who can edit clients.

const APP_URL = "https://app.tacticalpipeline.com";
const WORKSPACE_URL = Deno.env.get("SLACK_WORKSPACE_URL") || "https://tacticalpipel-cck5989.slack.com";
const DRIVE_PARENT = Deno.env.get("GOOGLE_DRIVE_CLIENTS_FOLDER_ID") || "0AD5rcMKpkAS1Uk9PVA";
const SUBFOLDERS = ["Images", "Documents", "VIDEOS ( Raw Videos )", "Ad Creatives"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Step = { status: "created" | "exists" | "linked" | "skipped" | "not_configured" | "error"; url?: string; message?: string };
type Client = Record<string, unknown> & { id: string; code: string; business_name: string };

// ---------- Slack ----------
async function slack(method: string, params: Record<string, string>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SLACK_BOT_TOKEN") || ""}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as Record<string, unknown>;
}

export function channelName(code: string, business: string) {
  const slug = `${code} ${business}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 80).replace(/-+$/, "");
}

async function findChannel(name: string) {
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const params: Record<string, string> = { types: "public_channel", exclude_archived: "true", limit: "1000" };
    if (cursor) params.cursor = cursor;
    const body = await slack("conversations.list", params);
    if (!body.ok) return null;
    const found = ((body.channels as { id: string; name: string }[]) || []).find((channel) => channel.name === name);
    if (found) return found;
    cursor = String((body.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || "");
    if (!cursor) return null;
  }
  return null;
}

async function setupSlack(admin: ReturnType<typeof adminClient>, client: Client, actorName: string): Promise<Step> {
  const existing = String(client.slack_channel_link || "").match(/C[A-Z0-9]{8,}/)?.[0];
  if (existing) return { status: "exists", url: String(client.slack_channel_link) };
  if (!Deno.env.get("SLACK_BOT_TOKEN")) return { status: "not_configured", message: "Falta SLACK_BOT_TOKEN." };

  const name = channelName(client.code, client.business_name);
  let channelId = "";
  let status: Step["status"] = "created";
  const created = await slack("conversations.create", { name, is_private: "false" });
  if (created.ok) {
    channelId = String((created.channel as { id: string }).id);
  } else if (created.error === "name_taken") {
    const found = await findChannel(name);
    if (!found) return { status: "error", message: `Ya existe un canal #${name} que no pude encontrar.` };
    channelId = found.id;
    status = "linked";
    await slack("conversations.join", { channel: channelId });
  } else if (created.error === "missing_scope") {
    return { status: "not_configured", message: "La app de Slack necesita el permiso channels:manage (y reinstalarla)." };
  } else {
    return { status: "error", message: `Slack: ${created.error}` };
  }

  // Invite the active team linked to Slack.
  const { data: team } = await admin.from("profiles").select("slack_contact").eq("active", true).is("deleted_at", null);
  const users = [...new Set((team || []).map((row) => String(row.slack_contact || "").match(/[UW][A-Z0-9]{8,}/)?.[0]).filter(Boolean))] as string[];
  if (users.length) await slack("conversations.invite", { channel: channelId, users: users.join(","), force: "true" });

  const clientUrl = `${APP_URL}/clientes/${client.id}`;
  await slack("conversations.setTopic", { channel: channelId, topic: `${client.code} · ${client.business_name} — TP OPS: ${clientUrl}`.slice(0, 250) });
  await slack("chat.postMessage", {
    channel: channelId, unfurl_links: "false",
    text: `:wave: Canal de *${client.code} · ${client.business_name}* creado desde TP OPS por ${actorName}.\nDossier, checklist y tickets: <${clientUrl}|Abrir en TP OPS>`,
  });

  const url = `${WORKSPACE_URL}/archives/${channelId}`;
  await admin.from("clients").update({ slack_channel_link: url, updated_at: new Date().toISOString() }).eq("id", client.id);
  return { status, url, message: `#${name}` };
}

// ---------- Google Drive ----------
const base64url = (input: ArrayBuffer | string) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function googleToken() {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  const account = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/drive", aud: tokenUri, iat: now, exp: now + 3600,
  }))}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`Google: ${body.error_description || body.error || response.status}`);
  return String(body.access_token);
}

async function driveFolder(token: string, name: string, parent: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  const body = await response.json();
  if (!body.id) throw new Error(`Drive: ${body.error?.message || response.status}`);
  return body as { id: string; webViewLink: string };
}

async function driveChildren(token: string, parent: string) {
  const query = encodeURIComponent(`'${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,webViewLink)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  return (body.files || []) as { id: string; name: string; webViewLink: string }[];
}

async function setupDrive(admin: ReturnType<typeof adminClient>, client: Client, token: string | null): Promise<Step & { documentsId?: string }> {
  const existingId = String(client.drive_folder_link || "").match(/folders\/([A-Za-z0-9_-]{10,})/)?.[1];
  if (existingId) {
    let documentsId: string | undefined;
    if (token) documentsId = (await driveChildren(token, existingId).catch(() => [])).find((folder) => /^documents?$/i.test(folder.name.trim()) || /important documents/i.test(folder.name))?.id || existingId;
    return { status: "exists", url: String(client.drive_folder_link), documentsId };
  }
  if (!token) return { status: "not_configured", message: "Falta conectar Google Drive (cuenta de servicio)." };

  const root = await driveFolder(token, `#${client.code} ${client.business_name}`, DRIVE_PARENT);
  const created: Record<string, { id: string; webViewLink: string }> = {};
  for (const name of SUBFOLDERS) created[name] = await driveFolder(token, name, root.id);
  const changes: Record<string, unknown> = { drive_folder_link: root.webViewLink, drive_folder_created: true, updated_at: new Date().toISOString() };
  if (!String(client.ad_creatives_link || "").trim()) changes.ad_creatives_link = created["Ad Creatives"].webViewLink;
  await admin.from("clients").update(changes).eq("id", client.id);
  return { status: "created", url: root.webViewLink, documentsId: created.Documents.id, message: SUBFOLDERS.join(" · ") };
}

async function setupDoc(admin: ReturnType<typeof adminClient>, client: Client, token: string | null, parent: string | undefined, text: string, actorId: string): Promise<Step> {
  if (String(client.google_docs_url || "").trim()) return { status: "exists", url: String(client.google_docs_url) };
  if (!token) return { status: "not_configured", message: "Falta conectar Google Drive (cuenta de servicio)." };
  if (!parent) return { status: "skipped", message: "Primero hace falta la carpeta de Drive." };
  if (!text.trim()) return { status: "skipped", message: "No llegó el texto del dossier." };
  const boundary = `tpops${crypto.randomUUID()}`;
  const metadata = { name: `Dossier · ${client.code} ${client.business_name}`, mimeType: "application/vnd.google-apps.document", parents: [parent] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = await response.json();
  if (!file.id) return { status: "error", message: `Docs: ${file.error?.message || response.status}` };
  await admin.from("clients").update({
    google_docs_url: file.webViewLink, google_docs_updated_at: new Date().toISOString(), google_docs_updated_by: actorId, updated_at: new Date().toISOString(),
  }).eq("id", client.id);
  return { status: "created", url: file.webViewLink };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = adminClient();
    const jwt = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: "Inicia sesión de nuevo." }, 401);
    const { data: actor } = await admin.from("profiles").select("id, full_name, role, active, permissions").eq("id", userData.user.id).single();
    const permissions = (actor?.permissions || {}) as Record<string, boolean>;
    if (!actor?.active || (actor.role !== "superadmin" && !permissions.clients_edit)) return json({ error: "No tienes permiso para editar clientes." }, 403);

    const body = await request.json().catch(() => ({})) as { clientId?: string; steps?: string[]; dossierText?: string };
    const steps = new Set(body.steps?.length ? body.steps : ["slack", "drive", "doc"]);
    const { data: client, error: clientError } = await admin.from("clients").select("*").eq("id", body.clientId || "").single();
    if (clientError || !client) return json({ error: "El cliente no existe." }, 404);
    const actorName = String(actor.full_name || "TP OPS").replace(/\s+/g, " ").trim();

    const results: Record<string, Step> = {};
    if (steps.has("slack")) {
      try { results.slack = await setupSlack(admin, client as Client, actorName); } catch (error) { results.slack = { status: "error", message: String((error as Error).message || error) }; }
    }
    let token: string | null = null;
    let tokenError = "";
    if (steps.has("drive") || steps.has("doc")) {
      try { token = await googleToken(); } catch (error) { tokenError = String((error as Error).message || error); }
    }
    let documentsId: string | undefined;
    if (steps.has("drive")) {
      if (tokenError) results.drive = { status: "error", message: tokenError };
      else {
        try { const drive = await setupDrive(admin, client as Client, token); documentsId = drive.documentsId; delete drive.documentsId; results.drive = drive; }
        catch (error) { results.drive = { status: "error", message: String((error as Error).message || error) }; }
      }
    }
    if (steps.has("doc")) {
      if (tokenError) results.doc = { status: "error", message: tokenError };
      else {
        try {
          const { data: fresh } = await admin.from("clients").select("*").eq("id", client.id).single();
          if (!documentsId && token) {
            const folderId = String(fresh?.drive_folder_link || "").match(/folders\/([A-Za-z0-9_-]{10,})/)?.[1];
            if (folderId) documentsId = (await driveChildren(token, folderId).catch(() => [])).find((folder) => /^documents?$/i.test(folder.name.trim()))?.id || folderId;
          }
          results.doc = await setupDoc(admin, (fresh || client) as Client, token, documentsId, String(body.dossierText || ""), actor.id);
        } catch (error) { results.doc = { status: "error", message: String((error as Error).message || error) }; }
      }
    }

    const done = Object.entries(results).filter(([, step]) => step.status === "created" || step.status === "linked");
    if (done.length) {
      const labels: Record<string, string> = { slack: "canal de Slack", drive: "carpeta de Drive", doc: "dossier en Google Docs" };
      await admin.from("client_comments").insert({
        client_id: client.id, author_id: actor.id, kind: "update",
        body: `Onboarding automático: ${done.map(([key, step]) => `${labels[key]}${step.url ? ` ${step.url}` : ""}`).join(" · ")}`,
      });
    }
    return json({ results });
  } catch (error) {
    console.error("Onboarding setup failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
