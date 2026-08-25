// Server-signed session tokens.
//
// WHY: the app previously trusted localStorage. `is_admin` / `is_superadmin`
// were stored client-side, so a normal user could open devtools, flip the
// flag, and be treated as a superadmin — and the session expiry timestamp was
// equally editable, so a session never really ended.
//
// A token is signed with a server-only secret, so the browser can read its own
// claims but cannot forge or alter them. Anything privileged must call
// verifySession() rather than believe what the client sends.
//
// Format: v1.<base64url(payload)>.<base64url(hmac-sha256)>
// This is a compact JWT-alike; we keep it hand-rolled to avoid pulling a JWT
// dependency into every function for one signature check.

const ENC = new TextEncoder();

export interface SessionClaims {
  uid: string;              // app_users.id
  usr: string;              // username
  adm: boolean;             // is_admin
  sup: boolean;             // is_superadmin
  cid: string | null;       // company_id
  iat: number;              // issued at (epoch seconds)
  exp: number;              // expires at (epoch seconds)
  rem: boolean;             // issued with "remember me"
}

/** Session lifetimes. "Remember me" trades convenience for a longer window. */
export const SESSION_TTL = {
  standard: 12 * 60 * 60,        // 12 h — closes with the working day
  remember: 30 * 24 * 60 * 60,   // 30 days
};

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * The signing secret. Falls back to the service role key so tokens still work
 * before SESSION_SECRET is configured — that key is server-only, so the token
 * remains unforgeable either way; a dedicated secret is simply cleaner to
 * rotate (rotating it logs everyone out, which is the desired effect).
 */
function secret(): string {
  const s = Deno.env.get("SESSION_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!s) throw new Error("No signing secret available");
  return s;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", ENC.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

/** Issue a signed token. `rememberMe` only changes how long it stays valid. */
export async function issueSession(
  user: { id: string; username: string; is_admin?: boolean; is_superadmin?: boolean; company_id?: string | null },
  rememberMe: boolean,
): Promise<{ token: string; expires_at: number }> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = rememberMe ? SESSION_TTL.remember : SESSION_TTL.standard;
  const claims: SessionClaims = {
    uid: user.id,
    usr: user.username,
    adm: !!user.is_admin,
    sup: !!user.is_superadmin,
    cid: user.company_id ?? null,
    iat: now,
    exp: now + ttl,
    rem: !!rememberMe,
  };
  const payload = b64urlEncode(ENC.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await key(), ENC.encode(`v1.${payload}`));
  return { token: `v1.${payload}.${b64urlEncode(new Uint8Array(sig))}`, expires_at: claims.exp };
}

/**
 * Verify signature and expiry. Returns null for anything not provably issued
 * by us and still valid — callers must treat null as "not authenticated".
 * crypto.subtle.verify is constant-time, so this leaks nothing by timing.
 */
export async function verifySession(token: unknown): Promise<SessionClaims | null> {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;

    const ok = await crypto.subtle.verify(
      "HMAC", await key(), b64urlDecode(parts[2]), ENC.encode(`v1.${parts[1]}`),
    );
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as SessionClaims;
    if (!claims?.uid || typeof claims.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) >= claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Verify a token AND re-read the user, so that a change made after the token
 * was issued (rights revoked, account deleted) takes effect immediately
 * instead of lingering until expiry. Signature alone is not enough for
 * privileged actions.
 */
export async function verifySessionLive(
  db: { from: (t: string) => any },
  token: unknown,
): Promise<{ claims: SessionClaims; user: any } | null> {
  const claims = await verifySession(token);
  if (!claims) return null;
  const { data: user, error } = await db
    .from("app_users")
    .select("id, username, custom_seller_name, is_admin, is_superadmin, new_role, company_id, can_create_quote")
    .eq("id", claims.uid)
    .maybeSingle();
  if (error || !user) return null;
  return { claims, user };
}
