// Surfaces the reason a login attempt failed when it wasn't simply a bad PIN.
//
// The auth hooks return a plain boolean, so this module-level slot lets the
// login UI tell "wrong PIN" apart from "you're temporarily rate limited"
// without changing every caller's signature.

let lastAuthError: string | null = null;

export function setLastAuthError(msg: string | null): void {
  lastAuthError = msg;
}

/** Read (and clear) the last non-credential auth failure reason. */
export function takeLastAuthError(): string | null {
  const v = lastAuthError;
  lastAuthError = null;
  return v;
}

/**
 * Turn a supabase.functions.invoke() error into a user-facing message when the
 * server answered 429. Returns null for every other failure so the caller falls
 * back to its normal "invalid credentials" wording.
 */
export async function rateLimitMessage(error: unknown): Promise<string | null> {
  const ctx = (error as any)?.context;
  if (!ctx || ctx.status !== 429) return null;
  let retry = 0;
  try {
    const body = typeof ctx.json === 'function' ? await ctx.clone().json() : null;
    retry = Number(body?.retry_after) || 0;
  } catch { /* body already consumed or not JSON */ }
  if (retry >= 60) {
    return `Trop de tentatives. Réessayez dans ${Math.ceil(retry / 60)} minute(s).`;
  }
  return 'Trop de tentatives. Réessayez dans quelques minutes.';
}
