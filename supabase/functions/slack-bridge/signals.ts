// Status signals in a message written by the team or the client in a client channel.
// Only clear phrases count; every result is an alert that a person applies or dismisses in TP OPS.

export type Signal = "ads_live" | "ads_paused" | "payment_error" | "payment_fixed" | "problem" | "churned";

const ADS = String.raw`(?:campaigns?|ads?|ad ?sets?|campa[nñ]as?|anuncios?)`;

// Plans, questions and negations are not facts: "will launch tomorrow", "can we pause?", "not live yet".
const NOT_A_FACT = /\b(will|going to|gonna|plan(?:ning)? to|scheduled|tomorrow|tmr|tonight|later|once|when|after|before|need(?:s)? to|should|could|can we|can you|let'?s|not yet|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|do not|didn'?t|hasn'?t|haven'?t|no est[aá]n?|todav[ií]a no|vamos a|ma[nñ]ana|programad[ao]|hay que|debemos)\b|\?/i;

const LIVE = [
  new RegExp(String.raw`\b${ADS}\b[^.\n]{0,40}\b(launched|re-?launched|(?:is|are|went|now) live|live now|published|turned (?:back )?on|activated|running now|back (?:on|live|running)|lanzad[ao]s?|relanzad[ao]s?|activad[ao]s?|activ[ao]s|encendid[ao]s?|publicad[ao]s?|en vivo|corriendo|ya corr(?:e|en))\b`, "i"),
  new RegExp(String.raw`\b(launched|re-?launched|published|turned (?:back )?on|lanc[eé]|relanc[eé]|activ[eé]|encend[ií]|publiqu[eé])\b[^.\n]{0,30}\b${ADS}\b`, "i"),
];
// Short forms: "ads live", "C8 ads are live", "campaña activa", "campaign active". Not about an account, a pixel or a card,
// and not negated ("ads are not active").
const LIVE_SHORT = new RegExp(String.raw`\b${ADS}\b[^.\n]{0,25}\b(live|active|activ[ao]s?|en vivo)\b`, "i");
const LIVE_SHORT_NOT = /\b(not|no|nunca|account|cuenta|pixel|card|tarjeta|payment|pago|page|p[aá]gina|form|formulario|manager)\b/i;

