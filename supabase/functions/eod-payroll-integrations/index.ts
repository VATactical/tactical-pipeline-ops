import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const validDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const canReviewAll = (profile: Record<string, unknown> | null) => {
  const permissions = profile?.permissions && typeof profile.permissions === "object"
    ? profile.permissions as Record<string, unknown>
    : {};
  return Boolean(profile?.active) && (profile?.role === "superadmin" || permissions.operations_admin === true);
};
async function loadAllRows(makeQuery: () => any) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    const page = (data || []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
function modelText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text.trim();
  const steps = Array.isArray(response.steps) ? response.steps as Record<string, unknown>[] : [];
  const textParts = steps
    .filter((step) => step.type === "model_output")
    .flatMap((step) => Array.isArray(step.content) ? step.content as Record<string, unknown>[] : [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text));
  return textParts.join("\n").trim();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Sesión requerida." }, 401);

    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
    if (!url || !anonKey) return json({ error: "La integración de Supabase no está configurada." }, 503);
    if (!geminiKey) return json({ error: "Gemini aún no está configurado en Supabase." }, 503);

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: userData, error: authError } = await caller.auth.getUser(token);
    if (authError || !userData.user) return json({ error: "Sesión inválida." }, 401);

    const { data: profile, error: profileError } = await caller.from("profiles")
      .select("active, role, permissions")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json({ error: "No se pudo verificar el permiso de nómina." }, 403);
    if (!canReviewAll(profile)) return json({ error: "No tienes permiso para generar resúmenes de nómina." }, 403);

    const body = await request.json();
    if (body?.action !== "summarize") return json({ error: "Acción no compatible." }, 400);
    const startDate = body?.startDate;
    const endDate = body?.endDate;
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return json({ error: "Selecciona un rango de fechas válido." }, 400);
    }
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if ((end.getTime() - start.getTime()) / 86400000 > 365) {
      return json({ error: "Para el resumen con Gemini, selecciona un periodo de hasta un año." }, 400);
    }

    const reports = await loadAllRows(() => caller.from("eod_reports")
      .select("id, user_id, report_date")
      .gte("report_date", startDate)
      .lte("report_date", endDate)
      .order("report_date", { ascending: true })
      .order("user_id", { ascending: true }));
    const submittedKeys = new Set(reports.map((report) => `${report.user_id}:${report.report_date}`));
    const entries = await loadAllRows(() => caller.from("time_entries")
      .select("user_id, work_date, hours, memo")
      .gte("work_date", startDate)
      .lte("work_date", endDate)
      .order("work_date", { ascending: true })
      .order("user_id", { ascending: true }));

    const daily = new Map<string, { date: string; hours: number; work: string[] }>();
    for (const entry of entries) {
      const userId = String(entry.user_id || "");
      const workDate = String(entry.work_date || "");
      if (!submittedKeys.has(`${userId}:${workDate}`)) continue;
      if (!daily.has(workDate)) daily.set(workDate, { date: workDate, hours: 0, work: [] });
      const item = daily.get(workDate)!;
      item.hours += Number(entry.hours || 0);
      const memo = String(entry.memo || "").trim().slice(0, 500);
      if (memo) item.work.push(memo);
    }
    const dailySummary = [...daily.values()];
    const entryCount = dailySummary.reduce((sum, day) => sum + day.work.length, 0);
    if (entryCount > 3000) return json({ error: "El periodo contiene demasiados registros para un resumen Gemini. Reduce el rango de fechas." }, 400);

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
    const systemInstruction = [
      "You write concise internal summaries of submitted end-of-day (EOD) reports.",
      "The input contains dates, team-wide hours and work descriptions, without employee names.",
      "Summarize recurring completed work, notable blockers, and follow-up themes only when the input supports them.",
      "Do not calculate or revise payroll hours; the application computes those totals.",
      "Do not invent facts, infer individual performance, or include recommendations not present in the reports.",
      "Write in clear English, in 3 to 6 short bullets.",
    ].join(" ");
    const prompt = `Summarize the EOD reports for ${startDate} through ${endDate}. The source data follows as JSON.\n\n${JSON.stringify(dailySummary)}`;
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ model, input: prompt, system_instruction: systemInstruction }),
      signal: AbortSignal.timeout(45000),
    });
    if (!geminiResponse.ok) return json({ error: "Gemini no pudo generar el resumen. Inténtalo de nuevo." }, 502);
    const result = await geminiResponse.json() as Record<string, unknown>;
    const summary = modelText(result).slice(0, 5000);
    if (!summary) return json({ error: "Gemini devolvió un resumen vacío." }, 502);
    return json({ summary, sourceReports: reports.length, sourceEntries: entryCount });
  } catch (_error) {
    return json({ error: "No se pudo generar el resumen EOD con Gemini." }, 500);
  }
});
