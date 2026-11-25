import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// Billing compliance batch: VAT rate frozen on each document, due dates
// (loi 69-21), booked invoices fixed, continuous numbering, buyer ICE.
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, ctx: { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false } }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => state.ctx }));
vi.mock('../utils/session', () => ({ getToken: () => null }));

import { SupabaseDocumentsService as Docs, POSTED_INVOICE_MESSAGE, parseInvoiceNumber } from '../utils/supabaseDocuments';
import { SupabaseClientsService } from '../utils/supabaseClients';
import { CompanySettingsService } from '../utils/companySettings';
import { invalidateCompaniesCache } from '../utils/supabaseCompanies';
import { buildInvoiceEntry, buildAvoirEntry } from '../accounting/postingRules';
import {
  addDays, documentTvaRate, dueDateError, invoiceDueDay, invoiceOverdue, isLegalTvaRate, localDay, paymentDaysError, toHT,
} from '../utils/documentLines';
import { iceError, isValidIce, missingCompanyIds, normalizeIce } from '../utils/legalIds';

const today = localDay();
const ym = `${today.slice(2, 4)}${today.slice(5, 7)}`;

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  id, quantity: 1, unitPrice: 1200, subtotal: 1200, addedAt: '2026-11-01T00:00:00Z', quoteName: id, ...extra,
});
const doc = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, quote_number: id.toUpperCase(), document_type: type, status: 'final', company_id: 'c1', issuing_company_id: 'c1',
  created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z', quote_date: null,
  customer_info: { fullName: 'Ali', phoneNumber: '0600000001', address: '', city: 'Fès', salesPerson: '' },
  items: [line('a')], total_amount: 1200, paid_amount: 0, avance_amount: 0, payment_methods_json: [], source_bl_ids: [], ...extra,
});
const quotes = () => state.db.tables.quotes;
const row = (id: string) => quotes().find(q => q.id === id)!;

/** A database from before the migration: writes naming a new column fail like PostgREST. */
const withoutNewColumns = (db: FakeDb) => {
  db.failWrite = (table, _op, payload) => {
    const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
    for (const col of ['tva_rate', 'due_date', 'is_individual', 'payment_terms_days', 'vat_exemption_text']) {
      if (rows.some(r => r && col in r)) return `Could not find the '${col}' column of '${table}' in the schema cache`;
    }
  };
};

let counter = 0;
beforeEach(() => {
  invalidateCompaniesCache();
  counter = 0;
  state.ctx = { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false };
  state.db = createFakeDb({
    quotes: [],
    companies: [
      { id: 'c1', doc_prefix: 'CM', tva_rate: 20, payment_terms_days: 60 },
      { id: 'c2', doc_prefix: 'XY', tva_rate: 20, payment_terms_days: 30 },
    ],
  });
  state.db.rpc.next_document_number = () => ++counter;
});

