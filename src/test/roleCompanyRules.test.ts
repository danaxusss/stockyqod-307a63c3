import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// Secure login step 3: purchase prices come apart from the products (the
// database withholds them from resellers), and the company setting "users see
// only the documents they created".
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, client: null as null | Record<string, unknown> }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return state.client ?? fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return state.client ?? fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false }),
}));

import {
  costRows, hydrateItemCosts, isMissingDbObject, itemsMissingCosts, loadProductCosts, saveProductCosts,
  withItemCosts, withProductCosts, costsSavedSeparately,
} from '../utils/productCosts';
import { seesOnlyOwnDocuments, DOCUMENT_SUPERVISOR_ROLES } from '../lib/documentVisibility';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import type { QuoteItem } from '../types';

const item = (barcode: string, buyprice?: number): QuoteItem => ({
  id: barcode, product: { barcode, name: barcode, ...(buyprice === undefined ? {} : { buyprice }) } as QuoteItem['product'],
  priceType: 'normal', marginPercentage: 20, finalPrice: 0, addedAt: new Date(0), unitPrice: 10, quantity: 1, subtotal: 10,
});

beforeEach(() => {
  state.db = createFakeDb({});
  state.client = null;
});

describe('purchase prices merged into products', () => {
  it('fills each product from the cost map, 0 when hidden or unknown', () => {
    const costs = new Map([['A', 12.5]]);
    expect(withProductCosts([{ barcode: 'A', buyprice: 99 }, { barcode: 'B' }], costs)).toEqual([
      { barcode: 'A', buyprice: 12.5 }, { barcode: 'B', buyprice: 0 },
    ]);
  });

  it('document lines: keeps a stored cost, fills a missing one, never leaves undefined', () => {
    const costs = new Map([['A', 40], ['B', 30]]);
    const out = withItemCosts([item('A'), item('B', 25), item('CUSTOM')], costs);
    expect(out.map(i => i.product.buyprice)).toEqual([40, 25, 0]);
    expect(itemsMissingCosts([item('A'), item('B', 0), item('A')])).toEqual(['A']);
  });

  it('one cost row per barcode, the last one wins', () => {
    expect(costRows([{ barcode: 'A', buyprice: 1 }, { barcode: 'B', buyprice: null }, { barcode: 'A', buyprice: 3 }]))
      .toEqual([{ barcode: 'A', buyprice: 3 }, { barcode: 'B', buyprice: 0 }]);
  });

  it('recognises a database without the migration', () => {
    expect(isMissingDbObject({ code: 'PGRST205', message: "Could not find the table 'public.product_costs'" })).toBe(true);
    expect(isMissingDbObject({ code: 'PGRST202', message: 'Could not find the function public.stocky_set_product_costs' })).toBe(true);
    expect(isMissingDbObject({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingDbObject(null)).toBe(false);
  });
});

describe('reading purchase prices', () => {
  it('reads the product_costs view (empty for a reseller: no error, no prices)', async () => {
    state.db.tables.product_costs = [{ barcode: 'A', buyprice: '7.5' }];
    expect([...(await loadProductCosts())]).toEqual([['A', 7.5]]);
    state.db.tables.product_costs = [];
    expect((await loadProductCosts(['A'])).size).toBe(0);
  });

  it('falls back to products.buyprice before the migration', async () => {
    const asked: string[] = [];
    const fake = fakeClient(createFakeDb({ products: [{ barcode: 'A', buyprice: 9 }, { barcode: 'B', buyprice: 4 }] }));
    state.client = {
      ...fake,
      from: (table: string) => {
        asked.push(table);
        if (table === 'product_costs') {
          const missing = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.product_costs'" } };
          const q: Record<string, unknown> = {};
          Object.assign(q, { select: () => q, in: () => Promise.resolve(missing), order: () => q, range: () => Promise.resolve(missing) });
          return q;
        }
        return fake.from(table);
      },
    };
    expect([...(await loadProductCosts(['B']))]).toEqual([['B', 4]]);
    expect(asked).toEqual(['product_costs', 'products']);
  });

  it('a failed read never breaks the catalogue: no prices instead', async () => {
    const failing: Record<string, unknown> = {};
    Object.assign(failing, { select: () => failing, in: () => Promise.resolve({ data: null, error: { code: '500', message: 'boom' } }) });
    state.client = { from: () => failing };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await loadProductCosts(['A'])).size).toBe(0);
    warn.mockRestore();
  });

  it('opening a document puts the catalogue purchase price back on its lines', async () => {
    state.db.tables.product_costs = [{ barcode: 'A', buyprice: 60 }];
    state.db.tables.quotes = [{
      id: 'q1', quote_number: 'Q1', company_id: 'c1', created_at: '2026-01-01', updated_at: '2026-01-01', status: 'draft',
      customer_info: { salesPerson: 'ali' }, items: [item('A'), item('CUSTOM', 8)], total_amount: 10, created_by: 'ali',
    }];
    const quote = await SupabaseQuotesService.getQuote('q1');
    expect(quote?.items.map(i => i.product.buyprice)).toEqual([60, 8]);
  });

  it('no request when every line already has its cost', async () => {
    const from = vi.fn();
    state.client = { from };
    const items = [item('A', 1)];
    expect(await hydrateItemCosts(items)).toBe(items);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('saving purchase prices', () => {
  it('sends them in batches to stocky_set_product_costs', async () => {
    const calls: unknown[][] = [];
    state.db.rpc.stocky_set_product_costs = ({ p_costs }: { p_costs: unknown[] }) => { calls.push(p_costs); return p_costs.length; };
    const many = Array.from({ length: 1200 }, (_, i) => ({ barcode: `P${i}`, buyprice: i }));
    await saveProductCosts(many);
    expect(calls.map(c => c.length)).toEqual([500, 500, 200]);
    expect(await costsSavedSeparately()).toBe(true);
  });

  it('a reseller account is skipped quietly; other errors are reported', async () => {
    let error = { code: '42501', message: 'Les prix d\'achat ne sont pas accessibles pour ce compte' };
    state.client = { rpc: async () => ({ data: null, error }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(saveProductCosts([{ barcode: 'A', buyprice: 1 }])).resolves.toBeUndefined();
    warn.mockRestore();
    error = { code: '23505', message: 'boom' };
    await expect(saveProductCosts([{ barcode: 'A', buyprice: 1 }])).rejects.toThrow(/boom/);
  });

  it('before the migration the upsert keeps carrying them', async () => {
    state.client = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.stocky_set_product_costs(p_costs)' } }) };
    expect(await costsSavedSeparately()).toBe(false);
  });
});

describe('"users see only the documents they created"', () => {
  it('applies to salespeople when the company turned it on', () => {
    expect(seesOnlyOwnDocuments({ role: 'senior_sales' }, true)).toBe(true);
    expect(seesOnlyOwnDocuments({ role: 'junior_sales' }, true)).toBe(true);
    expect(seesOnlyOwnDocuments({ role: null }, true)).toBe(true);
    expect(seesOnlyOwnDocuments({ role: 'senior_sales' }, false)).toBe(false);
  });

  it('never to the roles that supervise, bill or keep the books', () => {
    for (const role of DOCUMENT_SUPERVISOR_ROLES) expect(seesOnlyOwnDocuments({ role }, true)).toBe(false);
    expect([...DOCUMENT_SUPERVISOR_ROLES]).toEqual(['super_admin', 'admin', 'manager', 'facturation', 'compta']);
  });

  it('resellers always see only their own (admins are never resellers)', () => {
    expect(seesOnlyOwnDocuments({ role: 'senior_sales', isReseller: true }, false)).toBe(true);
    expect(seesOnlyOwnDocuments({ role: 'manager', isReseller: true }, false)).toBe(true);
    expect(seesOnlyOwnDocuments({ role: 'admin', isReseller: true }, false)).toBe(false);
  });
});
