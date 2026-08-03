// Shared security helpers for every Edge Function: CORS allowlist + rate limiting.
//
// Rate limit state lives in Postgres (see 20260803120000_rate_limiting.sql)
// because Edge Functions are stateless and horizontally scaled — an in-memory
// counter would reset constantly and be trivially bypassed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ── CORS ────────────────────────────────────────────────────────────────────
// Set ALLOWED_ORIGINS (comma-separated) to lock the API to your own front-end.
// Left unset it falls back to "*" so existing deployments keep working — the
// rate limits below still apply either way.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  let allow = "*";
  if (ALLOWED_ORIGINS.length) {
    allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(ALLOWED_ORIGINS.length ? { Vary: "Origin" } : {}),
  };
}

export function json(req: Request, data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", ...extra },
  });
}

// ── Caller identity ─────────────────────────────────────────────────────────
/** Best-effort client IP. Supabase sets x-forwarded-for at the edge. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || "unknown";
}

// ── Rate limiting ───────────────────────────────────────────────────────────
export interface RateVerdict {
  allowed: boolean;
  count: number;
  remaining: number;
  retry_after: number;
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Consume one unit from a fixed window. Fails OPEN on infrastructure errors:
 * a limiter outage must not take the whole app down. The only exception is
 * verify-pin, which passes failClosed = true — for credential checking we
 * would rather block than allow unlimited guessing.
 */
export async function rateLimit(
  bucket: string,
  identifier: string,
  max: number,
  windowSeconds: number,
  failClosed = false,
): Promise<RateVerdict> {
  try {
    const db = admin();
    const { data, error } = await db.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_identifier: identifier,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;

    // opportunistic cleanup, ~1 call in 100
    if (Math.random() < 0.01) db.rpc("purge_rate_limits").then(() => {}, () => {});

    return data as RateVerdict;
  } catch (e) {
    console.error(`[rate-limit] ${bucket} check failed:`, (e as Error)?.message);
    if (failClosed) {
      return { allowed: false, count: 0, remaining: 0, retry_after: 30 };
    }
    return { allowed: true, count: 0, remaining: max, retry_after: 0 };
  }
}

/** 429 response with standard headers. */
export function tooMany(req: Request, v: RateVerdict, message = "Trop de requêtes. Réessayez plus tard.") {
  return json(req, { error: message, retry_after: v.retry_after }, 429, {
    "Retry-After": String(v.retry_after),
    "X-RateLimit-Remaining": "0",
  });
}

/**
 * Guard a request against one or more limits. Returns a 429 Response if any
 * limit is exceeded, otherwise null.
 */
export async function guard(
  req: Request,
  limits: { bucket: string; id: string; max: number; window: number; failClosed?: boolean; message?: string }[],
): Promise<Response | null> {
  for (const l of limits) {
    const v = await rateLimit(l.bucket, l.id, l.max, l.window, l.failClosed);
    if (!v.allowed) {
      console.warn(`[rate-limit] blocked ${l.bucket} id=${l.id} count=${v.count}`);
      return tooMany(req, v, l.message);
    }
  }
  return null;
}

// ── Shared-secret auth (for functions with verify_jwt = false) ──────────────
/**
 * Functions invoked by cron/servers rather than the browser must present
 * CRON_SECRET. If the env var isn't set we allow the call (so nothing breaks
 * before the secret is configured) but log loudly.
 */
export function checkCronSecret(req: Request): { ok: boolean; configured: boolean } {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    console.warn("[security] CRON_SECRET not set — endpoint is unauthenticated. Set it in Function secrets.");
    return { ok: true, configured: false };
  }
  const got = req.headers.get("x-cron-secret")
    || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return { ok: timingSafeEqual(got, expected), configured: true };
}

/** Constant-time string compare — avoids leaking the secret via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  // compare a fixed number of bytes so length alone doesn't change timing
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