describe('VAT rate of a document', () => {
  it('is the stored rate, else the company rate, else 20 %', () => {
    expect(documentTvaRate({ tva_rate: 10 }, 20)).toBe(10);
    expect(documentTvaRate({ tva_rate: 0 }, 20)).toBe(0);
    expect(documentTvaRate({ tva_rate: '14' }, 20)).toBe(14);
    expect(documentTvaRate({}, 10)).toBe(10);
    expect(documentTvaRate({ tva_rate: null }, null)).toBe(20);
    expect(documentTvaRate(undefined, undefined)).toBe(20);
    expect([20, 10, 0].every(isLegalTvaRate)).toBe(true);
    expect(isLegalTvaRate(14) || isLegalTvaRate(7)).toBe(false);
  });

  it('is stored at creation and survives a change of the company rate (screen, PDF input, books)', async () => {
    const created = await Docs.createEmptyDocument('invoice', 'c1');
    expect(row(created.id).tva_rate).toBe(20);

    // The company moves to 10 %: the invoice keeps 20 %.
    state.db.tables.companies[0].tva_rate = 10;
    Object.assign(row(created.id), { items: [line('a')], total_amount: 1200, status: 'final' });
    const inv = (await Docs.getById(created.id))!;
    expect(inv.tva_rate).toBe(20);
    const rate = documentTvaRate(inv, 10);
    expect(toHT(inv.totalAmount, rate)).toBeCloseTo(1000, 2);

    const entry = buildInvoiceEntry(inv, 10);
    expect(entry.lines.find(l => l.account_code === '7111')?.credit).toBe(1000);
    expect(entry.lines.find(l => l.account_code === '4455')).toMatchObject({ credit: 200, vat_rate: 20 });
    const avoir = buildAvoirEntry({ ...inv, document_type: 'avoir' }, 10);
    expect(avoir.lines.find(l => l.account_code === '7111')?.debit).toBe(1000);

    // An invoice from before rates were stored uses the company rate.
    const legacy = buildInvoiceEntry({ ...inv, tva_rate: undefined }, 10);
    expect(legacy.lines.find(l => l.account_code === '4455')).toMatchObject({ credit: 109.09, vat_rate: 10 });
  });

  it('is copied from the source document: quote → BL, proforma → invoice → credit note, duplicates', async () => {
    quotes().push(doc('q1', 'quote', { status: 'draft', tva_rate: 10 }));
    const bl = await Docs.createBLFromQuote('q1');
    expect(bl.tva_rate).toBe(10);

    quotes().push(doc('p1', 'proforma', { status: 'draft', tva_rate: 10, items: [line('a'), line('b')], total_amount: 2400 }));
    // Issued by c2 (20 % today): the invoice keeps the proforma's 10 %.
    const inv = await Docs.createInvoiceFromProforma('p1', ['a'], 'c2');
    expect(inv.tva_rate).toBe(10);
    const av = await Docs.createAvoirFromInvoice(inv.id, 'retour');
    expect(av.tva_rate).toBe(10);
    const copy = await Docs.duplicateDocument(inv.id);
    expect(copy.tva_rate).toBe(10);

    // A document without a stored rate takes its company's current one.
    quotes().push(doc('q2', 'quote', { status: 'draft', company_id: 'c2', issuing_company_id: null }));
    state.db.tables.companies[1].tva_rate = 0;
    expect((await Docs.createBLFromQuote('q2')).tva_rate).toBe(0);
  });

  it('refuses to merge delivery notes taxed at different rates', async () => {
    quotes().push(doc('b1', 'bl', { status: 'draft', tva_rate: 20 }), doc('b2', 'bl', { status: 'draft', tva_rate: 10 }));
    await expect(Docs.createProformaFromBLs(['b1', 'b2'], 'c1')).rejects.toThrow(/taux de TVA différents/);
    expect(row('b1').status).toBe('draft');
  });
});

describe('before the migration is run', () => {
  beforeEach(() => withoutNewColumns(state.db));

  it('still creates, reads and edits invoices, without the new columns', async () => {
    const created = await Docs.createEmptyDocument('invoice', 'c1');
    expect(row(created.id)).not.toHaveProperty('tva_rate');
    expect(row(created.id)).not.toHaveProperty('due_date');
    const inv = (await Docs.getById(created.id))!;
    expect(inv.tva_rate).toBeUndefined();
    expect(documentTvaRate(inv, 20)).toBe(20);
    expect(invoiceDueDay(inv)).toBe(addDays(today, 60));

    const saved = await Docs.updateDocument(created.id, { customer: { ...inv.customer, fullName: 'Ali' }, due_date: addDays(today, 30), notes: 'ok' });
    expect(saved.notes).toBe('ok');
    expect(row(created.id)).not.toHaveProperty('due_date');

    quotes().push(doc('p1', 'proforma', { status: 'draft' }));
    expect((await Docs.createInvoiceFromProforma('p1', ['a'], 'c1')).quoteNumber).toMatch(/^CM\d{4}-\d+$/);
    expect(await Docs.isPosted(created.id)).toBe(false);
  });

  it('still saves clients and company settings', async () => {
    state.db.rpc.next_client_code = () => 'A0001';
    const client = await SupabaseClientsService.createClient({ full_name: 'Ali', phone_number: '0600', is_individual: true });
    expect(client.full_name).toBe('Ali');
    expect(state.db.tables.clients[0]).not.toHaveProperty('is_individual');
    await CompanySettingsService.updateCompanySettings('c1', { company_name: 'A', payment_terms_days: 30, vat_exemption_text: 'Art. 92' });
    expect(state.db.tables.companies[0]).toMatchObject({ name: 'A' });
    expect(state.db.tables.companies[0].payment_terms_days).toBe(60);
  });

  it('does not hide an unrelated error behind the retry', async () => {
    state.db.failWrite = () => 'permission denied for table quotes';
    await expect(Docs.createEmptyDocument('invoice', 'c1')).rejects.toThrow(/permission denied/);
  });
});

