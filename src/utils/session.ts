import { supabase } from '@/integrations/supabase/client';
import type { AppUser } from '../types';
import { setLastAuthError } from './authError';

/**
 * Session storage for the PIN-based login.
 *
 * The session is a token signed by the server. The browser can read its claims
 * but cannot forge or edit them, so privileged endpoints verify the token
 * instead of believing a user object out of localStorage (which any user could
 * previously edit to grant themselves superadmin).
 *
 * "Remember me" decides WHERE the session is kept and HOW LONG it lasts:
 *   • checked   → localStorage,   30 days, survives closing the browser
 *   • unchecked → sessionStorage, 12 hours, dies with the tab
 * The real expiry is baked into the signed token, so editing anything here
 * cannot extend a session — the server rejects it.
 */

const TOKEN_KEY = 'stocky_session_token';
const USER_KEY  = 'inventory_authenticated_user';   // kept: UI reads it for display
const EXPIRY_KEY = 'stocky_session_expires';
const LAST_SEEN_KEY = 'stocky_session_last_seen';
const REMEMBERED_USER_KEY = 'stocky_remembered_username';

/** Log out after this long with no activity, even inside a valid token. */
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;   // 8 h

// Legacy keys from the previous localStorage-flag scheme. Cleared on logout so
// an old "authenticated=true" flag can't linger and imply a session.
const LEGACY_KEYS = [
  'inventory_user_authenticated',
  'inventory_user_auth_time',
  'inventory_admin_pin',
];

export interface StoredSession {
  /**
   * Signed token, or null in legacy mode — see saveSession(). Anything
   * privileged must treat a null token as "cannot prove who this is".
   */
  token: string | null;
  user: AppUser;
  expiresAt: number;   // epoch seconds, from the signed token
  remembered: boolean;
}

/** Session lifetimes mirrored from the server, used only in legacy mode. */
const TTL_SECONDS = { standard: 12 * 60 * 60, remember: 30 * 24 * 60 * 60 };

function stores(): Storage[] {
  return [localStorage, sessionStorage];
}

/**
 * Persist a freshly issued session.
 *
 * `token` may be null when the deployed verify-pin function predates session
 * tokens (the front-end ships independently of Edge Functions, so there is a
 * window where the browser is new and the server is not). The PIN was still
 * verified server-side in that case — only the signed proof is missing — so we
 * fall back to a locally-tracked session instead of locking everyone out. It
 * upgrades itself to a signed session on the next login once the function is
 * deployed.
 */
export function saveSession(token: string | null, user: AppUser, expiresAt: number | null | undefined, rememberMe: boolean): void {
  sharedCheck = null;
  // The Supabase session is replaced right after by adoptAuthSession().
  clearSession({ keepRememberedUsername: true, keepAuthSession: true });
  const store = rememberMe ? localStorage : sessionStorage;
  const exp = expiresAt && Number(expiresAt) > 0
    ? Number(expiresAt)
    : Math.floor(Date.now() / 1000) + (rememberMe ? TTL_SECONDS.remember : TTL_SECONDS.standard);
  try {
    if (token) store.setItem(TOKEN_KEY, token);
    store.setItem(USER_KEY, JSON.stringify(user));
    store.setItem(EXPIRY_KEY, String(exp));
    store.setItem(LAST_SEEN_KEY, String(Date.now()));
    // Only the username is remembered for convenience — never the PIN.
    if (rememberMe && user?.username) {
      localStorage.setItem(REMEMBERED_USER_KEY, user.username);
    }
  } catch { /* storage may be full or blocked */ }
}

/** Read the current session from whichever store holds it. */
export function readSession(): StoredSession | null {
  for (const store of stores()) {
    try {
      // A session is identified by the stored user + expiry. The token may be
      // absent (legacy mode, see saveSession) — that weakens what we can
      // prove to the server, but it is still a real session locally.
      const rawUser = store.getItem(USER_KEY);
      const expiresAt = Number(store.getItem(EXPIRY_KEY) || 0);
      if (!rawUser || !expiresAt) continue;
      return {
        token: store.getItem(TOKEN_KEY),
        user: JSON.parse(rawUser) as AppUser,
        expiresAt,
        remembered: store === localStorage,
      };
    } catch { /* corrupt entry — treat as no session */ }
  }
  return null;
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}

