import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, companyId: 'c1' as string | null }));

vi.mock('../utils/supabaseClient', () => ({
  get supabase() { return fakeClient(state.db); },
}));
vi.mock('../integrations/supabase/client', () => ({
  get supabase() { return fakeClient(state.db); },
}));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: state.companyId, bypassFilter: false, isSuperAdmin: false }),
}));

import { SupabaseDocumentsService as Docs } from '../utils/supabaseDocuments';
import { CompanySettingsService } from '../utils/companySettings';
import { lineSubtotal, mergeLines, matchesPaymentFilter, documentDay, sameCustomer } from '../utils/documentLines';
import type { QuoteItem } from '../types';

const line = (id: string, unitPrice: number, quantity: number, extra: Partial<QuoteItem> = {}): QuoteItem => {
  const item = { id, unitPrice, quantity, quoteBarcode: id.split(':')[0], quoteName: id, priceType: 'normal', marginPercentage: 0, finalPrice: unitPrice, addedAt: new Date(), product: null as never, ...extra } as QuoteItem;
  return { ...item, subtotal: lineSubtotal(item) };
};

const doc = (id: string, type: string, items: QuoteItem[], extra: Record<string, unknown> = {}) => ({
  id, quote_number: id.toUpperCase(), document_type: type, status: 'draft', items,
  total_amount: items.reduce((s, i) => s + i.subtotal, 0), customer_info: { fullName: 'Client A', phoneNumber: '0600000001' },
  company_id: 'c1', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', source_bl_ids: [], paid_amount: 0,
  ...extra,
});

let counter = 0;
beforeEach(() => {
  counter = 0;
  state.companyId = 'c1';
  state.db = createFakeDb({ quotes: [], companies: [{ id: 'c1', doc_prefix: 'CM' }, { id: 'c2', doc_prefix: 'XY' }] });
  state.db.rpc.next_document_number = () => ++counter;
});
const quotes = () => state.db.tables.quotes;
const byId = (id: string) => quotes().find(q => q.id === id)!;

describe('document lines', () => {
  it('keeps the line discount when a quantity changes or lines merge', () => {
    expect(lineSubtotal({ unitPrice: 100, quantity: 3, discount: 10 })).toBe(270);
    const merged = mergeLines([line('X:1', 100, 10), line('X:2', 90, 5), line('X:3', 100, 2)]);
    expect(merged.map(i => [i.unitPrice, i.quantity, i.subtotal])).toEqual([[100, 12, 1200], [90, 5, 450]]);
  });

  it('matches payment filters, customers and document dates loosely where they should', () => {
    expect(matchesPaymentFilter({ payment_method: 'Virement bancaire' }, 'Virement')).toBe(true);
    expect(matchesPaymentFilter({ payment_method: '', payment_methods_json: [{ method: 'Carte bancaire', amount: 5 }] }, 'Carte')).toBe(true);
    expect(matchesPaymentFilter({ payment_method: 'Chèque' }, 'Espèces')).toBe(false);
    expect(sameCustomer({ fullName: 'A', phoneNumber: '+212 600-000001' } as never, { fullName: 'B', phoneNumber: '0600000001' } as never)).toBe(true);
    expect(sameCustomer({ fullName: 'Ali' } as never, { fullName: 'ali ' } as never)).toBe(true);
    expect(documentDay({ quote_date: '2026-09-30', createdAt: new Date('2026-10-02') })).toBe('2026-09-30');
  });
});

describe('BL → proforma', () => {
  it('refuses to merge BLs of different customers', async () => {
    quotes().push(doc('bl1', 'bl', [line('X:1', 100, 1)]), doc('bl2', 'bl', [line('Y:1', 50, 1)], { customer_info: { fullName: 'Client B', phoneNumber: '0611111111' } }));
    await expect(Docs.createProformaFromBLs(['bl1', 'bl2'], 'c1')).rejects.toThrow(/clients différents/);
    expect(byId('bl1').status).toBe('draft');
  });

  it('keeps discounts, takes each BL once and frees the BLs when the proforma goes away', async () => {
    quotes().push(
      doc('bl1', 'bl', [line('X:1', 100, 10, { discount: 10 })], { created_at: '2026-10-01T09:00:00.000Z' }),
      doc('bl2', 'bl', [line('X:2', 100, 5, { discount: 10 })]),
    );
    const pro = await Docs.createProformaFromBLs(['bl2', 'bl1'], 'c1');
    expect(pro.totalAmount).toBe(1350);
    expect(pro.items).toHaveLength(1);
    expect(byId('bl1').status).toBe('final');
    await expect(Docs.createProformaFromBLs(['bl1'], 'c1')).rejects.toThrow(/Déjà transformé/);
    expect(await Docs.findProformaForBL('bl1')).toEqual({ id: pro.id, quoteNumber: pro.quoteNumber });

    await Docs.deleteDocument(pro.id);
    expect(byId('bl1').status).toBe('draft');
    expect(byId('bl2').status).toBe('draft');
  });

  it('releases the BLs when the proforma cannot be created', async () => {
    quotes().push(doc('bl1', 'bl', [line('X:1', 100, 1)]));
    state.db.failWrite = (table, op, payload) => (op === 'insert' && (payload as { document_type?: string }).document_type === 'proforma' ? 'boom' : undefined);
    await expect(Docs.createProformaFromBLs(['bl1'], 'c1')).rejects.toThrow(/boom/);
    expect(byId('bl1').status).toBe('draft');
  });
});