describe('due date and payment terms', () => {
  it('defaults to the invoice date plus the company delay', async () => {
    const empty = await Docs.createEmptyDocument('invoice', 'c1');
    expect(empty.due_date).toBe(addDays(today, 60));
    quotes().push(doc('p1', 'proforma', { status: 'draft' }));
    const inv = await Docs.createInvoiceFromProforma('p1', ['a'], 'c2');
    expect(inv.due_date).toBe(addDays(today, 30));
    expect((await Docs.duplicateDocument(inv.id)).due_date).toBe(addDays(today, 30));
    // Without a stored due date: the legal 60 days.
    expect(invoiceDueDay({ quote_date: '2026-11-05', createdAt: new Date() })).toBe('2027-01-04');
  });

  it('stays between the invoice date and 120 days after it', async () => {
    expect(paymentDaysError(60)).toBeNull();
    expect(paymentDaysError(0)).toBeNull();
    expect(paymentDaysError(120)).toBeNull();
    expect(paymentDaysError(121)).toMatch(/120 jours.*maximum légal/);
    expect(paymentDaysError(-1)).toMatch(/0 à 120/);
    expect(dueDateError('2026-11-05', '2027-03-05')).toBeNull();
    expect(dueDateError('2026-11-05', '2027-03-06')).toMatch(/120 jours.*05\/03\/2027/);
    expect(dueDateError('2026-11-05', '2026-11-04')).toMatch(/précéder/);

    quotes().push(doc('f1', 'invoice', { quote_date: '2026-11-05', due_date: '2027-01-04' }));
    await expect(Docs.updateDocument('f1', { due_date: '2027-03-31' })).rejects.toThrow(/120 jours/);
    await Docs.updateDocument('f1', { due_date: '2026-12-05' });
    expect(row('f1').due_date).toBe('2026-12-05');
  });

  it('follows the invoice date when only the date changes', async () => {
    quotes().push(doc('f1', 'invoice', { quote_date: '2026-11-05', due_date: '2026-12-05' }));
    await Docs.updateDocument('f1', { quote_date: '2026-11-10' });
    expect(row('f1').due_date).toBe('2026-12-10');
  });

  it('makes an unpaid or partly paid invoice past its due date late, by that many days', () => {
    const base = { quote_date: '2026-10-01', createdAt: new Date('2026-10-01'), status: 'final' as const, totalAmount: 1000, avance_amount: 0, payment_methods_json: [], due_date: '2026-11-20' };
    expect(invoiceOverdue(base, '2026-11-25')).toEqual({ overdue: true, days: 5, dueDay: '2026-11-20' });
    expect(invoiceOverdue(base, '2026-11-20').overdue).toBe(false);
    expect(invoiceOverdue({ ...base, payment_methods_json: [{ method: 'Chèque', amount: 400 }] }, '2026-11-25').overdue).toBe(true);
    expect(invoiceOverdue({ ...base, avance_amount: 1000 }, '2026-11-25').overdue).toBe(false);
    expect(invoiceOverdue({ ...base, status: 'draft' }, '2026-11-25').overdue).toBe(false);
    // No stored due date: 60 days after the invoice date (30/11/2026).
    expect(invoiceOverdue({ ...base, due_date: undefined }, '2026-12-02')).toMatchObject({ overdue: true, days: 2, dueDay: '2026-11-30' });
  });
});

describe('the books', () => {
  it('are offered issued invoices only, not drafts', async () => {
    quotes().push(
      doc('f1', 'invoice', { status: 'final' }),
      doc('f2', 'invoice', { status: 'draft' }),
      doc('f3', 'invoice', { status: 'solde' }),
      doc('a1', 'avoir', { status: 'final' }),
    );
    expect((await Docs.getForLedger('invoice', 'c1')).map(d => d.id).sort()).toEqual(['f1', 'f3']);
    expect((await Docs.getForLedger('avoir', 'c1')).map(d => d.id)).toEqual(['a1']);
  });
});