/** Username to pre-fill on the login screen (only if "remember me" was used). */
export function getRememberedUsername(): string | null {
  try { return localStorage.getItem(REMEMBERED_USER_KEY); } catch { return null; }
}

export function forgetRememberedUsername(): void {
  try { localStorage.removeItem(REMEMBERED_USER_KEY); } catch { /* */ }
}

export function clearSession(opts: { keepRememberedUsername?: boolean; keepAuthSession?: boolean } = {}): void {
  sharedCheck = null;
  // Close the Supabase session first: its storage still finds it once the
  // keys below are gone (see integrations/supabase/client.ts).
  if (!opts.keepAuthSession) void endAuthSession();
  for (const store of stores()) {
    try {
      [TOKEN_KEY, USER_KEY, EXPIRY_KEY, LAST_SEEN_KEY, ...LEGACY_KEYS].forEach(k => store.removeItem(k));
    } catch { /* */ }
  }
  // The identity and rights cached by useAuth belong to this session too: on
  // a shared computer the next person must not inherit them.
  try {
    localStorage.removeItem('inventory_current_user');
    localStorage.removeItem('inventory_user_permissions');
  } catch { /* */ }
  if (!opts.keepRememberedUsername) forgetRememberedUsername();
}

/** Supabase session issued by verify-pin with the PIN login. */
export interface AuthSessionTokens {
  access_token: string;
  refresh_token: string;
}

const isAuthSession = (value: unknown): value is AuthSessionTokens =>
  !!value && typeof (value as AuthSessionTokens).access_token === 'string' && typeof (value as AuthSessionTokens).refresh_token === 'string';

/**
 * Use the Supabase session that came with a login (database requests then
 * carry the user's identity). Without one, any earlier session on this device
 * is closed so requests never run as the previous user.
 */
export async function adoptAuthSession(auth: unknown): Promise<void> {
  try {
    if (isAuthSession(auth)) {
      const { error } = await supabase.auth.setSession({ access_token: auth.access_token, refresh_token: auth.refresh_token });
      if (error) console.warn('[auth] Supabase session not stored:', error.message);
      return;
    }
    await endAuthSession();
  } catch (error) {
    console.warn('[auth] Supabase session not stored:', error);
  }
}

/** Close the Supabase session of this device (also revokes it server-side). */
export async function endAuthSession(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.auth.signOut({ scope: 'local' });
  } catch { /* offline: the stored session is removed anyway */ }
}

/** True when this device holds a Supabase session for that Stocky user. */
async function hasAuthSessionFor(userId: string | undefined): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session && !!userId && data.session.user?.id === userId;
  } catch { return false; }
}

/** Shown when the PIN was right but the database session could not be opened. */
export const SECURE_SESSION_UNAVAILABLE = 'Connexion sécurisée indisponible, réessayez.';

/**
 * The database only answers signed-in requests (secure login step 2), so a
 * Stocky session without its Supabase session would be a half-working app.
 * Returns true when this device holds one for the user; otherwise closes the
 * Stocky session and leaves the reason for the login screen.
 */
export async function requireAuthSession(userId: string | undefined): Promise<boolean> {
  if (await hasAuthSessionFor(userId)) return true;
  clearSession({ keepRememberedUsername: true });
  setLastAuthError(SECURE_SESSION_UNAVAILABLE);
  return false;
}

/** Refresh the idle clock — called on user activity. */
export function touchSession(): void {
  const s = readSession();
  if (!s) return;
  const store = s.remembered ? localStorage : sessionStorage;
  try { store.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* */ }
}

