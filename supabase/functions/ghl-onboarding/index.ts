import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

type Payload = Record<string, unknown>;

const jsonHeaders = { "Content-Type": "application/json" };
const webhookTokenSha256 = "c97fcd2e5c6af79de316b020dce025355c1aaf02651f207f159e18fb5585b416";
const text = (value: unknown, max = 5000) => String(value ?? "").trim().slice(0, max);
const emptyValue = (value: string) => !value || /^(null|undefined|n\/?a|none|pending)$/i.test(value);
const fieldText = (value: unknown, max = 5000) => {
  const valueText = text(value, max);
  return emptyValue(valueText) ? "" : valueText;
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || Deno.env.get("SUPABASE_SECRET_KEY")
    || secretKeys.default;
  if (!secretKey) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(request: Request) {
  const provided = request.headers.get("x-tp-ops-key")?.trim() || "";
  if (!provided) return false;
  const providedHash = await sha256(provided);
  return safeEqual(providedHash, webhookTokenSha256);
}

async function nextClientCode(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase.rpc("reserve_next_client_code");
  if (error) throw error;
  return String(data);
}

function clientChanges(payload: Payload) {
  const firstName = fieldText(payload.first_name, 200);
  const lastName = fieldText(payload.last_name, 200);
  const distinctNameParts = firstName && lastName && firstName.toLowerCase() === lastName.toLowerCase()
    ? [firstName]
    : [firstName, lastName].filter(Boolean);
  const submittedFullName = fieldText(payload.full_name, 300);
  const fullName = firstName && lastName && firstName.toLowerCase() === lastName.toLowerCase()
    ? firstName
    : submittedFullName || distinctNameParts.join(" ");
  const businessName = fieldText(payload.business_name, 300) || fieldText(payload.company_name, 300);
  const legalName = fieldText(payload.registered_business_name, 300);
  const website = fieldText(payload.website, 1000);
  const wantsWebsite = /would like (a )?website|website included|i need (a website|one)|need a website|necesito.*sitio/i.test(website);
  const facebook = text(payload.facebook, 1000);
  const submittedAt = text(payload.submitted_at, 100) || new Date().toISOString();
  const date = Number.isNaN(Date.parse(submittedAt)) ? new Date().toISOString() : new Date(submittedAt).toISOString();
  const changes: Record<string, unknown> = {
    legal_name: legalName,
    business_name: businessName || legalName,
    owner_name: fullName,
    phone: fieldText(payload.business_phone, 100),
    email: fieldText(payload.business_email, 300),
    services: fieldText(payload.services),
    offer: fieldText(payload.offer),
    markets: fieldText(payload.service_areas),
    target_zip_codes: fieldText(payload.service_areas),
    website_url: wantsWebsite || emptyValue(website) ? "" : website,
    needs_website_funnel: wantsWebsite ? true : emptyValue(website) ? null : false,
    facebook_page_url: /^https?:\/\//i.test(facebook) ? facebook : "",
    facebook_business_info: /^https?:\/\//i.test(facebook) ? "" : facebook,
    instagram_url: emptyValue(text(payload.instagram, 1000)) ? "" : text(payload.instagram, 1000),
    available_assets: text(payload.assets),
    onboarding_form_notes: text(payload.additional_notes),
    legal_business_info: text(payload.ein) ? "Received" : "",
    status: "ONBOARDING",
    phase: "Intake received",
    next_action: "Review onboarding form and complete missing dossier fields",
    intake_form_completed: true,
    intake_form_completed_at: date,
    intake_source: "ghl_form",
    ghl_contact_id: text(payload.contact_id, 200),
    ghl_location_id: text(payload.location_id, 200),
    ghl_form_id: text(payload.form_id, 200),
    onboarding_date: date.slice(0, 10),
    assigned_role: "onboarding_media",
    updated_at: new Date().toISOString(),
  };
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== "" && value !== undefined));
}

async function findClient(supabase: ReturnType<typeof adminClient>, payload: Payload) {
  const locationId = text(payload.location_id, 200);
  const contactId = text(payload.contact_id, 200);
  const businessEmail = fieldText(payload.business_email, 300);
  const personalEmail = fieldText(payload.personal_email, 300);
  const legalName = fieldText(payload.registered_business_name, 300);
  const businessName = fieldText(payload.business_name, 300) || fieldText(payload.company_name, 300);

  let query = await supabase.from("clients").select("*")
    .eq("ghl_location_id", locationId).eq("ghl_contact_id", contactId).maybeSingle();
  if (query.error) throw query.error;
  if (query.data) return query.data;

  const email = businessEmail || personalEmail;
  if (email) {
    query = await supabase.from("clients").select("*").ilike("email", email).limit(1).maybeSingle();
    if (query.error) throw query.error;
    if (query.data) return query.data;
  }

  if (legalName) {
    query = await supabase.from("clients").select("*").ilike("legal_name", legalName).limit(1).maybeSingle();
    if (query.error) throw query.error;
    if (query.data) return query.data;

    // Clients may be created manually before their first GHL form import.
    // In that case legal_name and the GHL identifiers can still be empty,
    // while business_name already contains the registered business name.
    query = await supabase.from("clients").select("*").ilike("business_name", legalName).limit(1).maybeSingle();
    if (query.error) throw query.error;
    if (query.data) return query.data;
  }
  if (businessName) {
    query = await supabase.from("clients").select("*").ilike("business_name", businessName).limit(1).maybeSingle();
    if (query.error) throw query.error;
    if (query.data) return query.data;
  }
  return null;
}