const PAUSED = [
  new RegExp(String.raw`\b${ADS}\b[^.\n]{0,30}\b(paused|turned off|stopped|are off|is off|pausad[ao]s?|apagad[ao]s?|detenid[ao]s?)\b`, "i"),
  new RegExp(String.raw`\b(paused|turned off|stopped|paus[eé]|apagu[eé]|detuve)\b[^.\n]{0,25}\b${ADS}\b`, "i"),
  /\bads (?:are )?off\b/i,
];
const PAYMENT_ERROR = /\b(payment (?:error|failed|failure|issue|problem|declined|rejected)|(?:card|tarjeta) (?:was |is |got |fue |est[aá] )?(?:declined|rejected|failed|rechazada|declinada)|failed (?:payment|transaction|charge)|billing (?:issue|error|problem)|(?:ad )?account (?:is |was |got )?(?:disabled|restricted|suspended)|spending limit|could not pay|couldn'?t pay|error de pago|problema (?:de|con el) pago|pago (?:rechazado|fallido)|m[eé]todo de pago (?:rechazado|con error|fall[oó]))\b/i;
const PAYMENT_FIXED = /\b((?:cleared|fixed|resolved|solved|paid off|took care of) (?:the |his |her |their )?(?:payment|billing)(?: method)? ?(?:issue|error|problem|balance)?|(?:payment|billing) (?:issue|error|problem) (?:is |was |has been |got )?(?:cleared|fixed|resolved|solved)|payment (?:method )?(?:is )?(?:fixed|resolved|updated|added|went through|approved)|added (?:a |the |new )*(?:payment method|card)|(?:card|billing) (?:fixed|updated|resolved)|paid the balance|pago (?:resuelto|aprobado|realizado)|agreg[oó] (?:el|un|la) (?:m[eé]todo de pago|tarjeta)|actualiz[oó] (?:el m[eé]todo de pago|la tarjeta))\b/i;
const PROBLEM = /\b(not working|isn'?t working|doesn'?t work|stopped working|broken|no funciona|dej[oó] de funcionar|wants? to cancel|cancel(?:ling)? (?:the |his |her |their )?(?:service|contract|account)|refund|reembolso|cancelar el servicio|upset|angry|furious|complain(?:ed|ing|t)?|queja|molest[oa]|(?:no|zero|0) leads|sin leads|ads? (?:rejected|disapproved)|(?:rejected|disapproved) ads?|anuncios? rechazados?|blocked by|bloquead[oa])\b/i;

// The client left: "Client churned", "C16 CHURNED", "client is inactive", "cliente inactivo". Archived in TP OPS.
// The subject must be the client (or the message is just "churned"), so "they churned" about someone else does not count.
const CHURNED = /\b((?:the )?(?:client|customer|cliente|c\d{1,3}) (?:is |has |was |now |has been |is now |just |est[aá] |qued[oó] |pas[oó] a )*(?:inactive|churned|inactiv[oa]|cancel(?:l)?ed|cancelad[oa])|client churn|(?:inactive|churned) (?:client|customer)|(?:moved|marked) (?:it |them |this client |the client )?(?:to|as) (?:churned?|inactive)|cliente (?:inactivo|se fue|se dio de baja))\b/i;
const CHURN_ALONE = /^\W*(churned|client churned|inactive|inactivo|client inactive)\W*$/i;
const CHURN_RISK = /\b(risk|riesgo|might|may|maybe|almost|about to|close to|avoid|prevent|evitar|if|si)\b/i;
// Anywhere in the message: still trying to save the client ("call again, otherwise we'll move to churn").
const CHURN_NOT_YET = /\b(otherwise|or else|attempt|try(?:ing)? (?:to|again)|call (?:again|back)|follow(?:ing)? up|reach out|move (?:it |them )?to churn|will churn|si no|de lo contrario|intent(?:ar|a|emos)|llamar de nuevo)\b/i;

const clean = (text: string) => text
  .replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, " ").replace(/<(https?:\/\/[^>]+)>/g, " ").replace(/<[@#!][^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Signals per sentence, so "C10 launched; C12 pending launch tomorrow" only counts the fact.
export function detectSignals(raw: string): Signal[] {
  const found = new Set<Signal>();
  const notYet = CHURN_NOT_YET.test(clean(raw));
  const sentences = clean(raw).split(/(?<=[.!?\n])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const fact = !NOT_A_FACT.test(sentence);
    if (PAYMENT_FIXED.test(sentence) && fact) found.add("payment_fixed");
    else if (PAYMENT_ERROR.test(sentence) && !/\b(fixed|resolved|resuelto|solved|cleared|back on)\b/i.test(sentence)) found.add("payment_error");
    if (fact && (LIVE.some((pattern) => pattern.test(sentence)) || (LIVE_SHORT.test(sentence) && !LIVE_SHORT_NOT.test(sentence)))) found.add("ads_live");
    if (fact && PAUSED.some((pattern) => pattern.test(sentence)) && !/\b(un-?paused|unpause|despausad)/i.test(sentence)) found.add("ads_paused");
    if (fact && !notYet && (CHURNED.test(sentence) || CHURN_ALONE.test(sentence)) && !CHURN_RISK.test(sentence)) found.add("churned");
    if (PROBLEM.test(sentence) && !/\b(fixed|resolved|resuelto|solved|no longer)\b/i.test(sentence)) found.add("problem");
  }
  // A payment problem already explains the pause; a launch/fix wins over a generic pause mention.
  if (found.has("payment_error")) found.delete("ads_paused");
  if (found.has("payment_fixed")) found.delete("payment_error");
  // A churned client is archived; the other alerts no longer matter.
  if (found.has("churned")) return ["churned"];
  return [...found];
}
