import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  invokes: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  tables: [] as string[],
  outboxStatuses: [] as string[][],
  outboxInserts: [] as Array<Record<string, unknown>>,
  outboxUpdates: [] as Array<Record<string, unknown>>,
  campaignUpdates: [] as Array<Record<string, unknown>>,
  queued: [] as Array<{ to_phone: string }>,
  token: 'signed-token' as string | null,
}));

vi.mock('../utils/session', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/session')>()),
  getToken: () => db.token,
}));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => ({ companyId: 'c1' }) }));
const supabaseMock = vi.hoisted(() => () => {
  // A chainable query builder that records what each table was asked for.
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === 'wa_outbox') return { data: db.queued, error: null };
      return { data: [], error: null };
    };
    Object.assign(chain, {
      select: () => chain,
      eq: () => chain,
      in: (_col: string, values: string[]) => { if (table === 'wa_outbox') db.outboxStatuses.push(values); return chain; },
      update: (values: Record<string, unknown>) => {
        if (table === 'wa_outbox') db.outboxUpdates.push(values);
        if (table === 'wa_campaigns') db.campaignUpdates.push(values);
        return chain;
      },
      upsert: async () => ({ error: null }),
      insert: async (rows: Array<Record<string, unknown>>) => { if (table === 'wa_outbox') db.outboxInserts.push(...rows); return { error: null }; },
      then: (resolve: (v: unknown) => void) => resolve(result()),
    });
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => { db.tables.push(table); return builder(table); },
      rpc: async () => ({ data: [], error: null }),
      functions: {
        invoke: async (fn: string, { body }: { body: Record<string, unknown> }) => {
          db.invokes.push({ fn, body });
          if (body.action === 'check_username') return { data: { available: true }, error: null };
          return { data: { user: { id: 'u1', username: 'ali', is_admin: false, allowed_stock_locations: [], allowed_brands: [] } }, error: null };
        },
      },
    },
  };
});
vi.mock('../utils/supabaseClient', supabaseMock);
vi.mock('../integrations/supabase/client', supabaseMock);

import { SupabaseUsersService } from '../utils/supabaseUsers';
import { WaCampaignsService } from '../utils/supabaseWaCampaigns';
import { clearSession } from '../utils/session';

beforeEach(() => { db.token = 'signed-token'; });
afterEach(() => {
  db.invokes = []; db.tables = []; db.outboxStatuses = []; db.outboxInserts = [];
  db.outboxUpdates = []; db.campaignUpdates = []; db.queued = [];
  vi.restoreAllMocks();
});

describe('user management', () => {
  it('goes through admin-users with the signed session and never writes app_users', async () => {
    await SupabaseUsersService.createUser({ username: 'ali', pin: '123456' } as never);
    await SupabaseUsersService.updateUser('u1', { is_admin: true } as never);
    await SupabaseUsersService.deleteUser('u1');
    await SupabaseUsersService.isUsernameAvailable('ali');
    await SupabaseUsersService.updateOwnSellerName('Ali B.');

    expect(db.invokes.map(i => [i.fn, i.body.action])).toEqual([
      ['admin-users', 'create_user'], ['admin-users', 'update_user'], ['admin-users', 'delete_user'],
      ['admin-users', 'check_username'], ['admin-users', 'update_own_profile'],
    ]);
    expect(db.invokes.every(i => i.body.session_token === 'signed-token')).toBe(true);
    // The PIN goes to the server in clear text over TLS and is hashed there.
    expect(db.invokes[0].body.pin).toBe('123456');
    expect(db.invokes[1].body.user_id).toBe('u1');
    expect(db.tables).not.toContain('app_users');
  });

  it('refuses to call the server without a session', async () => {
    db.token = null;
    await expect(SupabaseUsersService.deleteUser('u1')).rejects.toThrow(/Session expirée/);
    expect(db.invokes).toHaveLength(0);
  });
});

describe('WhatsApp campaign launch', () => {
  const campaign = { id: 'k1', session_id: 's1', body: 'Bonjour', media_url: null, cta_label: null, cta_url: null, segment_filter: {} };
  const audience = [
    { id: 'a', phone: '212600000001', name: 'A' },
    { id: 'b', phone: '212600000002', name: 'B' },
  ];

  it('never queues a phone that is already queued or sent', async () => {
    vi.spyOn(WaCampaignsService, 'getCampaign').mockResolvedValue({ ...campaign, scheduled_at: null } as never);
    vi.spyOn(WaCampaignsService, 'resolveAudience').mockResolvedValue(audience as never);
    db.queued = [{ to_phone: '212600000001' }];

    const r = await WaCampaignsService.launch('k1', 'me');
    expect(db.outboxStatuses[0]).toEqual(['pending', 'sending', 'sent']);
    expect(r).toEqual({ enqueued: 1, skipped: 1 });
    expect(db.outboxInserts.map(o => o.to_phone)).toEqual(['212600000002']);
    expect(db.campaignUpdates.at(-1)?.status).toBe('running');
  });

  it('"launch now" on a scheduled campaign brings its queue forward and runs it', async () => {
    const later = new Date(Date.now() + 86_400_000).toISOString();
    vi.spyOn(WaCampaignsService, 'getCampaign').mockResolvedValue({ ...campaign, scheduled_at: later } as never);
    vi.spyOn(WaCampaignsService, 'resolveAudience').mockResolvedValue(audience as never);

    await WaCampaignsService.launch('k1', 'me', { now: true });
    const now = db.outboxUpdates[0]?.scheduled_at as string;
    expect(new Date(now).getTime()).toBeLessThan(new Date(later).getTime());
    expect(db.outboxInserts.every(o => o.scheduled_at === now)).toBe(true);
    expect(db.campaignUpdates.at(-1)).toMatchObject({ status: 'running', scheduled_at: now });
  });

  it('a scheduled launch stays scheduled', async () => {
    const later = new Date(Date.now() + 86_400_000).toISOString();
    vi.spyOn(WaCampaignsService, 'getCampaign').mockResolvedValue({ ...campaign, scheduled_at: later } as never);
    vi.spyOn(WaCampaignsService, 'resolveAudience').mockResolvedValue(audience as never);

    await WaCampaignsService.launch('k1', 'me');
    expect(db.outboxUpdates).toHaveLength(0);
    expect(db.outboxInserts.every(o => o.scheduled_at === later)).toBe(true);
    expect(db.campaignUpdates.at(-1)?.status).toBe('scheduled');
  });
});

describe('sign-out', () => {
  it('forgets the cached identity and rights so the next person starts clean', () => {
    localStorage.setItem('inventory_current_user', JSON.stringify({ id: 'u1', is_superadmin: true }));
    localStorage.setItem('inventory_user_permissions', JSON.stringify({ can_create_quote: true }));
    clearSession();
    expect(localStorage.getItem('inventory_current_user')).toBeNull();
    expect(localStorage.getItem('inventory_user_permissions')).toBeNull();
  });
});
