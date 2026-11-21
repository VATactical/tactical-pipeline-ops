import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "npm:pdf-lib@1.17.1";

// Builds a PDF of the client's onboarding-form answers and uploads it to the client's Slack channel.
// Called by the clients trigger when a Slack channel gets linked (x-tp-ops-key, integration
// 'slack_ticket_sync'), body { client_id, force? } or { task: "check" } to test the Slack scope.
// Private data kept in the vault (EIN, personal phone/email, logins) is never put in the PDF.
// Needs the SLACK_BOT_TOKEN secret with the files:write scope.

const SLACK_API = "https://slack.com/api";
const APP_URL = Deno.env.get("TP_OPS_APP_URL") || "https://app.tacticalpipeline.com";
const WAIT_FOR_SCOPE = new Set(["missing_scope", "not_allowed_token_type", "invalid_auth", "not_authed", "account_inactive", "token_revoked"]);
type Admin = ReturnType<typeof adminClient>;
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

// Helvetica only covers WinAnsi: normalise typographic characters and drop the rest (emoji etc.).
const pdfSafe = (input: unknown) => String(input ?? "")
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
  .replace(/•/g, "-").replace(/…/g, "...").replace(/ /g, " ").replace(/\r/g, "")
  .replace(/[^\n\x20-\x7e¡-ÿ]/g, "").trim();
const empty = (value: unknown) => value === null || value === undefined || /^\s*$/.test(String(value))
  || /^(null|undefined|n\/?a|none)$/i.test(String(value).trim());
const yesNo = (value: unknown) => value === true ? "Yes" : value === false ? "No" : "";
const money = (value: unknown) => Number(value) > 0 ? `$${Number(value)}` : "";

function sections(client: Row): [string, [string, unknown][]][] {
  const address = client.address as string;
  return [
    ["Business", [
      ["Business name", client.business_name], ["Registered business name", client.legal_name], ["Owner", client.owner_name],
      ["Business phone", client.phone], ["Business email", client.email], ["Contact email", client.contact_email],
      ["Address", address], ["Time zone", client.timezone], ["EIN / legal info", client.legal_business_info],
    ]],
    ["Services and offer", [
      ["Services", client.services], ["Offer / promotions", client.offer], ["Daily budget", money(client.daily_budget)],
      ["Minimum project", money(client.minimum_project)], ["Ideal customer", client.ideal_customer_profile],
    ]],
    ["Service area and targeting", [
      ["Cities / regions", client.markets], ["Ads targeting address", client.ads_targeting_address],
      ["Radius", Number(client.targeting_radius_miles) > 0 ? `${client.targeting_radius_miles} miles` : ""],
      ["Target ZIP codes", client.target_zip_codes], ["Exclusions", client.exclusions],
    ]],
    ["Online presence", [
      ["Website", client.website_url], ["Website request", client.website_build_request], ["Website timeline", client.website_timeline],
      ["Needs website / funnel", yesNo(client.needs_website_funnel)], ["Domain", client.domain],
      ["Facebook page", client.facebook_page_url || client.facebook_business_info], ["Instagram", client.instagram_url],
      ["Instagram needed", yesNo(client.instagram_needed)], ["Google Business Profile", client.gbp_link], ["GBP status", client.gbp_status],
      ["Meta business portfolio", client.meta_business_portfolio_id], ["Meta ad account", client.meta_ad_account_id],
    ]],
    ["Onboarding", [
      ["Onboarding call language", client.onboarding_call_language], ["Availability", client.appointment_availability],
      ["Target launch date", client.target_launch_date], ["Brand assets", client.available_assets],
      ["Drive folder", client.drive_folder_link], ["Additional notes", client.onboarding_form_notes],
    ]],
  ];
}

