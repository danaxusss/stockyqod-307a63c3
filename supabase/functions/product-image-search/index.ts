// Web image search for product photos, plus a server-side fetch of the
// chosen image (most image hosts send no CORS headers, so the browser cannot
// download them itself). The browser then compresses and stores the image
// through the normal product image pipeline.
//
// Providers, picked by whichever secret is set (first match wins):
//   SERPER_API_KEY        → serper.dev Google Images results
//   BRAVE_SEARCH_API_KEY  → Brave Search image API
// Google's own Custom Search JSON API is closed to new customers and retires
// on 1 January 2027, so it is deliberately not supported.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json, rateLimit } from "../_shared/security.ts";
import { verifySessionLive } from "../_shared/session.ts";

type ImageResult = {
  url: string;
  thumbnail: string;
  width: number | null;
  height: number | null;
  title: string;
  source: string;
  page: string | null;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function provider(): "serper" | "brave" | null {
  if (Deno.env.get("SERPER_API_KEY")) return "serper";
  if (Deno.env.get("BRAVE_SEARCH_API_KEY")) return "brave";
  return null;
}

async function searchSerper(query: string): Promise<ImageResult[]> {
  const response = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: { "X-API-KEY": Deno.env.get("SERPER_API_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 30, gl: "ma", hl: "fr" }),
  });
  if (!response.ok) throw new Error(`Recherche d'images indisponible (Serper ${response.status})`);
  const data = await response.json();
  return (Array.isArray(data?.images) ? data.images : []).map((item: Record<string, unknown>) => ({
    url: text(item.imageUrl, 2000),
    thumbnail: text(item.thumbnailUrl, 2000) || text(item.imageUrl, 2000),
    width: positive(item.imageWidth),
    height: positive(item.imageHeight),
    title: text(item.title, 300),
    source: text(item.domain, 200) || hostOf(text(item.link, 2000)),
    page: text(item.link, 2000) || null,
  }));
}

async function searchBrave(query: string): Promise<ImageResult[]> {
  const params = new URLSearchParams({ q: query, count: "30", safesearch: "strict" });
  const response = await fetch(`https://api.search.brave.com/res/v1/images/search?${params}`, {
    headers: { "X-Subscription-Token": Deno.env.get("BRAVE_SEARCH_API_KEY")!, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Recherche d'images indisponible (Brave ${response.status})`);
  const data = await response.json();
  return (Array.isArray(data?.results) ? data.results : []).map((item: Record<string, any>) => ({
    url: text(item.properties?.url, 2000),
    thumbnail: text(item.thumbnail?.src, 2000) || text(item.properties?.url, 2000),
    width: positive(item.properties?.width),
    height: positive(item.properties?.height),
    title: text(item.title, 300),
    source: text(item.source, 200) || hostOf(text(item.url, 2000)),
    page: text(item.url, 2000) || null,
  }));
}

/**
 * Only public web addresses: blocks localhost and private / link-local IP
 * literals so the function cannot be pointed at internal services.
 */
function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:")) return false;
  }
  return true;
}

async function fetchImage(url: string, referer: string | null): Promise<{ contentType: string; bytes: Uint8Array }> {
  let current = url;
  // Follow redirects by hand so every hop goes through the same address check.
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error("Adresse d'image non autorisée");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        ...(referer && isPublicHttpUrl(referer) ? { Referer: referer } : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirection invalide");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Le site source refuse le téléchargement (HTTP ${response.status})`);
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      await response.body?.cancel();
      throw new Error("Cette adresse ne renvoie pas une image");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error("Image trop volumineuse (maximum 10 Mo)");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Image vide");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Image trop volumineuse (maximum 10 Mo)");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!size) throw new Error("Image vide");
    return { contentType, bytes };
  }
  throw new Error("Trop de redirections");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const ip = clientIp(req);

  try {
    const body = await req.json();
    const live = await verifySessionLive(supabase, body?.session_token);
    if (!live) {
      const verdict = await rateLimit("image-search:authfail", ip, 10, 15 * 60, true);
      return json(req, { error: verdict.allowed ? "Reconnectez-vous pour rechercher des images." : "Too many attempts" }, verdict.allowed ? 401 : 429);
    }
    const userId = String(live.user.id);
    const action = text(body.action, 30);

    if (action === "status") {
      return json(req, { provider: provider() });
    }

    if (action === "search") {
      const active = provider();
      if (!active) {
        return json(req, {
          error: "Aucun service de recherche d'images n'est configuré (secret SERPER_API_KEY ou BRAVE_SEARCH_API_KEY).",
          code: "not_configured",
        }, 501);
      }
      const query = text(body.query, 200);
      if (query.length < 2) return json(req, { error: "Recherche trop courte" }, 400);
      // Each search is a paid API call: cap it per user and per company IP.
      const blocked = await guard(req, [
        { bucket: "image-search:user:hour", id: userId, max: 300, window: 60 * 60, message: "Quota horaire de recherche d'images atteint." },
        { bucket: "image-search:user:day", id: userId, max: 1500, window: 24 * 60 * 60, message: "Quota journalier de recherche d'images atteint." },
        { bucket: "image-search:ip:hour", id: ip, max: 900, window: 60 * 60, message: "Quota horaire de recherche d'images atteint." },
      ]);
      if (blocked) return blocked;
      const results = active === "serper" ? await searchSerper(query) : await searchBrave(query);
      return json(req, {
        provider: active,
        results: results.filter(result => isPublicHttpUrl(result.url)),
      });
    }

    if (action === "fetch") {
      const url = text(body.url, 2000);
      if (!isPublicHttpUrl(url)) return json(req, { error: "Adresse d'image non autorisée" }, 400);
      const blocked = await guard(req, [
        { bucket: "image-search:fetch:user", id: userId, max: 600, window: 60 * 60, message: "Trop de téléchargements d'images, patientez un peu." },
      ]);
      if (blocked) return blocked;
      try {
        const image = await fetchImage(url, text(body.referer, 2000) || null);
        return json(req, {
          content_type: image.contentType,
          size: image.bytes.byteLength,
          data: encodeBase64(image.bytes),
        });
      } catch (error) {
        // The source site refused or timed out: not a server fault.
        const message = error instanceof Error && error.name !== "TimeoutError" ? error.message : "Le site source ne répond pas";
        return json(req, { error: message }, 422);
      }
    }

    return json(req, { error: "Invalid action" }, 400);
  } catch (error) {
    console.error("product-image-search error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Erreur inattendue" }, 502);
  }
});
