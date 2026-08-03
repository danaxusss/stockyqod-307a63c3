// ai-extract-table — generic AI-OCR: image of a document → structured JSON.
// Companion to parse-bank-statement (which stays specialised for statements).
//
// SELF-CONTAINED ON PURPOSE: no imports from ../_shared/, so this file can be
// pasted straight into the Supabase dashboard (Edge Functions → Deploy new
// function) by anyone without a local CLI. Deploying with the CLI also works:
//   npx supabase functions deploy ai-extract-table
//
// kinds:
//   "table"   → any tabular document  → { title, columns, rows }
//   "invoice" → supplier invoice      → header fields + line items

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  let allow = "*";
  if (ALLOWED_ORIGINS.length) {
    allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(ALLOWED_ORIGINS.length ? { Vary: "Origin" } : {}),
  };
}

function json(req: Request, data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", ...extra },
  });
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

// ── Rate limiting ───────────────────────────────────────────────────────────
// Counters live in Postgres (migration 20260803120000_rate_limiting.sql) so
// they are shared across isolates. Fails OPEN: if the limiter is unavailable
// — including when that migration hasn't been applied — conversions keep
// working rather than the tool going dark.
const LIMITS = {
  burst: { max: 12,  window: 60 },            // 12 / min — normal page-by-page use
  hour:  { max: 120, window: 60 * 60 },       // ~4 large documents per hour
  day:   { max: 600, window: 24 * 60 * 60 },
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;     // ~9 MB of decoded image

async function overLimit(ip: string): Promise<{ blocked: boolean; message?: string; retryAfter?: number }> {
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const checks: [string, { max: number; window: number }, string][] = [
      ["ai-extract:burst", LIMITS.burst, "Trop de pages à la fois. Patientez une minute."],
      ["ai-extract:hour",  LIMITS.hour,  "Quota horaire de conversion atteint."],
      ["ai-extract:day",   LIMITS.day,   "Quota journalier de conversion atteint."],
    ];
    for (const [bucket, cfg, message] of checks) {
      const { data, error } = await db.rpc("check_rate_limit", {
        p_bucket: bucket, p_identifier: ip, p_max: cfg.max, p_window_seconds: cfg.window,
      });
      if (error) throw error;
      if (data && data.allowed === false) {
        console.warn(`[rate-limit] blocked ${bucket} ip=${ip} count=${data.count}`);
        return { blocked: true, message, retryAfter: data.retry_after };
      }
    }
  } catch (e) {
    console.error("[rate-limit] check failed (allowing request):", (e as Error)?.message);
  }
  return { blocked: false };
}

// ── Prompts ─────────────────────────────────────────────────────────────────
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
    const limit = await overLimit(clientIp(req));
    if (limit.blocked) {
      return json(req, { error: limit.message, retry_after: limit.retryAfter }, 429,
        { "Retry-After": String(limit.retryAfter ?? 60) });
    }

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
    if (!apiKey) {
      // Explicit, actionable: this is a configuration problem, not a bad file.
      return json(req, { error: "OPENROUTER_API_KEY n'est pas configuré dans les secrets Supabase." }, 500);
    }

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
      const out = await resp.json();
      const content: string = out?.choices?.[0]?.message?.content || "";
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
    return json(req, { error: "Extraction échouée : le document n'a pas pu être lu (modèles IA indisponibles ou page illisible)." }, 502);
  } catch (e) {
    console.error("[ai-extract-table] error:", (e as Error)?.message);
    return json(req, { error: "Erreur inattendue" }, 500);
  }
});