describe('a booked invoice', () => {
  beforeEach(() => {
    quotes().push(doc('f1', 'invoice', { quote_number: `CM${ym}-1`, quote_date: today, due_date: addDays(today, 60) }));
    state.db.tables.journal_entries = [
      { id: 'e1', company_id: 'c1', source_type: 'invoice', source_id: 'f1', status: 'posted' },
      { id: 'e2', company_id: 'c1', source_type: 'payment', source_id: 'f2:pay', status: 'posted' },
    ];
  });

  it('keeps its number, date, customer, lines and totals', async () => {
    const inv = (await Docs.getById('f1'))!;
    await expect(Docs.updateDocument('f1', { items: [line('a', { quantity: 2, subtotal: 2400 })] as never })).rejects.toThrow(POSTED_INVOICE_MESSAGE);
    await expect(Docs.updateDocument('f1', { customer: { ...inv.customer, fullName: 'Autre' } })).rejects.toThrow(/comptabilisée/);
    await expect(Docs.updateDocument('f1', { quote_date: addDays(today, -1) })).rejects.toThrow(/comptabilisée/);
    await expect(Docs.updateDocument('f1', { status: 'draft' })).rejects.toThrow(/comptabilisée/);
    expect(row('f1')).toMatchObject({ total_amount: 1200, status: 'final' });
  });

  it('still takes payments, notes, the lock, the due date and the buyer ICE', async () => {
    const inv = (await Docs.getById('f1'))!;
    await Docs.updateDocument('f1', {
      payment_methods_json: [{ method: 'Chèque', amount: 500 }], paid_amount: 500, notes: 'merci', is_locked: true, due_date: addDays(today, 30),
      // Same values as stored: not a change.
      items: inv.items, quoteNumber: inv.quoteNumber, quote_date: today, status: 'final',
      customer: { ...inv.customer, ice: '001234567000089', address: 'Bd Zerktouni' },
    });
    expect(row('f1')).toMatchObject({ paid_amount: 500, is_locked: true, notes: 'merci', due_date: addDays(today, 30) });
    expect(row('f1').customer_info).toMatchObject({ fullName: 'Ali', ice: '001234567000089', address: 'Bd Zerktouni' });
  });

  it('cannot be deleted', async () => {
    await expect(Docs.deleteDocument('f1')).rejects.toThrow(POSTED_INVOICE_MESSAGE);
    expect(row('f1')).toBeTruthy();
  });

  it('can change again once its entry is reversed; a payment entry does not lock', async () => {
    state.db.tables.journal_entries[0].status = 'reversed';
    quotes().push(doc('f2', 'invoice', { status: 'draft' }));
    await Docs.updateDocument('f1', { notes: 'x', customer: { ...(row('f1').customer_info), fullName: 'Ali B.' } });
    expect(row('f1').customer_info.fullName).toBe('Ali B.');
    await Docs.updateDocument('f2', { quoteNumber: 'CM-X' });
    expect(row('f2').quote_number).toBe('CM-X');
  });

  it('is recognised through the database function across companies', async () => {
    state.db.tables.journal_entries = [];
    state.db.rpc.stocky_document_is_posted = ({ p_document_id }: { p_document_id: string }) => p_document_id === 'f1';
    expect(await Docs.isPosted('f1')).toBe(true);
    await expect(Docs.deleteDocument('f1')).rejects.toThrow(/comptabilisée/);
  });

  it('applies to credit notes too', async () => {
    quotes().push(doc('a1', 'avoir', { parent_document_id: 'f9' }));
    state.db.tables.journal_entries.push({ id: 'e3', company_id: 'c1', source_type: 'invoice', source_id: 'a1', status: 'posted' });
    await expect(Docs.updateDocument('a1', { quote_date: '2026-11-03' })).rejects.toThrow(/avoir est comptabilisé/);
    await expect(Docs.deleteDocument('a1')).rejects.toThrow(/avoir est comptabilisé/);
  });
});