async function buildPdf(client: Row) {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${client.code} ${client.business_name} - Client Onboarding Form`));
  doc.setAuthor("TP OPS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50, width = 612, height = 792, labelWidth = 150, valueX = margin + labelWidth, valueWidth = width - margin - valueX;
  let page: PDFPage = doc.addPage([width, height]);
  let y = height - margin;
  const ensure = (needed: number) => {
    if (y - needed < margin) { page = doc.addPage([width, height]); y = height - margin; }
  };
  const wrap = (text: string, f: PDFFont, size: number, max: number) => {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let candidate = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(candidate, size) <= max) { line = candidate; continue; }
        if (line) lines.push(line);
        // Break words longer than the column (long URLs).
        candidate = word;
        while (f.widthOfTextAtSize(candidate, size) > max) {
          let cut = candidate.length - 1;
          while (cut > 1 && f.widthOfTextAtSize(candidate.slice(0, cut), size) > max) cut -= 1;
          lines.push(candidate.slice(0, cut));
          candidate = candidate.slice(cut);
        }
        line = candidate;
      }
      lines.push(line);
    }
    return lines;
  };

  page.drawText(pdfSafe("Client Onboarding Form"), { x: margin, y, size: 20, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 26;
  page.drawText(pdfSafe(`${client.code} - ${client.business_name || client.legal_name}`), { x: margin, y, size: 13, font: bold, color: rgb(0.2, 0.2, 0.2) });
  y -= 18;
  const submitted = client.intake_form_completed_at
    ? new Date(String(client.intake_form_completed_at)).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " EST"
    : "";
  page.drawText(pdfSafe(`Submitted ${submitted || "-"}   |   Generated by TP OPS`), { x: margin, y, size: 9, font, color: rgb(0.45, 0.45, 0.45) });
  y -= 24;

  for (const [title, fields] of sections(client)) {
    const rows = fields.filter(([, value]) => !empty(value)).map(([label, value]) => [label, pdfSafe(value)] as [string, string]).filter(([, v]) => v);
    if (!rows.length) continue;
    ensure(40);
    page.drawText(pdfSafe(title.toUpperCase()), { x: margin, y, size: 10, font: bold, color: rgb(0.13, 0.33, 0.62) });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rgb(0.8, 0.84, 0.9) });
    y -= 14;
    for (const [label, value] of rows) {
      const lines = wrap(value, font, 10, valueWidth);
      const labelLines = wrap(label, bold, 9, labelWidth - 10);
      ensure(Math.max(lines.length, labelLines.length) * 13 + 6);
      labelLines.forEach((line, index) => page.drawText(line, { x: margin, y: y - index * 13, size: 9, font: bold, color: rgb(0.35, 0.35, 0.35) }));
      lines.forEach((line, index) => {
        if (index && y - index * 13 < margin) return;
        page.drawText(line, { x: valueX, y: y - index * 13, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      });
      y -= Math.max(lines.length, labelLines.length) * 13 + 6;
    }
    y -= 10;
  }
  return await doc.save();
}

async function upload(token: string, channel: string, filename: string, bytes: Uint8Array, comment: string) {
  const ticket = await slack(token, "files.getUploadURLExternal", { filename, length: String(bytes.length) });
  if (!ticket.ok) return ticket;
  const put = await fetch(String(ticket.upload_url), { method: "POST", body: bytes });
  if (!put.ok) return { ok: false, error: `upload_http_${put.status}` };
  let done = await slack(token, "files.completeUploadExternal", {
    files: JSON.stringify([{ id: ticket.file_id, title: filename.replace(/\.pdf$/, "") }]), channel_id: channel, initial_comment: comment,
  });
  if (!done.ok && done.error === "not_in_channel") {
    const join = await slack(token, "conversations.join", { channel });
    if (join.ok) done = await slack(token, "files.completeUploadExternal", {
      files: JSON.stringify([{ id: ticket.file_id, title: filename.replace(/\.pdf$/, "") }]), channel_id: channel, initial_comment: comment,
    });
  }
  return { ...done, file_id: ticket.file_id };
}

async function postForm(admin: Admin, token: string, clientId: string, force: boolean) {
  const { data: client, error } = await admin.from("clients").select("*").eq("id", clientId).single();
  if (error || !client) return { status: "not_found" };
  const channel = String(client.slack_channel_link || "").match(/C[A-Z0-9]{8,}/)?.[0];
  if (!channel) return { status: "no_channel" };
  if (!client.intake_form_completed) return { status: "no_form" };
  const { data: prior } = await admin.from("client_form_pdf_posts").select("status, channel_id, attempts").eq("client_id", clientId).maybeSingle();
  if (prior?.status === "sent" && prior.channel_id === channel && !force) return { status: "already_sent" };

  const bytes = await buildPdf(client);
  const safeName = String(client.business_name || client.legal_name || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${client.code}-${safeName}-Onboarding-Form.pdf`;
  const comment = `:page_facing_up: *Client Onboarding Form* · ${client.code} ${client.business_name || client.legal_name}\nAnswers from GHL, as saved in TOPS. <${APP_URL}/clientes/${client.id}|Open in TOPS>`;
  const result = await upload(token, channel, filename, bytes, comment);
  const now = new Date().toISOString();
  const status = result.ok ? "sent" : WAIT_FOR_SCOPE.has(String(result.error)) ? "waiting_scope" : "failed";
  await admin.from("client_form_pdf_posts").upsert({
    client_id: clientId, channel_id: channel, status, error: result.ok ? "" : `Slack: ${result.error}`,
    slack_file_id: result.ok ? String(result.file_id || "") : null, bytes: bytes.length,
    attempts: ((prior as Row | null)?.attempts as number || 0) + 1, posted_at: result.ok ? now : null, updated_at: now,
  });
  return { status, error: result.ok ? undefined : result.error, bytes: bytes.length };
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
    const body = await request.json().catch(() => ({})) as { client_id?: string; force?: boolean; task?: string };

    if (body.task === "check") {
      // Builds a PDF for a client without uploading it, and asks Slack for an upload URL to test files:write.
      const { data: client } = await admin.from("clients").select("*").eq("id", String(body.client_id || "")).maybeSingle();
      const bytes = client ? await buildPdf(client) : new Uint8Array();
      const ticket = await slack(token, "files.getUploadURLExternal", { filename: "scope-check.pdf", length: "10" });
      return json({ pdf_bytes: bytes.length, files_write: ticket.ok === true, slack_error: ticket.ok ? undefined : ticket.error });
    }
    if (body.task === "preview") {
      // Returns the PDF as base64 without posting it (for review).
      const { data: client } = await admin.from("clients").select("*").eq("id", String(body.client_id || "")).maybeSingle();
      if (!client) return json({ error: "Client not found" }, 404);
      const bytes = await buildPdf(client);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return json({ bytes: bytes.length, pdf_base64: btoa(binary) });
    }
    if (body.task === "retry") {
      const { data: rows } = await admin.from("client_form_pdf_posts").select("client_id").eq("status", "waiting_scope").limit(20);
      const results = [];
      for (const row of rows || []) results.push(await postForm(admin, token, String(row.client_id), false));
      return json({ retried: results.length, results });
    }
    if (!body.client_id) return json({ error: "client_id required" }, 400);
    return json(await postForm(admin, token, String(body.client_id), body.force === true));
  } catch (error) {
    console.error("Onboarding form PDF failed", error);
    return json({ error: String((error as Error).message || error).slice(0, 300) }, 500);
  }
});
