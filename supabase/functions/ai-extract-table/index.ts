import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json, clientIp, guard } from "../_shared/security.ts";

// ai-extract-table — generic AI-OCR: image of a document → structured JSON.
// Companion to parse-bank-statement (which stays specialized for statements).
// Deploy: supabase functions deploy ai-extract-table
//
// kinds:
//   "table"   → any tabular document  → { title, columns, rows }
//   "invoice" → supplier invoice      → header fields + line items

// Each call spends AI credits, so cap per-IP usage. A 30-page PDF is 30 calls,
// hence the hourly budget rather than a per-minute one.
const LIMITS = {
  burst: { max: 12,  window: 60 },            // 12 / min — normal page-by-page use
  hour:  { max: 120, window: 60 * 60 },       // ~4 large documents per hour
  day:   { max: 600, window: 24 * 60 * 60 },
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;     // ~9 MB of base64 payload

// Vision-capable models, tried in order (same chain as parse-bank-statement).
const VISION_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.2-90b-vision-instruct:free",
  "qwen/qwen-2.5-vl-72b-instruct:free",
  "google/gemini-flash-1.5",
];

const PROMPTS: Record<string, string> = {
  table: `Tu extrais des tableaux depuis l'image d'un document. Renvoie un JSON STRICT (aucun texte hors JSON):
{
  "title": string|null,
  "columns": [string, ...],
  "rows": [[string|number, ...], ...]
}
Règles:
- Une ligne du tableau source = un élément de "rows", dans l'ordre des "columns".
- Nombres en décimaux (point décimal), sans symbole monétaire ni séparateur de milliers.
- Cellule illisible ou vide → "" (chaîne vide). N'invente rien.
- S'il y a plusieurs tableaux, fusionne-les s'ils ont les mêmes colonnes, sinon garde le principal.
- Renvoie UNIQUEMENT le JSON.`,
  invoice: `Tu es un expert-comptable marocain. On te fournit l'image d'une facture. Renvoie un JSON STRICT (aucun texte hors JSON):
{
  "supplier": string|null,
  "invoice_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "currency": string|null,
  "total_ht": number|null,
  "total_tva": number|null,
  "total_ttc": number|null,
  "lines": [
    { "description": string, "quantity": number|null, "unit_price": number|null, "total": number|null }
  ]
}
Règles:
- Montants en décimaux (point décimal), sans symbole ni séparateur de milliers.
- Dates au format ISO YYYY-MM-DD.
- Valeur illisible → null. N'invente rien.
- Renvoie UNIQUEMENT le JSON.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  try {
    const ip = clientIp(req);
    const blocked = await guard(req, [
      { bucket: "ai-extract:burst", id: ip, max: LIMITS.burst.max, window: LIMITS.burst.window,
        message: "Trop de pages à la fois. Patientez une minute." },
      { bucket: "ai-extract:hour", id: ip, max: LIMITS.hour.max, window: LIMITS.hour.window,
        message: "Quota horaire de conversion atteint." },
      { bucket: "ai-extract:day", id: ip, max: LIMITS.day.max, window: LIMITS.day.window,
        message: "Quota journalier de conversion atteint." },
    ]);
    if (blocked) return blocked;

    const { image_base64, mime, kind } = await req.json();
    if (!image_base64) {
      return json(req, { error: "image_base64 required" }, 400);
    }
    if (typeof image_base64 !== "string" || image_base64.length > MAX_IMAGE_BYTES) {
      return json(req, { error: "Image trop volumineuse" }, 413);
    }
    const systemPrompt = PROMPTS[kind || "table"];
    if (!systemPrompt) {
      return json(req, { error: `unknown kind "${kind}"` }, 400);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

    const dataUrl = image_base64.startsWith("data:")
      ? image_base64
      : `data:${mime || "image/jpeg"};base64,${image_base64}`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Extrais ce document en JSON strict." },
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
      const valid = parsed && (kind === "invoice" ? Array.isArray(parsed.lines) : Array.isArray(parsed.rows));
      if (valid) {
        return json(req, { model, data: parsed });
      }
      lastErr = `${model}: réponse non parsable`;
    }

    // lastErr can contain upstream provider detail — log it, don't return it.
    console.error("[ai-extract-table] all models failed:", lastErr);
    return json(req, { error: "Extraction échouée : le document n'a pas pu être lu." }, 502);
  } catch (e) {
    console.error("[ai-extract-table] error:", (e as Error)?.message);
    return json(req, { error: "Erreur inattendue" }, 500);
  }
});
