// Real Supabase Auth sessions for PIN logins.
//
// WHY: every database request used to carry only the public (anon) key, so the
// database could not tell a signed-in employee from anyone who copied that key
// out of the website. Each Stocky user now has a hidden Supabase Auth account
// whose id IS their app_users.id, and a correct PIN opens a standard Supabase
// session for it. Requests then carry a signed JWT, which database rules can
// check (auth.uid() = app_users.id, app_metadata = role and company).
//
// The account has no password and no real e-mail: the only way in is through
// verify-pin, after the PIN has been checked. Nothing is ever e-mailed.
//
// Issuing a session must never break the PIN login itself: any failure here is
// logged and the caller simply gets no auth session.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
}

type AppUserLike = {
  id: string;
  username?: string | null;
  company_id?: string | null;
  new_role?: string | null;
  is_admin?: boolean | null;
  is_superadmin?: boolean | null;
};

/** Never e-mailed: `.invalid` is a reserved domain that can't receive mail. */
export const authEmailFor = (appUserId: string) => `${appUserId}@users.stocky.invalid`;

/** Claims the database rules may rely on. Only the server can set app_metadata. */
export function appMetadataFor(user: AppUserLike) {
  return {
    app_user_id: user.id,
    company_id: user.company_id ?? null,
    role: user.new_role ?? null,
    is_admin: !!user.is_admin,
    is_superadmin: !!user.is_superadmin,
  };
}

const sameMetadata = (a: Record<string, unknown> | undefined, b: Record<string, unknown>) =>
  Object.keys(b).every(key => (a?.[key] ?? null) === (b[key] ?? null));

/** Create the hidden Auth account, or bring its role/company claims up to date. */
async function ensureAuthUser(admin: any, user: AppUserLike): Promise<string> {
  const email = authEmailFor(user.id);
  const app_metadata = appMetadataFor(user);
  const { data: found } = await admin.auth.admin.getUserById(user.id);
  const existing = found?.user;
  if (!existing) {
    const { error } = await admin.auth.admin.createUser({
      id: user.id,
      email,
      email_confirm: true,
      app_metadata,
      user_metadata: { username: user.username ?? null },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    return email;
  }
  if (!sameMetadata(existing.app_metadata, app_metadata)) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata });
    if (error) throw new Error(`updateUser: ${error.message}`);
  }
  return existing.email || email;
}

/**
 * Open a Supabase session for an app user whose PIN (or signed session token)
 * has already been verified. Returns null on any failure.
 */
export async function issueAuthSession(admin: any, user: AppUserLike): Promise<AuthSession | null> {
  try {
    const email = await ensureAuthUser(admin, user);
    // A one-time sign-in link, generated server-side and redeemed right away:
    // nothing is sent anywhere.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) throw new Error(`generateLink: ${linkError?.message || "no token"}`);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error || !data?.session) throw new Error(`verifyOtp: ${error?.message || "no session"}`);

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? null,
    };
  } catch (e) {
    console.error(`[auth-session] could not open a session for user=${user.id}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
