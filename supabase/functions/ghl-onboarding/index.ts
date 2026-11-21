import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

type Payload = Record<string, unknown>;
const jsonHeaders = { "Content-Type": "application/json" };
const text = (value: unknown, max = 5000) => String(value ?? "").trim().slice(0, max);
const emptyValue = (value: string) => !value || /^(null|undefined|n\/?a|none|pending)$/i.test(value);
const fieldText = (value: unknown, max = 5000) => {
  const valueText = text(value, max);
  return emptyValue(valueText) ? "" : valueText;
};
const value = (payload: Payload, ...keys: string[]) => {
  for (const key of keys) {
    const result = fieldText(payload[key]);
    if (result) return result;
  }
  return "";
};
const booleanValue = (payload: Payload, ...keys: string[]) => {
  const result = value(payload, ...keys).toLowerCase();
  if (["true", "yes", "1", "confirmed", "complete", "completed", "sí", "si"].includes(result)) return true;
  if (["false", "no", "0", "not confirmed", "pending"].includes(result)) return false;
  return null;
};
function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
async function sha256(input: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
// Escape LIKE wildcards so business names/emails containing % or _ match literally.
const likeLiteral = (input: string) => input.replace(/[\\%_]/g, (character) => `\\${character}`);
function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretKeys.default;
  if (!key) throw new Error("Supabase server credential is unavailable.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
// The token hash lives in private.integration_webhook_tokens (never in this public repo),
// so it can be rotated without a redeploy.
async function authenticate(supabase: ReturnType<typeof adminClient>, request: Request) {
  const provided = request.headers.get("x-tp-ops-key")?.trim() || "";
  if (provided.length < 32) return false;
  const { data, error } = await supabase.rpc("verify_integration_webhook_token", {
    p_integration_name: "ghl_onboarding",
    p_token_sha256: await sha256(provided),
  });
  if (error) {
    console.error("GHL webhook token verification failed", error.message);
    return false;
  }
  return data === true;
}
async function nextClientCode(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase.rpc("reserve_next_client_code");
  if (error) throw error;
  return String(data);
}
function noteValue(notes: string, label: string, stopBefore: string[] = []) {
  const normalized = notes.toLowerCase();
  const start = normalized.indexOf(label.toLowerCase());
  if (start < 0) return "";
  const contentStart = start + label.length;
  let end = notes.length;
  for (const marker of stopBefore) {
    const markerIndex = normalized.indexOf(marker.toLowerCase(), contentStart);
    if (markerIndex >= 0 && markerIndex < end) end = markerIndex;
  }
  return notes.slice(contentStart, end).replace(/^\s*:?\s*/, "").replace(/[\s.;]+$/, "").trim();
}
function clientChanges(payload: Payload) {
  const businessName = value(payload, "business_name", "businessName", "company_name", "companyName");
  const legalName = value(payload, "registered_business_name", "legal_name", "legalName", "registeredBusinessName");
  const firstName = value(payload, "first_name", "firstName");
  const lastName = value(payload, "last_name", "lastName");
  const fullName = value(payload, "full_name", "fullName", "contact_name") || [firstName, lastName].filter(Boolean).join(" ");
  const notes = value(payload, "additional_notes", "notes", "additionalNotes");
  const website = value(payload, "website", "website_url", "websiteUrl", "landing_page_url");
  const websiteBuildRequest = value(payload, "website_build_request", "website_request", "websiteRequest")
    || noteValue(notes, "Website request", ["; estimated", "Appointment availability"]);
  const websiteTimeline = value(payload, "website_timeline", "website_estimated_timeline", "websiteTimeline")
    || noteValue(notes, "estimated", ["Appointment availability", "The form lists"]);
  const wantsWebsite = Boolean(websiteBuildRequest) || /would like (a )?website|website included|i need (a website|one)|need a website|necesito.*sitio|fully built.*website|ai website/i.test(website);
  const facebook = value(payload, "facebook", "facebook_page_url", "facebookPageUrl", "facebook_business_info");
  const instagram = value(payload, "instagram", "instagram_url", "instagramUrl");
  const instagramNeeded = booleanValue(payload, "instagram_needed", "instagram_required", "instagramNeeded")
    ?? (/\binstagram\s*:\s*(not needed|not required|no)\b/i.test(notes) ? false : /\binstagram\s*:\s*(needed|yes|required)\b/i.test(notes) ? true : null);
  const street = value(payload, "business_address", "address", "address1", "street_address", "streetAddress");
  const city = value(payload, "city");
  const state = value(payload, "state");
  const postalCode = value(payload, "postal_code", "postalCode", "zip", "zip_code");
  const markets = value(payload, "service_areas", "service_area", "markets", "serviceAreas");
  // "15 miles around the client's address" in the service-area answer, unless a radius is sent.
  const radiusText = value(payload, "targeting_radius_miles", "radius_miles", "radius") || (markets.match(/(\d{1,3})\s*(?:mi\b|miles?|millas)/i)?.[1] ?? "");
  const radius = Number.parseInt(radiusText, 10);
  const budgetValue = value(payload, "daily_budget", "ad_budget", "budget", "dailyBudget");
  const dailyBudget = budgetValue ? Number(budgetValue.replace(/[^0-9.]/g, "")) || 0 : 0;
  const submittedAt = value(payload, "submitted_at", "submittedAt") || new Date().toISOString();
  const date = Number.isNaN(Date.parse(submittedAt)) ? new Date().toISOString() : new Date(submittedAt).toISOString();
  const fields: Record<string, unknown> = {
    legal_name: legalName, business_name: businessName || legalName, owner_name: fullName,
    phone: value(payload, "business_phone", "businessPhone", "phone"),
    email: value(payload, "business_email", "businessEmail", "email"),
    contact_email: value(payload, "contact_email", "contactEmail", "personal_email", "personalEmail", "email"),
    contact_phone: value(payload, "personal_phone", "contact_phone", "contactPhone"),
    address: [street, city, [state, postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    ads_targeting_address: value(payload, "ads_targeting_address", "ads_targeting", "targeting_address", "adsTargetingAddress"),
    targeting_radius_miles: Number.isFinite(radius) && radius > 0 && radius <= 500 ? radius : null,
    timezone: value(payload, "timezone", "time_zone", "timeZone")
      || noteValue(notes, "The form lists", ["; confirm whether"]),
    services: value(payload, "services", "service_offering", "serviceOffering"),
    offer: value(payload, "offer", "promotion", "campaign_offer"),
    markets: value(payload, "service_areas", "service_area", "markets", "serviceAreas"),
    target_zip_codes: value(payload, "target_zip_codes", "zip_codes", "zip_code", "service_zip_codes", "targetZipCodes", "zipCodes"),
    daily_budget: dailyBudget,
    website_url: /^https?:\/\//i.test(website) ? website : wantsWebsite ? "" : website,
    needs_website_funnel: wantsWebsite ? true : emptyValue(website) ? null : false,
    website_build_request: websiteBuildRequest,
    website_timeline: websiteTimeline,
    onboarding_call_language: value(payload, "onboarding_call_language", "preferred_onboarding_language", "onboarding_language", "onboardingCallLanguage")
      || noteValue(notes, "Preferred onboarding-call language", ["Instagram"]),
    appointment_availability: value(payload, "appointment_availability", "appointmentAvailability", "availability")
      || noteValue(notes, "Appointment availability", ["The form lists", "EIN was not provided"]),
    instagram_needed: instagramNeeded,
    facebook_page_url: /^https?:\/\//i.test(facebook) ? facebook : "",
    facebook_business_info: /^https?:\/\//i.test(facebook) ? "" : facebook,
    meta_business_portfolio_id: value(payload, "meta_business_portfolio_id", "business_manager_id", "metaBusinessPortfolioId"),
    meta_ad_account_id: value(payload, "meta_ad_account_id", "ad_account_id", "metaAdAccountId"),
    instagram_url: instagramNeeded === false || /^(not needed|not required|no)$/i.test(instagram) ? "" : instagram,
    gbp_email: value(payload, "gbp_email", "google_business_email", "gbpEmail"),
    gbp_link: value(payload, "gbp_link", "google_business_profile_url", "googleBusinessProfileUrl"),
    gbp_status: value(payload, "gbp_status", "google_business_profile_status", "googleBusinessProfileStatus"),
    drive_folder_link: value(payload, "drive_folder_link", "google_drive_folder", "drive_url", "driveFolderLink"),
    ghl_subaccount_link: value(payload, "ghl_subaccount_link", "ghl_url", "ghlSubaccountLink"),
    domain: value(payload, "domain", "domain_name", "domainName"),
    landing_page_url: value(payload, "landing_page_url", "funnel_url", "landingPageUrl"),
    ad_strategy: value(payload, "ad_strategy", "campaign_strategy", "adStrategy"),
    ideal_customer_profile: value(payload, "ideal_customer_profile", "target_audience", "idealCustomerProfile"),
    target_launch_date: value(payload, "target_launch_date", "launch_date", "targetLaunchDate"),
    available_assets: value(payload, "assets", "available_assets", "campaign_materials"),
    onboarding_form_notes: value(payload, "additional_notes", "notes", "additionalNotes"),
    legal_business_info: value(payload, "ein", "tax_id")
      ? "Received"
      : /\bein (was )?not provided\b/i.test(notes) ? "Not provided" : "",
    status: "ONBOARDING", phase: "Intake received",
    intake_form_completed: true, intake_form_completed_at: date, intake_source: "ghl_form",
    ghl_contact_id: value(payload, "contact_id", "contactId"),
    ghl_location_id: value(payload, "location_id", "locationId"),
    ghl_form_id: value(payload, "form_id", "formId"),
    onboarding_date: date.slice(0, 10), assigned_role: "onboarding_media", updated_at: new Date().toISOString(),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== "" && field !== null && field !== undefined));
}
async function findClient(supabase: ReturnType<typeof adminClient>, payload: Payload) {
  const locationId = value(payload, "location_id", "locationId");
  const contactId = value(payload, "contact_id", "contactId");
  const businessEmail = value(payload, "business_email", "businessEmail", "email");
  const personalEmail = value(payload, "personal_email", "personalEmail", "contact_email", "contactEmail", "email");
  const legalName = value(payload, "registered_business_name", "legal_name", "legalName", "registeredBusinessName");
  const businessName = value(payload, "business_name", "businessName", "company_name", "companyName");
  const unique = async (column: string, match: string) => {
    if (!match) return null;
    const { data, error } = await supabase.from("clients").select("*").ilike(column, likeLiteral(match)).limit(2);
    if (error) throw error;
    if ((data || []).length > 1) throw new Error(`Ambiguous onboarding match for ${column}; manual review required`);
    return data?.[0] || null;
  };
  if (locationId && contactId) {
    const { data, error } = await supabase.from("clients").select("*").eq("ghl_location_id", locationId).eq("ghl_contact_id", contactId).limit(2);
    if (error) throw error;
    if ((data || []).length > 1) throw new Error("Ambiguous GHL identifiers; manual review required");
    if (data?.[0]) return data[0];
  }
  const emailMatch = await unique("email", businessEmail || personalEmail);
  if (emailMatch) return emailMatch;
  if (legalName) {
    const legalMatch = await unique("legal_name", legalName);
    if (legalMatch) return legalMatch;
    const registeredNameMatch = await unique("business_name", legalName);
    if (registeredNameMatch) return registeredNameMatch;
  }
  return businessName ? await unique("business_name", businessName) : null;
}
async function writeSecrets(supabase: ReturnType<typeof adminClient>, clientId: string, payload: Payload) {
  const { error } = await supabase.rpc("save_ghl_client_secrets", {
    p_client_id: clientId,
    p_personal_phone: value(payload, "personal_phone", "contact_phone"),
    p_personal_email: value(payload, "personal_email"),
    p_gbp_access_email: value(payload, "gbp_email", "google_business_email"),
    p_ein_tax_id: value(payload, "ein", "tax_id"),
  });
  if (error) throw error;
}
async function updateImport(supabase: ReturnType<typeof adminClient>, id: string, changes: Record<string, unknown>) {
  const { error } = await supabase.from("ghl_form_imports").update(changes).eq("id", id);
  if (error) throw error;
}
async function notifyOperations(supabase: ReturnType<typeof adminClient>, client: Record<string, unknown>, action: string) {
  const { data: profiles, error } = await supabase.from("profiles").select("id, role, permissions").eq("active", true);
  if (error) throw error;
  const recipients = (profiles || []).filter((profile) => profile.role === "superadmin" || profile.role === "onboarding_media" || profile.permissions?.operations_admin === true);
  if (!recipients.length) return;
  const rows = recipients.map((profile) => ({
    recipient_id: profile.id, title: "New GHL onboarding form received",
    body: `${client.code} · ${client.business_name} was ${action} from the Client Onboarding Form.`,
    source_type: "ghl_form_import", source_id: String(client.id), notify_at: new Date().toISOString(),
  }));
  const { error: notificationError } = await supabase.from("notifications").insert(rows);
  if (notificationError) throw notificationError;
}

// #onboarding in Slack. The insert fires the slack-bridge outbox right away; dedupe_key keeps
// a retried GHL delivery from posting twice. A Slack failure never fails the import.
const ONBOARDING_CHANNEL = Deno.env.get("SLACK_ONBOARDING_CHANNEL") || "C0C3LEA2CK0";
const APP_URL = Deno.env.get("TP_OPS_APP_URL") || "https://app.tacticalpipeline.com";
const slackText = (input: unknown, max = 160) => text(input, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MISSING_CHECKS: [string, string][] = [
  ["meta_ad_account_id", "Meta ad account"], ["meta_business_portfolio_id", "Business portfolio"], ["daily_budget", "Daily budget"],
  ["services", "Services"], ["markets", "Service area"], ["ads_targeting_address", "Targeting address"],
  ["facebook_page_url", "Facebook page"], ["website_url", "Website"], ["gbp_link", "Google Business Profile"],
];
async function announceInSlack(supabase: ReturnType<typeof adminClient>, client: Record<string, unknown>, action: string, importId: string) {
  const name = slackText(client.business_name || client.legal_name);
  const header = action === "created"
    ? `:tada: *New onboarding* · *${slackText(client.code, 20)} ${name}* just submitted the Client Onboarding Form in GHL.`
    : `:memo: *Onboarding form updated* · *${slackText(client.code, 20)} ${name}* submitted the Client Onboarding Form again (only empty fields were filled).`;
  const line = (label: string, input: unknown, max = 160) => fieldText(input) ? `• ${label}: ${slackText(input, max)}` : "";
  const budget = Number(client.daily_budget);
  const radius = Number(client.targeting_radius_miles);
  const missing = MISSING_CHECKS.filter(([key]) => !fieldText(client[key])).map(([, label]) => label);
  const body = [
    header,
    line("Owner", client.owner_name),
    line("Contact", [client.phone, client.contact_email || client.email].filter((part) => fieldText(part)).join(" · ")),
    line("Services", client.services, 200),
    line("Service area", client.markets, 200),
    Number.isFinite(budget) && budget > 0 ? `• Daily budget: $${budget}` : "",
    Number.isFinite(radius) && radius > 0 ? `• Radius: ${radius} mi` : "",
    line("Onboarding call language", client.onboarding_call_language, 60),
    line("Availability", client.appointment_availability, 200),
    missing.length ? `:warning: Still missing: ${missing.join(", ")}` : ":white_check_mark: Dossier has the key fields.",
    `<${APP_URL}/clientes/${client.id}|Open in TOPS>`,
  ].filter(Boolean).join("\n");
  const { error } = await supabase.from("slack_outbox").insert({
    kind: "onboarding_new", client_id: String(client.id), channel_id: ONBOARDING_CHANNEL, body,
    dedupe_key: `ghl_onboarding:${importId}`,
  });
  if (error && error.code !== "23505") console.error("Could not queue onboarding Slack notice", error.message);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const supabase = adminClient();
  if (!(await authenticate(supabase, request))) return response({ error: "Unauthorized" }, 401);
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return response({ error: "Payload too large" }, 413);
  let payload: Payload;
  try { payload = JSON.parse(rawBody); } catch { return response({ error: "Invalid JSON" }, 400); }
  // GHL's standard "Webhook" workflow action nests the mapped keys under customData and the
  // sub-account under location.id; lift them to the top level so both action types work.
  if (payload && typeof payload === "object") {
    const custom = payload.customData;
    if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      for (const [key, item] of Object.entries(custom as Payload)) if (fieldText(item)) payload[key] = item;
    }
    const location = payload.location as Payload | undefined;
    if (!fieldText(payload.location_id) && location && typeof location === "object") payload.location_id = location.id;
  }

  const locationId = value(payload, "location_id", "locationId");
  const contactId = value(payload, "contact_id", "contactId");
  const formId = value(payload, "form_id", "formId");
  const legalName = value(payload, "registered_business_name", "legal_name", "legalName");
  const businessName = value(payload, "business_name", "businessName", "company_name", "companyName");
  if (!locationId || !contactId || (!legalName && !businessName)) return response({ error: "location_id, contact_id, and a business name are required" }, 422);

  const eventKey = value(payload, "event_id", "eventId") || await sha256([locationId, contactId, formId, value(payload, "submitted_at", "submittedAt"), rawBody].join("|"));
  let { data: receipt, error: receiptError } = await supabase.from("ghl_form_imports")
    .insert({ event_key: eventKey, location_id: locationId, contact_id: contactId, form_id: formId })
    .select("id").single();

  if (receiptError?.code === "23505") {
    const { data: prior, error: priorError } = await supabase.from("ghl_form_imports").select("id,status,attempt_count").eq("event_key", eventKey).single();
    if (priorError) return response({ error: "Could not check duplicate receipt" }, 500);
    if (prior.status === "processed") return response({ ok: true, duplicate: true });
    receipt = { id: prior.id };
    const { error: retryError } = await supabase.from("ghl_form_imports").update({
      status: "received", sync_stage: "received", error_message: "", processed_at: null,
      attempt_count: (prior.attempt_count || 1) + 1, last_attempt_at: new Date().toISOString(),
    }).eq("id", prior.id);
    if (retryError) return response({ error: "Could not prepare import retry" }, 500);
  }
  if (receiptError && !receipt) return response({ error: "Could not register form receipt" }, 500);
  if (!receipt) return response({ error: "Could not register form receipt" }, 500);

  const { error: payloadError } = await supabase.rpc("store_ghl_form_payload", { p_import_id: receipt.id, p_payload: payload });
  if (payloadError) {
    await supabase.from("ghl_form_imports").update({
      status: "failed", sync_stage: "failed", error_message: "Secure payload storage failed.",
      processed_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
    }).eq("id", receipt.id);
    return response({ ok: false, error: "Could not secure form payload" }, 500);
  }
  try {
    await updateImport(supabase, receipt.id, { sync_stage: "payload_saved", last_attempt_at: new Date().toISOString() });
    const existing = await findClient(supabase, payload);
    if (existing) await updateImport(supabase, receipt.id, { sync_stage: "client_matched" });
    const changes = clientChanges(payload);
    let client: Record<string, unknown>;
    let action: "created" | "updated";
    if (existing) {
      const safeChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => {
        const current = existing[key];
        // Only fill empty fields; GHL identifiers are no longer overwritten when the match
        // came from an email or business name, so two similar clients cannot be cross-linked.
        return current === null || current === "" || emptyValue(text(current))
          || ["intake_form_completed", "intake_form_completed_at", "intake_source", "updated_at"].includes(key);
      }));
      const { data, error } = await supabase.from("clients").update(safeChanges).eq("id", existing.id).select("*").single();
      if (error) throw error;
      client = data; action = "updated";
    } else {
      const code = await nextClientCode(supabase);
      const { data, error } = await supabase.from("clients").insert({ id: crypto.randomUUID(), code, ...changes }).select("*").single();
      if (error) throw error;
      client = data; action = "created";
    }
    await updateImport(supabase, receipt.id, { client_id: client.id, sync_stage: "client_saved" });
    await writeSecrets(supabase, String(client.id), payload);
    await updateImport(supabase, receipt.id, { sync_stage: "secrets_saved" });
    const changedFields = Object.keys(changes).filter((key) => !["updated_at", "intake_source", "ghl_contact_id", "ghl_location_id", "ghl_form_id"].includes(key));
    const { error: auditError } = await supabase.from("client_audit_log").insert({
      client_id: client.id, actor_name: "GHL Form", actor_role: "system", action: "ghl_form_imported",
      changed_fields: changedFields, summary: `Client ${action} automatically from Client Onboarding Form`,
    });
    if (auditError) throw auditError;
    await updateImport(supabase, receipt.id, { sync_stage: "audit_saved" });
    await notifyOperations(supabase, client, action);
    try { await announceInSlack(supabase, client, action, String(receipt.id)); }
    catch (slackError) { console.error("Onboarding Slack notice failed", slackError); }
    await updateImport(supabase, receipt.id, {
      client_id: client.id, status: "processed", sync_stage: "processed", action,
      processed_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
    });
    return response({ ok: true, action, client_code: client.code });
  } catch (error) {
    console.error("GHL onboarding import failed", error);
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unexpected import failure.";
    await supabase.from("ghl_form_imports").update({
      status: "failed", sync_stage: "failed", error_message: message,
      processed_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
    }).eq("id", receipt.id);
    return response({ ok: false, error: "Import failed" }, 500);
  }
});
