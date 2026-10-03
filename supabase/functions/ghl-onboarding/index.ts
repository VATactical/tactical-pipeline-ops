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

const payloadValue = (payload: Payload, ...keys: string[]) => {
  for (const key of keys) {
    const value = fieldText(payload[key], 5000);
    if (value) return value;
  }
  return "";
};
const payloadBool = (payload: Payload, ...keys: string[]) => {
  const value = payloadValue(payload, ...keys).toLowerCase();
  if (["true", "yes", "1", "confirmed", "complete", "completed", "sí", "si"].includes(value)) return true;
  if (["false", "no", "0", "not confirmed", "pending"].includes(value)) return false;
  return null;
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
  const firstName = payloadValue(payload, "first_name", "firstName");
  const lastName = payloadValue(payload, "last_name", "lastName");
  const submittedFullName = payloadValue(payload, "full_name", "fullName", "contact_name");
  const distinctNameParts = firstName && lastName && firstName.toLowerCase() === lastName.toLowerCase()
    ? [firstName]
    : [firstName, lastName].filter(Boolean);
  const fullName = submittedFullName || distinctNameParts.join(" ");
  const businessName = payloadValue(payload, "business_name", "businessName", "company_name", "companyName");
  const legalName = payloadValue(payload, "registered_business_name", "legal_name", "legalName", "registeredBusinessName");
  const website = payloadValue(payload, "website", "website_url", "websiteUrl", "landing_page_url");
  const wantsWebsite = /would like (a )?website|website included|i need (a website|one)|need a website|necesito.*sitio/i.test(website);
  const facebook = payloadValue(payload, "facebook", "facebook_page_url", "facebookPageUrl", "facebook_business_info");
  const instagram = payloadValue(payload, "instagram", "instagram_url", "instagramUrl");
  const submittedAt = payloadValue(payload, "submitted_at", "submittedAt") || new Date().toISOString();
  const date = Number.isNaN(Date.parse(submittedAt)) ? new Date().toISOString() : new Date(submittedAt).toISOString();
  const changes: Record<string, unknown> = {
    legal_name: legalName,
    business_name: businessName || legalName,
    owner_name: fullName,
    phone: payloadValue(payload, "business_phone", "businessPhone", "phone"),
    email: payloadValue(payload, "business_email", "businessEmail", "email"),
    contact_phone: payloadValue(payload, "personal_phone", "contact_phone", "contactPhone"),
    address: payloadValue(payload, "business_address", "address", "street_address", "streetAddress"),
    timezone: payloadValue(payload, "timezone", "time_zone", "timeZone"),
    services: payloadValue(payload, "services", "service_offering", "serviceOffering"),
    offer: payloadValue(payload, "offer", "promotion", "campaign_offer"),
    markets: payloadValue(payload, "service_areas", "service_area", "markets", "serviceAreas"),
    target_zip_codes: payloadValue(payload, "target_zip_codes", "zip_codes", "zip_code", "service_zip_codes", "targetZipCodes", "zipCodes"),
    daily_budget: payloadValue(payload, "daily_budget", "ad_budget", "budget", "dailyBudget"),
    website_url: wantsWebsite || emptyValue(website) ? "" : website,
    needs_website_funnel: wantsWebsite ? true : emptyValue(website) ? null : false,
    facebook_page_url: /^https?:\/\//i.test(facebook) ? facebook : "",
    facebook_business_info: /^https?:\/\//i.test(facebook) ? "" : facebook,
    facebook_access_confirmed: payloadBool(payload, "facebook_access_confirmed", "meta_access_confirmed", "facebookAccessConfirmed"),
    meta_business_portfolio_id: payloadValue(payload, "meta_business_portfolio_id", "business_manager_id", "metaBusinessPortfolioId"),
    meta_ad_account_id: payloadValue(payload, "meta_ad_account_id", "ad_account_id", "metaAdAccountId"),
    instagram_url: instagram,
    gbp_email: payloadValue(payload, "gbp_email", "google_business_email", "gbpEmail"),
    gbp_link: payloadValue(payload, "gbp_link", "google_business_profile_url", "googleBusinessProfileUrl"),
    gbp_status: payloadValue(payload, "gbp_status", "google_business_profile_status", "googleBusinessProfileStatus"),
    drive_folder_link: payloadValue(payload, "drive_folder_link", "google_drive_folder", "drive_url", "driveFolderLink"),
    ghl_subaccount_link: payloadValue(payload, "ghl_subaccount_link", "ghl_url", "ghlSubaccountLink"),
    domain: payloadValue(payload, "domain", "domain_name", "domainName"),
    landing_page_url: payloadValue(payload, "landing_page_url", "funnel_url", "landingPageUrl"),
    ad_strategy: payloadValue(payload, "ad_strategy", "campaign_strategy", "adStrategy"),
    ideal_customer_profile: payloadValue(payload, "ideal_customer_profile", "target_audience", "idealCustomerProfile"),
    target_launch_date: payloadValue(payload, "target_launch_date", "launch_date", "targetLaunchDate"),
    payment_method_confirmed: payloadBool(payload, "payment_method_confirmed", "payment_method_on_file", "paymentMethodConfirmed"),
    meta_campaign_live: payloadBool(payload, "meta_campaign_live", "campaign_live", "metaCampaignLive"),
    available_assets: payloadValue(payload, "assets", "available_assets", "campaign_materials"),
    onboarding_form_notes: payloadValue(payload, "additional_notes", "notes", "additionalNotes"),
    legal_business_info: payloadValue(payload, "ein", "tax_id") ? "Received" : "",
    status: "ONBOARDING",
    phase: "Intake received",
    next_action: "Review onboarding form and complete missing dossier fields",
    intake_form_completed: true,
    intake_form_completed_at: date,
    intake_source: "ghl_form",
    ghl_contact_id: payloadValue(payload, "contact_id", "contactId"),
    ghl_location_id: payloadValue(payload, "location_id", "locationId"),
    ghl_form_id: payloadValue(payload, "form_id", "formId"),
    onboarding_date: date.slice(0, 10),
    assigned_role: "onboarding_media",
    updated_at: new Date().toISOString(),
  };
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}async function findClient(supabase: ReturnType<typeof adminClient>, payload: Payload) {
  const locationId = payloadValue(payload, "location_id", "locationId");
  const contactId = payloadValue(payload, "contact_id", "contactId");
  const businessEmail = payloadValue(payload, "business_email", "businessEmail", "email");
  const personalEmail = payloadValue(payload, "personal_email", "personalEmail");
  const legalName = payloadValue(payload, "registered_business_name", "legal_name", "legalName", "registeredBusinessName");
  const businessName = payloadValue(payload, "business_name", "businessName", "company_name", "companyName");

  const uniqueMatch = async (column: string, value: string) => {
    if (!value) return null;
    const { data, error } = await supabase.from("clients").select("*").ilike(column, value).limit(2);
    if (error) throw error;
    if ((data || []).length > 1) throw new Error(`Ambiguous onboarding match for ${column}; manual review required`);
    return data?.[0] || null;
  };

  if (locationId && contactId) {
    const { data, error } = await supabase.from("clients").select("*")
      .eq("ghl_location_id", locationId).eq("ghl_contact_id", contactId).limit(2);
    if (error) throw error;
    if ((data || []).length > 1) throw new Error("Ambiguous GHL contact identifiers; manual review required");
    if (data?.[0]) return data[0];
  }

  const emailMatch = await uniqueMatch("email", businessEmail || personalEmail);
  if (emailMatch) return emailMatch;

  if (legalName) {
    const legalMatch = await uniqueMatch("legal_name", legalName);
    if (legalMatch) return legalMatch;
    const registeredNameMatch = await uniqueMatch("business_name", legalName);
    if (registeredNameMatch) return registeredNameMatch;
  }
  return businessName ? await uniqueMatch("business_name", businessName) : null;
}