async function writeSecrets(supabase: ReturnType<typeof adminClient>, clientId: string, payload: Payload) {
  const { error } = await supabase.rpc("save_ghl_client_secrets", {
    p_client_id: clientId,
    p_personal_phone: text(payload.personal_phone, 100),
    p_personal_email: text(payload.personal_email, 300),
    p_gbp_access_email: text(payload.gbp_email, 300),
    p_ein_tax_id: text(payload.ein, 300),
  });
  if (error) throw error;
}

async function notifyOperations(supabase: ReturnType<typeof adminClient>, client: Record<string, unknown>, action: string) {
  const { data: profiles, error } = await supabase.from("profiles")
    .select("id, role, permissions").eq("active", true);
  if (error) throw error;
  const recipients = (profiles || []).filter((profile) => profile.role === "superadmin"
    || profile.role === "onboarding_media"
    || profile.permissions?.operations_admin === true);
  if (!recipients.length) return;
  const rows = recipients.map((profile) => ({
    recipient_id: profile.id,
    title: "New GHL onboarding form received",
    body: `${client.code} · ${client.business_name} was ${action} from the Client Onboarding Form.`,
    source_type: "ghl_form_import",
    source_id: String(client.id),
    notify_at: new Date().toISOString(),
  }));
  const { error: notificationError } = await supabase.from("notifications").insert(rows);
  if (notificationError) throw notificationError;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const supabase = adminClient();
  if (!(await authenticate(request))) return response({ error: "Unauthorized" }, 401);

  const rawBody = await request.text();
  if (rawBody.length > 100_000) return response({ error: "Payload too large" }, 413);

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response({ error: "Invalid JSON" }, 400);
  }

  const locationId = text(payload.location_id, 200);
  const contactId = text(payload.contact_id, 200);
  const formId = text(payload.form_id, 200);
  const legalName = fieldText(payload.registered_business_name, 300);
  const businessName = fieldText(payload.business_name, 300) || fieldText(payload.company_name, 300);
  if (!locationId || !contactId || (!legalName && !businessName)) {
    return response({ error: "location_id, contact_id, and a business name are required" }, 422);
  }

  const eventKey = text(payload.event_id, 300) || await sha256([
    locationId, contactId, formId, text(payload.submitted_at, 100), rawBody,
  ].join("|"));

  let { data: receipt, error: receiptError } = await supabase.from("ghl_form_imports").insert({
    event_key: eventKey,
    location_id: locationId,
    contact_id: contactId,
    form_id: formId,
  }).select("id").single();

  if (receiptError?.code === "23505") {
    const { data: prior, error: priorError } = await supabase.from("ghl_form_imports")
      .select("id, status").eq("event_key", eventKey).single();
    if (priorError) return response({ error: "Could not check duplicate receipt" }, 500);
    if (prior.status === "processed") return response({ ok: true, duplicate: true });
    receipt = { id: prior.id };
    receiptError = null;
    await supabase.from("ghl_form_imports").update({
      status: "received",
      error_message: "",
      processed_at: null,
    }).eq("id", prior.id);
  }
  if (receiptError) return response({ error: "Could not register form receipt" }, 500);

  const { error: payloadError } = await supabase.rpc("store_ghl_form_payload", {
    p_import_id: receipt!.id,
    p_payload: payload,
  });
  if (payloadError) return response({ error: "Could not secure form payload" }, 500);

  try {
    const existing = await findClient(supabase, payload);
    const changes = clientChanges(payload);
    let client: Record<string, unknown>;
    let action: "created" | "updated";

    if (existing) {
      const safeChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => {
        const current = existing[key];
        return current === null || current === "" || emptyValue(text(current)) || key.startsWith("ghl_")
          || ["intake_form_completed", "intake_form_completed_at", "intake_source", "phase", "next_action", "updated_at"].includes(key);
      }));
      const { data, error } = await supabase.from("clients").update(safeChanges)
        .eq("id", existing.id).select("*").single();
      if (error) throw error;
      client = data;
      action = "updated";
    } else {
      const code = await nextClientCode(supabase);
      const { data, error } = await supabase.from("clients").insert({
        id: crypto.randomUUID(),
        code,
        ...changes,
      }).select("*").single();
      if (error) throw error;
      client = data;
      action = "created";
    }

    await writeSecrets(supabase, String(client.id), payload);

    const changedFields = Object.keys(changes).filter((field) => ![
      "updated_at", "intake_source", "ghl_contact_id", "ghl_location_id", "ghl_form_id",
    ].includes(field));
    await supabase.from("client_audit_log").insert({
      client_id: client.id,
      actor_name: "GHL Form",
      actor_role: "system",
      action: "ghl_form_imported",
      changed_fields: changedFields,
      summary: `Client ${action} automatically from Client Onboarding Form`,
    });

    await notifyOperations(supabase, client, action);
    await supabase.from("ghl_form_imports").update({
      client_id: client.id,
      status: "processed",
      action,
      processed_at: new Date().toISOString(),
    }).eq("id", receipt!.id);

    return response({ ok: true, action, client_code: client.code });
  } catch (error) {
    console.error("GHL onboarding import failed", error);
    await supabase.from("ghl_form_imports").update({
      status: "failed",
      error_message: "The form could not be imported. Review the Edge Function logs.",
      processed_at: new Date().toISOString(),
    }).eq("id", receipt!.id);
    return response({ ok: false, error: "Import failed" }, 500);
  }
});
