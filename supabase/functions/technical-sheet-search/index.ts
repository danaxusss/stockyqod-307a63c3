// Web search for product technical sheets (PDF, sometimes Word), plus a
// server-side download of the chosen document for preview and for storing it
// in the technical sheet library. Uses the same search provider secret as
// product-image-search (SERPER_API_KEY or BRAVE_SEARCH_API_KEY).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json, rateLimit } from "../_shared/security.ts";
import { verifySessionLive } from "../_shared/session.ts";
import {
  braveRequest, downloadErrorMessage, fetchPublicFile, hostOf, isPublicHttpUrl, searchProvider, serperRequest, text,
} from "../_shared/webSearch.ts";

type DocumentKind = "pdf" | "doc" | "docx";

type SheetResult = {
  url: string;
  title: string;
  snippet: string;
  source: string;
  kind: DocumentKind | null;
};

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

const MIME: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** File type from the address, when it ends with a known extension. */
function kindFromUrl(url: string): DocumentKind | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".pdf")) return "pdf";
    if (path.endsWith(".docx")) return "docx";
    if (path.endsWith(".doc")) return "doc";
  } catch { /* not a URL */ }
  return null;
}

/**
 * What the downloaded bytes really are. Servers often send PDFs as
 * application/octet-stream, and some "PDF" links lead to an HTML page.
 */
function sniffKind(bytes: Uint8Array, contentType: string, url: string): DocumentKind | null {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "doc"; // OLE2 (Word 97-2003)
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    // A zip: only accept it when it presents itself as a Word document.
    if (contentType.includes("wordprocessingml") || kindFromUrl(url) === "docx") return "docx";
  }
  return null;
}

function fileNameFor(url: string, fromHeader: string | null, kind: DocumentKind): string {
  let name = fromHeader || "";
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || ""); } catch { name = ""; }
  }
  name = name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 150) || "fiche-technique";
  return /\.(pdf|docx?)$/i.test(name) ? name : `${name}.${kind}`;
}

function withFileType(query: string, fileType: string): string {
  return fileType === "documents"
    ? `${query} (filetype:pdf OR filetype:doc OR filetype:docx)`
    : `${query} filetype:pdf`;
}

async function searchSerper(query: string): Promise<SheetResult[]> {
  const data = await serperRequest("search", { q: query, num: 20, gl: "ma", hl: "fr" });
  return (Array.isArray(data?.organic) ? data.organic : []).map((item: Record<string, unknown>) => {
    const url = text(item.link, 2000);
    return { url, title: text(item.title, 300), snippet: text(item.snippet, 400), source: hostOf(url), kind: kindFromUrl(url) };
  });
}

async function searchBrave(query: string): Promise<SheetResult[]> {
  const data = await braveRequest("web/search", { q: query, count: "20", safesearch: "moderate" });
  const web = (data?.web || {}) as Record<string, unknown>;
  return (Array.isArray(web.results) ? web.results : []).map((item: Record<string, any>) => {
    const url = text(item.url, 2000);
    return {
      url,
      title: text(item.title, 300),
      snippet: text(item.description, 400).replace(/<[^>]+>/g, ""),
      source: text(item.meta_url?.hostname, 200).replace(/^www\./, "") || hostOf(url),
      kind: kindFromUrl(url),
    };
  });
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
      const verdict = await rateLimit("sheet-search:authfail", ip, 10, 15 * 60, true);
      return json(req, { error: verdict.allowed ? "Reconnectez-vous pour rechercher des fiches techniques." : "Too many attempts" }, verdict.allowed ? 401 : 429);
    }
    const userId = String(live.user.id);
    const action = text(body.action, 30);

    if (action === "search") {
      const active = searchProvider();
      if (!active) {
        return json(req, {
          error: "Aucun service de recherche n'est configuré (secret SERPER_API_KEY ou BRAVE_SEARCH_API_KEY).",
          code: "not_configured",
        }, 501);
      }
      const query = text(body.query, 200);
      if (query.length < 2) return json(req, { error: "Recherche trop courte" }, 400);
      const blocked = await guard(req, [
        { bucket: "sheet-search:user:hour", id: userId, max: 200, window: 60 * 60, message: "Quota horaire de recherche de fiches atteint." },
        { bucket: "sheet-search:user:day", id: userId, max: 1000, window: 24 * 60 * 60, message: "Quota journalier de recherche de fiches atteint." },
        { bucket: "sheet-search:ip:hour", id: ip, max: 600, window: 60 * 60, message: "Quota horaire de recherche de fiches atteint." },
      ]);
      if (blocked) return blocked;
      const fileType = text(body.file_type, 20);
      const full = withFileType(query, fileType);
      const results = active === "serper" ? await searchSerper(full) : await searchBrave(full);
      const seen = new Set<string>();
      return json(req, {
        provider: active,
        results: results.filter(result => {
          if (!isPublicHttpUrl(result.url) || seen.has(result.url)) return false;
          seen.add(result.url);
          return true;
        }),
      });
    }

    if (action === "fetch") {
      const url = text(body.url, 2000);
      if (!isPublicHttpUrl(url)) return json(req, { error: "Adresse non autorisée" }, 400);
      const blocked = await guard(req, [
        { bucket: "sheet-search:fetch:user", id: userId, max: 300, window: 60 * 60, message: "Trop de téléchargements de fiches, patientez un peu." },
      ]);
      if (blocked) return blocked;
      try {
        const file = await fetchPublicFile(url, {
          accept: "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.5",
          maxBytes: MAX_DOCUMENT_BYTES,
        });
        const kind = sniffKind(file.bytes, file.contentType, file.finalUrl);
        if (!kind) {
          throw new Error(file.contentType.includes("html")
            ? "Ce lien mène à une page web, pas à un document. Ouvrez-le pour trouver le PDF."
            : "Ce fichier n'est ni un PDF ni un document Word.");
        }
        return json(req, {
          content_type: MIME[kind],
          kind,
          size: file.bytes.byteLength,
          file_name: fileNameFor(file.finalUrl, file.fileName, kind),
          data: encodeBase64(file.bytes),
        });
      } catch (error) {
        return json(req, { error: downloadErrorMessage(error) }, 422);
      }
    }

    return json(req, { error: "Invalid action" }, 400);
  } catch (error) {
    console.error("technical-sheet-search error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Erreur inattendue" }, 502);
  }
});