describe('proforma → invoice', () => {
  beforeEach(() => {
    quotes().push(doc('pro', 'proforma', [line('A:1', 100, 2, { discount: 10 }), line('B:1', 50, 1)]));
  });

  it('bills the lines once, with their discount', async () => {
    const inv = await Docs.createInvoiceFromProforma('pro', ['A:1'], 'c2');
    expect(inv.totalAmount).toBe(180);
    expect(inv.quoteNumber).toMatch(/^XY\d{4}-1$/);
    const pro = byId('pro');
    expect(pro.items[0]).toMatchObject({ is_billed: true, billed_invoice_id: inv.id });
    expect(pro.paid_amount).toBe(180);
    expect(pro.status).toBe('pending');
    await expect(Docs.createInvoiceFromProforma('pro', ['A:1'], 'c2')).rejects.toThrow(/Déjà facturé/);
  });

  it('refuses when the proforma changed since it was read', async () => {
    let first = true;
    // Another tab saves the proforma right after this one read it.
    state.db.failWrite = (table, op) => {
      if (table === 'quotes' && op === 'update' && first) { first = false; byId('pro').updated_at = '2026-10-01T11:00:00.000Z'; }
    };
    await expect(Docs.createInvoiceFromProforma('pro', ['A:1'], 'c1')).rejects.toThrow(/modifié entre-temps/);
    expect(quotes().filter(q => q.document_type === 'invoice')).toHaveLength(0);
    expect(byId('pro').items[0].is_billed).toBeFalsy();
  });

  it('un-bills the lines when the invoice is deleted, and keeps billed lines on a stale save', async () => {
    const inv = await Docs.createInvoiceFromProforma('pro', ['A:1'], 'c1');
    // An edit started before the invoice: its copy of the lines is unbilled.
    const staleDraft = [line('A:1', 100, 2, { discount: 10 }), line('B:1', 50, 3)];
    const kept = await Docs.keepBilledLines('pro', staleDraft);
    expect(kept[0].is_billed).toBe(true);
    expect(kept[1].quantity).toBe(3);

    await Docs.deleteDocument(inv.id);
    expect(byId('pro').items[0].is_billed).toBe(false);
    expect(byId('pro').paid_amount).toBe(0);
    // A tab opened while the line was billed does not bill it again.
    const reopened = await Docs.keepBilledLines('pro', [{ ...kept[0] }, kept[1]]);
    expect(reopened[0].is_billed).toBe(false);
  });
});

describe('avoirs', () => {
  beforeEach(() => {
    quotes().push(doc('inv', 'invoice', [line('A:1', 100, 4), line('B:1', 50, 1)], { status: 'final', issuing_company_id: 'c2', company_id: 'c1' }));
  });

  it('credits at most what was invoiced, line by line', async () => {
    const first = await Docs.createAvoirFromInvoice('inv', 'retour', { 'A:1': 1 });
    expect(first.totalAmount).toBe(100);
    expect(first.items).toHaveLength(1);
    const rest = await Docs.createAvoirFromInvoice('inv', 'solde');
    expect(rest.totalAmount).toBe(350);
    expect(rest.items.find(i => i.id === 'A:1')?.quantity).toBe(3);
    await expect(Docs.createAvoirFromInvoice('inv', 'encore')).rejects.toThrow(/entièrement couverte/);
  });

  it('is numbered in the issuing company series', async () => {
    const seen: unknown[] = [];
    state.db.rpc.next_document_number = (args: unknown) => { seen.push(args); return 7; };
    const av = await Docs.createAvoirFromInvoice('inv', '');
    expect(av.quoteNumber).toBe('AV-0007');
    expect(seen[0]).toMatchObject({ p_company_id: 'c2', p_doc_type: 'avoir' });
  });
});

describe('client balances', () => {
  it('uses money received on invoices, minus credit notes', async () => {
    state.db.tables.clients = [{ id: 'k1', full_name: 'Client A', phone_number: '0600000001', client_code: 'C1', company_id: 'c1' }];
    quotes().push(
      doc('pro', 'proforma', [line('A:1', 1000, 1)], { paid_amount: 1000 }),
      doc('inv', 'invoice', [line('A:1', 1000, 1)], { avance_amount: 200, payment_methods_json: [{ method: 'Chèque', amount: 300 }] }),
      doc('inv2', 'invoice', [line('B:1', 400, 1)]),
      doc('av', 'avoir', [line('B:1', 400, 1)]),
    );
    const [row] = await Docs.getClientFinancialSummary();
    expect(row).toMatchObject({ clientId: 'k1', totalAmount: 1000, paidAmount: 500, remaining: 500, invoiceCount: 2, proformaCount: 1 });
  });
});

describe('quote → BL', () => {
  it('delivers a quote once', async () => {
    quotes().push(doc('q1', 'quote', [line('A:1', 10, 1)]));
    await Docs.createBLFromQuote('q1');
    await expect(Docs.createBLFromQuote('q1')).rejects.toThrow(/déjà un BL/);
  });
});

describe('special PIN', () => {
  it("never accepts another company's PIN", async () => {
    vi.spyOn(CompanySettingsService, 'getSettings').mockImplementation(async (id?: string) =>
      (id === 'c2' ? { special_pin: '9999' } : { special_pin: '' }) as never);
    expect(await CompanySettingsService.resolveSpecialPin('c1')).toBeNull();
    expect(await CompanySettingsService.resolveSpecialPin('c2')).toBe('9999');
    state.companyId = 'c2';
    expect(await CompanySettingsService.resolveSpecialPin(null)).toBe('9999');
  });
});
