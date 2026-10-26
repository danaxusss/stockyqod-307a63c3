// Web image search for product photos, plus a server-side fetch of the
// chosen image (most image hosts send no CORS headers, so the browser cannot
// download them itself). The browser then compresses and stores the image
// through the normal product image pipeline.
//
// Provider selection, address checks and downloads live in
// ../_shared/webSearch.ts (shared with technical-sheet-search).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json, rateLimit } from "../_shared/security.ts";
import { verifySessionLive } from "../_shared/session.ts";
import {
  braveRequest, downloadErrorMessage, fetchPublicFile, hostOf, isPublicHttpUrl, positive, searchProvider, serperRequest, text,
} from "../_shared/webSearch.ts";

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

async function searchSerper(query: string): Promise<ImageResult[]> {
  const data = await serperRequest("images", { q: query, num: 30, gl: "ma", hl: "fr" });
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
  const data = await braveRequest("images/search", { q: query, count: "30", safesearch: "strict" });
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
      return json(req, { provider: searchProvider() });
    }

    if (action === "search") {
      const active = searchProvider();
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
        const file = await fetchPublicFile(url, {
          referer: text(body.referer, 2000) || null,
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          maxBytes: MAX_IMAGE_BYTES,
        });
        if (!file.contentType.startsWith("image/")) throw new Error("Cette adresse ne renvoie pas une image");
        return json(req, {
          content_type: file.contentType,
          size: file.bytes.byteLength,
          data: encodeBase64(file.bytes),
        });
      } catch (error) {
        // The source site refused or timed out: not a server fault.
        return json(req, { error: downloadErrorMessage(error) }, 422);
      }
    }

    return json(req, { error: "Invalid action" }, 400);
  } catch (error) {
    console.error("product-image-search error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Erreur inattendue" }, 502);
  }
});
