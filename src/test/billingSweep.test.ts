import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// Billing bug sweep: document lists cut at the server's row cap (here 3),
// the client statement picking other clients' invoices, purchase-order
// copies numbered as quotes, invoice lines removed but left billed on the
// proforma, and invoices deleted out from under their credit notes.
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, ctx: { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false } }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => state.ctx }));
vi.mock('../utils/session', () => ({ getToken: () => null }));

import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { SupabaseReturnsService } from '../utils/supabaseReturns';
import { readAllConfig } from '../utils/readAll';
import type { QuoteItem } from '../types';

const line = (id: string, extra: Partial<QuoteItem> = {}) => ({
  id, quantity: 1, unitPrice: 120, subtotal: 120, addedAt: '2026-11-01T00:00:00Z', quoteName: id, ...extra,
});
const doc = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, quote_number: id.toUpperCase(), document_type: type, status: 'final', company_id: 'c1', issuing_company_id: 'c1',
  created_at: `2026-11-0${(Number(id.replace(/\D/g, '')) % 9) + 1}T10:00:00Z`, updated_at: '2026-11-01T10:00:00Z',
  customer_info: { fullName: 'Ali', phoneNumber: '', address: '', city: '', salesPerson: '' },
  items: [], total_amount: 120, paid_amount: 0, avance_amount: 0, payment_methods_json: [], source_bl_ids: [], ...extra,
});

beforeEach(() => {
  state.ctx = { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false };
  state.db = createFakeDb({ quotes: [], companies: [{ id: 'c1', doc_prefix: 'CM' }] });
  let counter = 0;
  state.db.rpc.next_document_number = () => ++counter;
});
afterEach(() => { readAllConfig.pageSize = 1000; });

describe('document lists past the server row cap', () => {
  beforeEach(() => {
    state.db.tables.quotes = Array.from({ length: 7 }, (_, i) => doc(`f${i + 1}`, 'invoice'));
    state.db.maxRows = 3;
    readAllConfig.pageSize = 3;
  });

  it('lists every invoice of the directory, newest first', async () => {
    const all = await SupabaseDocumentsService.getAllByType('invoice');
    expect(all).toHaveLength(7);
    const dates = all.map(d => d.createdAt.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('offers every invoice for booking in the accounts', async () => {
    expect(await SupabaseDocumentsService.getForLedger('invoice', 'c1')).toHaveLength(7);
  });

  it('lists every return', async () => {
    state.db.tables.returns = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, company_id: 'c1', reference_number: `R${i}`, client_name: 'Ali', reason: '', items: [], status: 'open', created_at: `2026-11-0${i + 1}T00:00:00Z`, updated_at: '' }));
    expect(await SupabaseReturnsService.getAll()).toHaveLength(7);
  });

  it('puts every invoice of a client on their statement', async () => {
    expect(await SupabaseDocumentsService.getInvoicesForClient('', 'Ali')).toHaveLength(7);
  });
});

describe('client statement', () => {
  it('lists only the invoices of that client, as the balance does', async () => {
    state.db.tables.quotes = [
      doc('f1', 'invoice', { customer_info: { fullName: 'Ali', phoneNumber: '' } }),
      doc('f2', 'invoice', { customer_info: { fullName: 'Ali Benali', phoneNumber: '' } }),
      doc('f3', 'invoice', { customer_info: { fullName: 'Café Alibaba', phoneNumber: '' } }),
      doc('f4', 'invoice', { customer_info: { fullName: 'Hôtel Atlas', phoneNumber: '0661234510' } }),
      doc('f5', 'invoice', { customer_info: { fullName: 'Hôtel Atlas Annexe', phoneNumber: '06612345100' } }),
    ];
    expect((await SupabaseDocumentsService.getInvoicesForClient('', 'Ali')).map(d => d.id)).toEqual(['f1']);
    expect((await SupabaseDocumentsService.getInvoicesForClient('0661234510', 'Hôtel Atlas')).map(d => d.id)).toEqual(['f4']);
  });
});

describe('duplicating a purchase order', () => {
  it('numbers the copy in the purchase-order series, not as a quote', async () => {
    state.db.tables.quotes = [doc('bc1', 'bon_commande', { quote_number: 'BC-0001' })];
    const copy = await SupabaseDocumentsService.duplicateDocument('bc1');
    expect(copy.document_type).toBe('bon_commande');
    expect(copy.quoteNumber).toMatch(/^BC-\d{4}$/);
  });
});

describe('editing an invoice made from a proforma', () => {
  it('puts a line removed from the invoice back to invoice on the proforma', async () => {
    const billed = (id: string) => line(id, { is_billed: true, billed_by_company_id: 'c1', billed_invoice_id: 'f1' });
    state.db.tables.quotes = [
      doc('p1', 'proforma', { items: [billed('a'), billed('b'), line('c')], total_amount: 360, paid_amount: 240, status: 'pending' }),
      doc('f1', 'invoice', { parent_document_id: 'p1', items: [billed('a'), billed('b')], total_amount: 240 }),
    ];
    await SupabaseDocumentsService.updateDocument('f1', { items: [billed('a')] as unknown as QuoteItem[] });
    const proforma = state.db.tables.quotes.find(d => d.id === 'p1')!;
    const items = proforma.items as QuoteItem[];
    expect(items.find(i => i.id === 'a')?.is_billed).toBe(true);
    expect(items.find(i => i.id === 'b')?.is_billed).toBe(false);
    expect(proforma.paid_amount).toBe(120);
  });
});

describe('deleting an invoice', () => {
  it('is refused while credit notes point to it', async () => {
    state.db.tables.quotes = [
      doc('f1', 'invoice'),
      doc('a1', 'avoir', { parent_document_id: 'f1', quote_number: 'AV-0001' }),
    ];
    await expect(SupabaseDocumentsService.deleteDocument('f1')).rejects.toThrow(/AV-0001/);
    expect(state.db.tables.quotes.map(d => d.id)).toEqual(['f1', 'a1']);
  });
});
