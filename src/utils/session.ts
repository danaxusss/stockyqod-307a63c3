import { supabase } from '@/integrations/supabase/client';
import type { AppUser } from '../types';

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
  token: string;
  user: AppUser;
  expiresAt: number;   // epoch seconds, from the signed token
  remembered: boolean;
}

function stores(): Storage[] {
  return [localStorage, sessionStorage];
}

/** Persist a freshly issued session. */
export function saveSession(token: string, user: AppUser, expiresAt: number, rememberMe: boolean): void {
  clearSession({ keepRememberedUsername: true });
  const store = rememberMe ? localStorage : sessionStorage;
  try {
    store.setItem(TOKEN_KEY, token);
    store.setItem(USER_KEY, JSON.stringify(user));
    store.setItem(EXPIRY_KEY, String(expiresAt));
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
      const token = store.getItem(TOKEN_KEY);
      if (!token) continue;
      const rawUser = store.getItem(USER_KEY);
      const expiresAt = Number(store.getItem(EXPIRY_KEY) || 0);
      if (!rawUser) continue;
      return {
        token,
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

export function clearSession(opts: { keepRememberedUsername?: boolean } = {}): void {
  for (const store of stores()) {
    try {
      [TOKEN_KEY, USER_KEY, EXPIRY_KEY, LAST_SEEN_KEY, ...LEGACY_KEYS].forEach(k => store.removeItem(k));
    } catch { /* */ }
  }
  if (!opts.keepRememberedUsername) forgetRememberedUsername();
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

  try {
    const { data, error } = await supabase.functions.invoke('verify-pin', {
      body: { action: 'validate-session', session_token: s.token },
    });
    if (error) return s.user;               // offline / rate limited — keep cache
    if (!data?.valid) { clearSession({ keepRememberedUsername: true }); return null; }

    const fresh = data.user as AppUser;
    const store = s.remembered ? localStorage : sessionStorage;
    try { store.setItem(USER_KEY, JSON.stringify(fresh)); } catch { /* */ }
    return fresh;
  } catch {
    return s.user;
  }
}

/** Remaining session time in ms (0 when none). */
export function remainingMs(): number {
  const s = readSession();
  if (!s?.expiresAt) return 0;
  return Math.max(0, s.expiresAt * 1000 - Date.now());
}