describe('continuous numbering', () => {
  it('only lets the last issued invoice of a company be deleted', async () => {
    quotes().push(
      doc('f1', 'invoice', { quote_number: 'CM2611-1', created_at: '2026-11-01T10:00:00.000Z' }),
      doc('f2', 'invoice', { quote_number: 'CM2611-2', created_at: '2026-11-02T10:00:00.000Z' }),
      // Another issuer's series does not count.
      doc('x1', 'invoice', { quote_number: 'XY2611-1', created_at: '2026-11-03T10:00:00.000Z', issuing_company_id: 'c2' }),
    );
    await expect(Docs.deleteDocument('f1')).rejects.toThrow(/dernière facture.*CM2611-2.*avoir/);
    await Docs.deleteDocument('f2');
    await Docs.deleteDocument('f1');
    expect(quotes().map(q => q.id)).toEqual(['x1']);
  });

  it('counts later drafts (they hold the next numbers) but lets drafts go', async () => {
    quotes().push(
      doc('f1', 'invoice', { quote_number: 'CM2611-1', created_at: '2026-11-01T10:00:00.000Z' }),
      doc('d2', 'invoice', { quote_number: 'CM2611-2', created_at: '2026-11-02T10:00:00.000Z', status: 'draft' }),
    );
    await expect(Docs.deleteDocument('f1')).rejects.toThrow(/dernière facture/);
    quotes().push(doc('d0', 'invoice', { quote_number: 'CM2610-9', created_at: '2026-10-01T10:00:00.000Z', status: 'draft' }));
    await Docs.deleteDocument('d0');
    await Docs.deleteDocument('d2');
    await Docs.deleteDocument('f1');
    expect(quotes()).toEqual([]);
  });

  it('keeps refusing while credit notes point to the invoice', async () => {
    quotes().push(doc('f1', 'invoice'), doc('a1', 'avoir', { parent_document_id: 'f1', quote_number: 'AV-0001' }));
    await expect(Docs.deleteDocument('f1')).rejects.toThrow(/AV-0001/);
  });

  it('fixes the number of an issued invoice, and keeps it out of draft', async () => {
    quotes().push(doc('f1', 'invoice', { quote_number: 'CM2611-1', quote_date: '2026-11-05' }), doc('d1', 'invoice', { quote_number: 'CM2611-2', status: 'draft', quote_date: '2026-11-05' }));
    await expect(Docs.updateDocument('f1', { quoteNumber: 'CM2611-7' })).rejects.toThrow(/finalisée ne peut plus être modifié/);
    await expect(Docs.updateDocument('f1', { status: 'draft' })).rejects.toThrow(/ne revient pas en brouillon/);
    await Docs.updateDocument('d1', { quoteNumber: 'CM2611-22' });
    expect(row('d1').quote_number).toBe('CM2611-22');
  });

  it('takes the month of the number from the invoice date', async () => {
    const seen: string[] = [];
    state.db.rpc.next_document_number = ({ p_doc_type }: { p_doc_type: string }) => { seen.push(p_doc_type); return ++counter; };
    expect(await Docs.nextNumber('c1', 'invoice', '2026-10-31')).toBe('CM2610-1');
    expect(seen).toEqual(['invoice_2610']);

    // A draft moved to another month takes a number of that month.
    quotes().push(doc('d1', 'invoice', { quote_number: 'CM2611-5', status: 'draft', quote_date: '2026-11-05' }));
    const moved = await Docs.updateDocument('d1', { quote_date: '2026-10-28', quoteNumber: 'CM2611-5' });
    expect(moved.quoteNumber).toBe('CM2610-2');
    expect(seen).toEqual(['invoice_2610', 'invoice_2610']);

    // An issued invoice stays in the month of its number.
    quotes().push(doc('f1', 'invoice', { quote_number: 'CM2611-1', quote_date: '2026-11-05' }));
    await expect(Docs.updateDocument('f1', { quote_date: '2026-12-01' })).rejects.toThrow(/rester en 11\/2026/);
    await Docs.updateDocument('f1', { quote_date: '2026-11-20' });
    expect(row('f1').quote_number).toBe('CM2611-1');
    expect(parseInvoiceNumber('FAC2611-12')).toEqual({ prefix: 'FAC', ym: '2611', n: 12 });
    expect(parseInvoiceNumber('Facture 12')).toBeNull();
  });
});

describe('ICE', () => {
  it('is exactly 15 digits, spaces ignored', () => {
    expect(isValidIce('001234567000089')).toBe(true);
    expect(isValidIce('001 234 567 000 089')).toBe(true);
    expect(normalizeIce(' 001 234 567 000 089 ')).toBe('001234567000089');
    expect(isValidIce('00123456700008')).toBe(false);
    expect(isValidIce('0012345670000890')).toBe(false);
    expect(isValidIce('00123456700008A')).toBe(false);
    expect(iceError('')).toBeNull();
    expect(iceError('001234567000089')).toBeNull();
    expect(iceError('1234')).toMatch(/15 chiffres \(4 saisis\)/);
  });

  it('is listed with IF and TP when the company lacks them', () => {
    expect(missingCompanyIds({ ice: '001234567000089', if_number: '', patente: ' ' })).toEqual(['IF', 'TP (patente)']);
    expect(missingCompanyIds({ ice: 'x', if_number: 'y', patente: 'z' })).toEqual([]);
  });

  it('marks a private client on the client record', async () => {
    state.db.rpc.next_client_code = () => 'A0001';
    const client = await SupabaseClientsService.createClient({ full_name: 'Ali', phone_number: '0600', is_individual: true });
    expect(client.is_individual).toBe(true);
    state.db.tables.clients[0].id = 'k1'; // the database gives the id
    await SupabaseClientsService.updateClient('k1', { is_individual: false, ice: '001234567000089' });
    expect(state.db.tables.clients[0]).toMatchObject({ is_individual: false, ice: '001234567000089' });
  });
});
