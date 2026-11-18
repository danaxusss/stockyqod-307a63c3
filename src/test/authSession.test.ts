import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Supabase client whose auth calls are recorded.
const auth = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  calls: [] as string[],
  invokes: [] as Array<Record<string, unknown>>,
  reply: {} as Record<string, unknown>,
  offline: false,
}));

vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      setSession: async ({ access_token }: { access_token: string }) => {
        auth.calls.push(`set:${access_token}`);
        auth.session = { user: { id: access_token.split(':')[0] } };
        return { error: null };
      },
      signOut: async ({ scope }: { scope: string }) => { auth.calls.push(`signOut:${scope}`); auth.session = null; return { error: null }; },
    },
    functions: {
      invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
        auth.invokes.push(body);
        if (auth.offline) return { data: null, error: new Error('Failed to fetch') };
        return { data: auth.reply, error: null };
      },
    },
  },
}));

import { adoptAuthSession, clearSession, readSession, requireAuthSession, saveSession, validateSession } from '../utils/session';
import { takeLastAuthError } from '../utils/authError';

const user = { id: 'u1', username: 'ali' } as never;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { auth.session = null; auth.calls = []; auth.invokes = []; auth.reply = {}; auth.offline = false; takeLastAuthError(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => vi.unstubAllEnvs());

describe('Supabase session at PIN login', () => {
  it('stores the session that came with the login', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    await adoptAuthSession({ access_token: 'u1:access', refresh_token: 'refresh' });
    expect(auth.calls).toEqual(['set:u1:access']);
  });

  it('closes an earlier session when the login brought none, so nothing runs as the previous user', async () => {
    auth.session = { user: { id: 'previous' } };
    await adoptAuthSession(undefined);
    expect(auth.calls).toEqual(['signOut:local']);
  });

  it('keeps the session while a login replaces the Stocky session, and closes it on logout', async () => {
    auth.session = { user: { id: 'u1' } };
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, true);
    await flush();
    expect(auth.calls).toEqual([]);
    clearSession();
    await flush();
    expect(auth.calls).toEqual(['signOut:local']);
    expect(readSession()).toBeNull();
  });

  it('gets a session for a user signed in before sessions existed, without a new PIN', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    auth.reply = { valid: true, user: { id: 'u1', username: 'ali' }, auth_session: { access_token: 'u1:new', refresh_token: 'r' } };
    await validateSession();
    expect(auth.invokes[0]).toMatchObject({ action: 'validate-session', want_auth_session: true });
    expect(auth.calls).toEqual(['set:u1:new']);

    auth.invokes = []; auth.calls = [];
    await validateSession();
    expect(auth.invokes[0]).toMatchObject({ want_auth_session: false });
    expect(auth.calls).toEqual([]);
  });

  it('asks again when the stored session belongs to another user', async () => {
    auth.session = { user: { id: 'someone-else' } };
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    auth.reply = { valid: true, user: { id: 'u1' }, auth_session: { access_token: 'u1:x', refresh_token: 'r' } };
    await validateSession();
    expect(auth.invokes[0]).toMatchObject({ want_auth_session: true });
    expect(auth.calls).toEqual(['set:u1:x']);
  });
});

describe('no half-working app without a Supabase session', () => {
  it('a login whose Supabase session could not be opened is refused with a clear message', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    await adoptAuthSession(null);
    expect(await requireAuthSession('u1')).toBe(false);
    expect(readSession()).toBeNull();
    expect(takeLastAuthError()).toBe('Connexion sécurisée indisponible, réessayez.');
  });

  it('a login with its session goes on', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    await adoptAuthSession({ access_token: 'u1:access', refresh_token: 'r' });
    expect(await requireAuthSession('u1')).toBe(true);
    expect(readSession()?.user).toMatchObject({ id: 'u1' });
  });

  it('a stored session that cannot get its Supabase session signs out with the message', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    auth.reply = { valid: true, user: { id: 'u1', username: 'ali' }, auth_session: null };
    expect(await validateSession()).toBeNull();
    expect(readSession()).toBeNull();
    expect(takeLastAuthError()).toBe('Connexion sécurisée indisponible, réessayez.');
  });

  it('an old session without a signed token needs its Supabase session too', async () => {
    saveSession(null, user, Math.floor(Date.now() / 1000) + 3600, false);
    expect(await validateSession()).toBeNull();
    saveSession(null, user, Math.floor(Date.now() / 1000) + 3600, false);
    auth.session = { user: { id: 'u1' } };
    expect(await validateSession()).toMatchObject({ id: 'u1' });
  });

  it('offline: the cached user is kept (nothing can be checked)', async () => {
    saveSession('signed', user, Math.floor(Date.now() / 1000) + 3600, false);
    auth.offline = true;
    expect(await validateSession()).toMatchObject({ id: 'u1' });
  });
});

describe('where the Supabase session is kept', () => {
  it('follows "remember me": localStorage when remembered, else sessionStorage, and removal clears both', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.test');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    const { authStorage } = await vi.importActual<typeof import('../integrations/supabase/client')>('../integrations/supabase/client');

    authStorage.setItem('sb-token', 'tab-only');
    expect(sessionStorage.getItem('sb-token')).toBe('tab-only');
    expect(localStorage.getItem('sb-token')).toBeNull();

    localStorage.setItem('inventory_authenticated_user', '{"id":"u1"}');
    authStorage.setItem('sb-token', 'remembered');
    expect(localStorage.getItem('sb-token')).toBe('remembered');
    expect(sessionStorage.getItem('sb-token')).toBeNull();
    expect(authStorage.getItem('sb-token')).toBe('remembered');

    localStorage.removeItem('inventory_authenticated_user');
    expect(authStorage.getItem('sb-token')).toBe('remembered');   // still found for sign-out
    authStorage.removeItem('sb-token');
    expect(localStorage.getItem('sb-token')).toBeNull();
  });
});