function idleExpired(): boolean {
  for (const store of stores()) {
    try {
      const last = store.getItem(LAST_SEEN_KEY);
      if (last) return Date.now() - Number(last) > IDLE_TIMEOUT_MS;
    } catch { /* */ }
  }
  return false;
}

/**
 * Cheap local check for render-time decisions. Not authoritative — the token's
 * signature is only ever checked by the server (validateSession).
 */
export function hasLocallyValidSession(): boolean {
  const s = readSession();
  if (!s) return false;
  if (s.expiresAt && Date.now() / 1000 >= s.expiresAt) { clearSession({ keepRememberedUsername: true }); return false; }
  if (idleExpired()) { clearSession({ keepRememberedUsername: true }); return false; }
  return true;
}

/**
 * Ask the server whether the token is genuine and still valid, and refresh the
 * cached user from the database so revoked rights take effect immediately.
 * Returns the authoritative user, or null (caller should log out).
 *
 * A network failure returns the cached user rather than logging everyone out
 * during an outage — the token is still signed and unexpired locally, and
 * anything privileged is re-verified server-side anyway.
 */
export async function validateSession(): Promise<AppUser | null> {
  const s = readSession();
  if (!s) return null;
  if (!hasLocallyValidSession()) return null;
  // Legacy session with no token: nothing to verify server-side. Local expiry
  // and the idle timeout still apply; it still needs its Supabase session.
  if (!s.token) return (await requireAuthSession(s.user?.id)) ? s.user : null;

  try {
    // Users signed in before Supabase sessions existed get one without
    // typing their PIN again.
    const wantAuthSession = !(await hasAuthSessionFor(s.user?.id));
    const { data, error } = await supabase.functions.invoke('verify-pin', {
      body: { action: 'validate-session', session_token: s.token, want_auth_session: wantAuthSession },
    });
    if (error) return s.user;               // offline / rate limited — keep cache
    if (!data?.valid) { clearSession({ keepRememberedUsername: true }); return null; }
    if (wantAuthSession && data.auth_session) await adoptAuthSession(data.auth_session);

    const fresh = data.user as AppUser;
    // Still no Supabase session (it could not be opened): sign in again
    // rather than use an app whose every request is refused.
    if (wantAuthSession && !(await requireAuthSession(fresh?.id ?? s.user?.id))) return null;
    const store = s.remembered ? localStorage : sessionStorage;
    try { store.setItem(USER_KEY, JSON.stringify(fresh)); } catch { /* */ }
    return fresh;
  } catch {
    return s.user;
  }
}

// One server check shared by the whole app. Every component that knows the
// user (pages, sidebar, header, search…) used to ask on mount, so each page
// change sent several validate-session calls to the edge function and each
// answer re-rendered the app. Callers now share one in-flight request and
// reuse its answer for a few minutes; the hourly re-check still happens.
const SHARED_CHECK_MS = 5 * 60 * 1000;
let sharedCheck: { token: string | null; at: number; promise: Promise<AppUser | null> } | null = null;

export function validateSessionShared(maxAgeMs = SHARED_CHECK_MS): Promise<AppUser | null> {
  const token = readSession()?.token ?? null;
  if (sharedCheck && sharedCheck.token === token && Date.now() - sharedCheck.at < maxAgeMs) return sharedCheck.promise;
  const promise = validateSession();
  sharedCheck = { token, at: Date.now(), promise };
  // A failed or logged-out check is not reused.
  promise.then(user => { if (!user && sharedCheck?.promise === promise) sharedCheck = null; }, () => { if (sharedCheck?.promise === promise) sharedCheck = null; });
  return promise;
}

/** Forget the shared answer (login, logout, user change). */
export function resetSharedSessionCheck(): void {
  sharedCheck = null;
}

/** Remaining session time in ms (0 when none). */
export function remainingMs(): number {
  const s = readSession();
  if (!s?.expiresAt) return 0;
  return Math.max(0, s.expiresAt * 1000 - Date.now());
}
