import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { getDocumentProxy } from "npm:unpdf@0.12.1";
import { extractPairs, mapToClient, type TextItem } from "./parse.ts";

// Reads the GHL "Client Onboarding Form" PDF uploaded on "Crear cliente" and returns the dossier
// fields to pre-fill. Nothing is saved here: the person reviews the form and creates the client.
// Caller: an active TP OPS user (session token) or an internal check (x-tp-ops-key). Body: { file: base64 PDF }.

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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = adminClient();
    const internalKey = request.headers.get("x-tp-ops-key")?.trim() || "";
    if (internalKey) {
      // Internal checks (same scheduler key as the Slack integrations).
      const { data: valid } = await admin.rpc("verify_integration_webhook_token", { p_integration_name: "slack_ticket_sync", p_token_sha256: await sha256(internalKey) });
      if (valid !== true) return json({ error: "Invalid key" }, 401);
    } else {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData.user) return json({ error: "Inicia sesión de nuevo." }, 401);
      const { data: profile } = await admin.from("profiles").select("active").eq("id", userData.user.id).single();
      if (!profile?.active) return json({ error: "Usuario inactivo." }, 403);
    }

    const body = await request.json().catch(() => ({})) as { file?: string };
    const base64 = String(body.file || "").replace(/^data:[^,]*,/, "");
    if (!base64) return json({ error: "Sube el PDF del formulario." }, 400);
    if (base64.length > 14_000_000) return json({ error: "El PDF pesa más de 10 MB." }, 400);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return json({ error: "El archivo no es un PDF." }, 400);

    const pdf = await getDocumentProxy(bytes);
    const items: TextItem[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 10); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
        if (typeof item.str !== "string" || !item.transform) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width || 0, height: item.height || Math.abs(item.transform[3]) || 10, page: pageNumber });
      }
    }
    const { pairs, submittedAt } = extractPairs(items);
    const fields = mapToClient(pairs, submittedAt);
    if (!fields.business_name && !fields.email && !fields.phone) {
      return json({ error: "No reconocí el formulario de onboarding de GHL en este PDF.", pairs }, 422);
    }
    return json({ fields, pairs, submittedAt });
  } catch (error) {
    console.error("parse-onboarding-pdf failed", error);
    return json({ error: "No se pudo leer el PDF." }, 500);
  }
});
