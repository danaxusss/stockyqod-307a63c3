import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// Sales bug sweep: reads that the server cuts at 1,000 rows (here 3), the
// quote history shown to salespeople, and the client search filter.
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, ctx: { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false } }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => state.ctx }));
vi.mock('../utils/session', () => ({ getToken: () => null }));

import { SupabaseUsersService } from '../utils/supabaseUsers';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { SupabaseClientsService, clientSearchFilter } from '../utils/supabaseClients';
import { readAll, type Pageable } from '../utils/readAll';
import type { Quote } from '../types';

const product = (barcode: string, brand: string, levels: Record<string, number>) => ({ barcode, name: barcode, brand, provider: 'P', stock_levels: levels });
const quote = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id, quote_number: id, document_type: 'quote', status: 'draft', company_id: 'c1', created_by: 'ali', created_at, updated_at: created_at,
  customer_info: { fullName: 'Client ' + id, phoneNumber: '', address: '', city: '', salesPerson: 'Ali' }, items: [], total_amount: 0, ...extra,
});

beforeEach(() => {
  state.ctx = { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false };
  state.db = createFakeDb({
    products: [
      product('A1', 'ATOSA', { DEPOT: 1 }), product('A2', 'BONNA', { DEPOT: 2 }), product('A3', 'CAPIC', { CUISISHOP: 1 }),
      product('A4', 'DESCO', { MAZRAA: 3 }), product('A5', 'EAGLE', { RESTOQUIP: 1 }),
    ],
    quotes: [
      quote('q1', '2026-11-01T10:00:00Z'), quote('q2', '2026-11-02T10:00:00Z', { created_by: 'sara' }), quote('q3', '2026-11-03T10:00:00Z'),
      quote('q4', '2026-11-04T10:00:00Z'), quote('q5', '2026-11-05T10:00:00Z', { created_by: 'sara' }),
      quote('f1', '2026-11-06T10:00:00Z', { document_type: 'invoice' }), quote('x1', '2026-11-07T10:00:00Z', { company_id: 'c2' }),
    ],
    clients: ['k1', 'k2', 'k3', 'k4'].map((id, i) => ({ id, full_name: id, phone_number: '', company_id: 'c1', created_at: `2026-11-0${i + 1}T00:00:00Z` })),
  });
  state.db.maxRows = 3;
});

describe('reads past the server row cap', () => {
  it('lists every brand and stock location for user permissions, not only those of the first 1,000 products', async () => {
    expect(await SupabaseUsersService.getAvailableBrands()).toEqual(['ATOSA', 'BONNA', 'CAPIC', 'DESCO', 'EAGLE']);
    expect(await SupabaseUsersService.getAvailableStockLocations()).toEqual(['CUISISHOP', 'DEPOT', 'MAZRAA', 'RESTOQUIP']);
  });

  it('loads the whole quote history, newest first, quotes only, own company only', async () => {
    const quotes = await SupabaseQuotesService.getAllQuotes();
    expect(quotes.map(q => q.id)).toEqual(['q5', 'q4', 'q3', 'q2', 'q1']);
  });

  it('loads every client', async () => {
    expect((await SupabaseClientsService.getAllClients()).map(c => c.id)).toEqual(['k4', 'k3', 'k2', 'k1']);
  });

  it('readAll pages in a stable order and stops on a short page', async () => {
    state.db.tables.products.push(product('A6', 'FAGOR', {}));
    const { supabase } = await import('../utils/supabaseClient');
    const rows = await readAll<{ barcode: string }>(() => (supabase.from('products').select('barcode') as unknown as Pageable<{ barcode: string }>), 'barcode');
    expect(rows.map(r => r.barcode)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  });
});

describe('quote history for salespeople', () => {
  it('can be limited to the quotes a salesperson created', async () => {
    const quotes = await SupabaseQuotesService.getAllQuotes(undefined, { createdBy: 'sara' });
    expect(quotes.map(q => q.id)).toEqual(['q5', 'q2']);
  });
});

describe('client search', () => {
  it('keeps commas, parentheses and wildcards in a name from breaking the search filter', () => {
    const filter = clientSearchFilter('Dar Zitoun (Fès), 100%');
    // Three conditions only: the typed text adds no separator or group.
    expect(filter.split(',')).toHaveLength(3);
    expect(filter).not.toMatch(/[()]/);
    expect(filter).toContain('full_name.ilike.%Dar Zitoun  Fès   100\\%%');
  });
});

describe('saving a quote', () => {
  const base = { quoteNumber: 'QT-1', createdAt: new Date('2026-11-01T10:00:00Z'), updatedAt: new Date('2026-11-02T10:00:00Z'), status: 'draft' as const,
    customer: { fullName: 'Client', phoneNumber: '', address: '', city: '', salesPerson: 'Ali' }, items: [], totalAmount: 0 };

  beforeEach(() => { state.db.strictUpsert = true; });

  it('keeps who created it when someone else edits it', async () => {
    localStorage.setItem('inventory_current_user', JSON.stringify({ username: 'boss' }));
    await SupabaseQuotesService.saveQuote({ ...base, id: 'q1', createdBy: 'ali' } as Quote);
    expect(state.db.tables.quotes.find(q => q.id === 'q1')?.created_by).toBe('ali');
  });

  it('records the signed-in user on a new quote', async () => {
    localStorage.setItem('inventory_current_user', JSON.stringify({ username: 'sara' }));
    await SupabaseQuotesService.saveQuote({ ...base, id: 'new1' } as Quote);
    expect(state.db.tables.quotes.find(q => q.id === 'new1')?.created_by).toBe('sara');
  });
});
