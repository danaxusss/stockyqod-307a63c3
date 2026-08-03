import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, clientIp, guard } from "../_shared/security.ts";

const LIMITS = {
  burst: { max: 12,  window: 60 },
  hour:  { max: 120, window: 60 * 60 },
  day:   { max: 600, window: 24 * 60 * 60 },
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Vision-capable models, tried in order.
const VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen-2.5-vl-72b-instruct:free",
  "google/gemini-flash-1.5",
];

const SYSTEM_PROMPT = `Tu es un expert-comptable marocain. On te fournit l'image d'un relevé bancaire.
Extrais fidèlement les informations en JSON STRICT (aucun texte hors JSON), au format:
{
  "bank_name": string|null,
  "account_code": string|null,
  "rib": string|null,
  "period_start": "YYYY-MM-DD"|null,
  "period_end": "YYYY-MM-DD"|null,
  "opening_balance": number|null,
  "closing_balance": number|null,
  "lines": [
    { "date": "YYYY-MM-DD", "label": string, "reference": string|null, "debit": number, "credit": number, "balance": number|null }
  ]
}
Règles:
- "debit" = montant sorti du compte (décaissement), "credit" = montant entré (encaissement). L'un des deux vaut 0.
- Montants en nombres décimaux (point décimal), sans symbole ni séparateur de milliers.
- Convertis toute date au format ISO YYYY-MM-DD.
- N'invente rien: si une valeur est illisible, mets null (ou 0 pour un montant).
- Renvoie UNIQUEMENT le JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  try {
    const ip = clientIp(req);
    const blocked = await guard(req, [
      { bucket: "parse-bank:burst", id: ip, max: LIMITS.burst.max, window: LIMITS.burst.window,
        message: "Trop de pages à la fois. Patientez une minute." },
      { bucket: "parse-bank:hour", id: ip, max: LIMITS.hour.max, window: LIMITS.hour.window,
        message: "Quota horaire d'analyse atteint." },
      { bucket: "parse-bank:day", id: ip, max: LIMITS.day.max, window: LIMITS.day.window,
        message: "Quota journalier d'analyse atteint." },
    ]);
    if (blocked) return blocked;

    const { image_base64, mime } = await req.json();
    if (!image_base64) {
      return json(req, { error: "image_base64 required" }, 400);
    }
    if (typeof image_base64 !== "string" || image_base64.length > MAX_IMAGE_BYTES) {
      return json(req, { error: "Image trop volumineuse" }, 413);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

    const dataUrl = image_base64.startsWith("data:")
      ? image_base64
      : `data:${mime || "image/jpeg"};base64,${image_base64}`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extrais ce relevé bancaire en JSON strict." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    let lastErr = "";
    for (const model of VISION_MODELS) {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://stockyqod.app",
          "X-Title": "Stocky QOD",
        },
        body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: "json_object" } }),
      });

      if (!resp.ok) { lastErr = `${model}: ${resp.status} ${await resp.text()}`; continue; }
      const json = await resp.json();
      const content: string = json?.choices?.[0]?.message?.content || "";
      const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(cleaned); }
      catch { const m = cleaned.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } } }
      if (parsed && Array.isArray(parsed.lines)) {
        return json(req, { model, data: parsed });
      }
      lastErr = `${model}: réponse non parsable`;
    }

    console.error("[parse-bank-statement] all models failed:", lastErr);
    return json(req, { error: "Extraction échouée : le relevé n'a pas pu être lu." }, 502);
  } catch (e) {
    console.error("[parse-bank-statement] error:", (e as Error)?.message);
    return json(req, { error: "Erreur inattendue" }, 500);
  }
});
