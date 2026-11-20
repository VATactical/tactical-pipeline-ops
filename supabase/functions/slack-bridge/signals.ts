// Status signals in a message written by the team or the client in a client channel.
// Only clear phrases count; every result is an alert that a person applies or dismisses in TP OPS.

export type Signal = "ads_live" | "ads_paused" | "payment_error" | "payment_fixed" | "problem";

const ADS = String.raw`(?:campaigns?|ads?|ad ?sets?|campa[nñ]as?|anuncios?)`;

// Plans, questions and negations are not facts: "will launch tomorrow", "can we pause?", "not live yet".
const NOT_A_FACT = /\b(will|going to|gonna|plan(?:ning)? to|scheduled|tomorrow|tmr|tonight|later|once|when|after|before|need(?:s)? to|should|could|can we|can you|let'?s|not yet|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|do not|didn'?t|hasn'?t|haven'?t|no est[aá]n?|todav[ií]a no|vamos a|ma[nñ]ana|programad[ao]|hay que|debemos)\b|\?/i;

const LIVE = [
  new RegExp(String.raw`\b${ADS}\b[^.\n]{0,40}\b(launched|re-?launched|(?:is|are|went|now) live|live now|published|turned (?:back )?on|activated|running now|back (?:on|live|running)|lanzad[ao]s?|relanzad[ao]s?|activad[ao]s?|activ[ao]s|encendid[ao]s?|publicad[ao]s?|en vivo|corriendo|ya corr(?:e|en))\b`, "i"),
  new RegExp(String.raw`\b(launched|re-?launched|published|turned (?:back )?on|lanc[eé]|relanc[eé]|activ[eé]|encend[ií]|publiqu[eé])\b[^.\n]{0,30}\b${ADS}\b`, "i"),
];
const PAUSED = [
  new RegExp(String.raw`\b${ADS}\b[^.\n]{0,30}\b(paused|turned off|stopped|are off|is off|pausad[ao]s?|apagad[ao]s?|detenid[ao]s?)\b`, "i"),
  new RegExp(String.raw`\b(paused|turned off|stopped|paus[eé]|apagu[eé]|detuve)\b[^.\n]{0,25}\b${ADS}\b`, "i"),
  /\bads (?:are )?off\b/i,
];
const PAYMENT_ERROR = /\b(payment (?:error|failed|failure|issue|problem|declined|rejected)|(?:card|tarjeta) (?:was |is |got |fue |est[aá] )?(?:declined|rejected|failed|rechazada|declinada)|failed (?:payment|transaction|charge)|billing (?:issue|error|problem)|(?:ad )?account (?:is |was |got )?(?:disabled|restricted|suspended)|spending limit|could not pay|couldn'?t pay|error de pago|problema (?:de|con el) pago|pago (?:rechazado|fallido)|m[eé]todo de pago (?:rechazado|con error|fall[oó]))\b/i;
const PAYMENT_FIXED = /\b(payment (?:method )?(?:is )?(?:fixed|resolved|updated|added|went through|approved)|added (?:a |the |new )*(?:payment method|card)|(?:card|billing) (?:fixed|updated|resolved)|paid the balance|pago (?:resuelto|aprobado|realizado)|agreg[oó] (?:el|un|la) (?:m[eé]todo de pago|tarjeta)|actualiz[oó] (?:el m[eé]todo de pago|la tarjeta))\b/i;
const PROBLEM = /\b(not working|isn'?t working|doesn'?t work|stopped working|broken|no funciona|dej[oó] de funcionar|wants? to cancel|cancel(?:ling)? (?:the |his |her |their )?(?:service|contract|account)|refund|reembolso|cancelar el servicio|upset|angry|furious|complain(?:ed|ing|t)?|queja|molest[oa]|(?:no|zero|0) leads|sin leads|ads? (?:rejected|disapproved)|(?:rejected|disapproved) ads?|anuncios? rechazados?|blocked by|bloquead[oa])\b/i;

const clean = (text: string) => text
  .replace(/<(https?:\/\/[^|>]+)\|[^>]*>/g, " ").replace(/<(https?:\/\/[^>]+)>/g, " ").replace(/<[@#!][^>]*>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Signals per sentence, so "C10 launched; C12 pending launch tomorrow" only counts the fact.
export function detectSignals(raw: string): Signal[] {
  const found = new Set<Signal>();
  const sentences = clean(raw).split(/(?<=[.!?\n])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const fact = !NOT_A_FACT.test(sentence);
    if (PAYMENT_FIXED.test(sentence) && fact) found.add("payment_fixed");
    else if (PAYMENT_ERROR.test(sentence) && !/\b(fixed|resolved|resuelto|solved)\b/i.test(sentence)) found.add("payment_error");
    if (fact && LIVE.some((pattern) => pattern.test(sentence))) found.add("ads_live");
    if (fact && PAUSED.some((pattern) => pattern.test(sentence)) && !/\b(un-?paused|unpause|despausad)/i.test(sentence)) found.add("ads_paused");
    if (PROBLEM.test(sentence) && !/\b(fixed|resolved|resuelto|solved|no longer)\b/i.test(sentence)) found.add("problem");
  }
  // A payment problem already explains the pause; a launch/fix wins over a generic pause mention.
  if (found.has("payment_error")) found.delete("ads_paused");
  if (found.has("payment_fixed")) found.delete("payment_error");
  return [...found];
}
