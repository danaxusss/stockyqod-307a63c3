// Web search + safe download helpers shared by the product image search and
// the technical sheet search.
//
// Providers, picked by whichever secret is set (first match wins):
//   SERPER_API_KEY        → serper.dev (Google results)
//   BRAVE_SEARCH_API_KEY  → Brave Search API
// Google's own Custom Search JSON API is closed to new customers and retires
// on 1 January 2027, so it is deliberately not supported.

export type SearchProvider = "serper" | "brave";

const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function searchProvider(): SearchProvider | null {
  if (Deno.env.get("SERPER_API_KEY")) return "serper";
  if (Deno.env.get("BRAVE_SEARCH_API_KEY")) return "brave";
  return null;
}

/** POST to a serper.dev endpoint ("images", "search"…). */
export async function serperRequest(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: { "X-API-KEY": Deno.env.get("SERPER_API_KEY")!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Recherche indisponible (Serper ${response.status})`);
  return await response.json();
}

/** GET a Brave Search API path ("images/search", "web/search"…). */
export async function braveRequest(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.search.brave.com/res/v1/${path}?${new URLSearchParams(params)}`, {
    headers: { "X-Subscription-Token": Deno.env.get("BRAVE_SEARCH_API_KEY")!, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Recherche indisponible (Brave ${response.status})`);
  return await response.json();
}

/**
 * Only public web addresses: blocks localhost and private / link-local IP
 * literals so the functions cannot be pointed at internal services.
 */
export function isPublicHttpUrl(value: string): boolean {
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

export type FetchedFile = {
  contentType: string;
  bytes: Uint8Array;
  finalUrl: string;
  /** From Content-Disposition, when the server sends one. */
  fileName: string | null;
};

function dispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ } }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

/**
 * Download a public file with a size cap. Redirects are followed by hand so
 * every hop goes through the same address check.
 */
export async function fetchPublicFile(url: string, options: { referer?: string | null; accept: string; maxBytes: number }): Promise<FetchedFile> {
  const tooBig = `Fichier trop volumineux (maximum ${Math.round(options.maxBytes / 1024 / 1024)} Mo)`;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error("Adresse non autorisée");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: options.accept,
        ...(options.referer && isPublicHttpUrl(options.referer) ? { Referer: options.referer } : {}),
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
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > options.maxBytes) {
      await response.body?.cancel();
      throw new Error(tooBig);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Fichier vide");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new Error(tooBig);
      }
      chunks.push(value);
    }
    if (!size) throw new Error("Fichier vide");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return {
      contentType: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
      bytes,
      finalUrl: current,
      fileName: dispositionFileName(response.headers.get("content-disposition")),
    };
  }
  throw new Error("Trop de redirections");
}

/** A failed download is the source site's doing, not a server error. */
export function downloadErrorMessage(error: unknown): string {
  return error instanceof Error && error.name !== "TimeoutError" ? error.message : "Le site source ne répond pas";
}
