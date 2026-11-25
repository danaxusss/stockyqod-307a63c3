import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// Customer payments (2026): a date on every payment, VAT withheld at source
// by the client (CGI art. 117-IV), stamp duty on cash (art. 252-I-B), the
// cash limit (art. 193), and invoice numbers taken at finalisation (art. 145-III).
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, ctx: { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false } }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => state.ctx }));
vi.mock('../utils/session', () => ({ getToken: () => null }));

import { SupabaseDocumentsService as Docs, ALREADY_FINALISED_MESSAGE } from '../utils/supabaseDocuments';
import { CompanySettingsService } from '../utils/companySettings';
import { invalidateCompaniesCache } from '../utils/supabaseCompanies';
import { buildPaymentEntries, buildStampDutyEntries, invoicePaymentLines, stampDutySourceId } from '../accounting/postingRules';
import { PCM_SEED } from '../accounting/pcmSeed';
import { PdfExportService } from '../utils/pdfExport';
import {
  addMonths, cashLimitWarning, cashStampDuty, defaultWithholding, invoicePayment, invoiceSettlements, isCashMethod, isProvisionalNumber,
  localDay, paymentEntryError, taxAttestationStatus, withholdingBase, CASH_STAMP_DUTY_RATE, TAX_ATTESTATION_VALIDITY_MONTHS,
} from '../utils/documentLines';
import { stampDutyCsvRows, stampDutyStatement, withholdingCsvRows, withholdingStatement } from '../utils/customerTaxStatements';
import type { PaymentEntry, Quote } from '../types';

const today = localDay();
const ym = `${today.slice(2, 4)}${today.slice(5, 7)}`;

const invoiceOf = (extra: Partial<Quote> = {}): Quote => ({
  id: 'inv1', quoteNumber: 'CM2611-4', createdAt: new Date('2026-11-02T10:00:00'), updatedAt: new Date('2026-11-02T10:00:00'),
  status: 'final', document_type: 'invoice', quote_date: '2026-11-02', totalAmount: 1200, tva_rate: 20,
  customer: { fullName: 'Hôtel Atlas', phoneNumber: '0661', address: '', city: '', salesPerson: '', ice: '001234567000089' },
  items: [], avance_amount: 0, payment_methods_json: [], ...extra,
} as Quote);

const line = (id: string) => ({ id, quantity: 1, unitPrice: 1200, subtotal: 1200, addedAt: '2026-11-01T00:00:00Z', quoteName: id });
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, quote_number: id.toUpperCase(), document_type: 'invoice', status: 'final', company_id: 'c1', issuing_company_id: 'c1',
  created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z', quote_date: null,
  customer_info: { fullName: 'Ali', phoneNumber: '0600000001', address: '', city: '', salesPerson: '' },
  items: [line('a')], total_amount: 1200, paid_amount: 0, avance_amount: 0, payment_methods_json: [], source_bl_ids: [], tva_rate: 20, ...extra,
});
const quotes = () => state.db.tables.quotes;
const stored = (id: string) => quotes().find(q => q.id === id)!;

let counter = 0;
beforeEach(() => {
  invalidateCompaniesCache();
  counter = 0;
  state.ctx = { companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false };
  state.db = createFakeDb({
    quotes: [],
    companies: [{ id: 'c1', name: 'Cuisimat', doc_prefix: 'CM', tva_rate: 20, payment_terms_days: 60 }],
  });
  state.db.rpc.next_document_number = () => ++counter;
});

describe('every payment has its own date', () => {
  it('reads old entries without a date at the invoice payment date, else the invoice date', () => {
    const old = invoiceOf({ payment_date: '2026-11-10', avance_amount: 200, payment_method: 'Chèque', payment_methods_json: [{ method: 'Virement bancaire', amount: 300 }] });
    expect(invoiceSettlements(old).map(s => [s.key, s.date, s.dated, s.amount])).toEqual([['avance', '2026-11-10', true, 200], ['#0', '2026-11-10', false, 300]]);
    const noPaymentDate = invoiceOf({ payment_methods_json: [{ method: 'Chèque', amount: 300 }] });
    expect(invoiceSettlements(noPaymentDate)[0].date).toBe('2026-11-02');
  });

  it('books each payment on its own date', () => {
    const inv = invoiceOf({
      payment_method: 'Virement bancaire', payment_date: '2026-11-03', avance_amount: 200,
      payment_methods_json: [
        { id: 'p1', method: 'Chèque', amount: 300, date: '2026-11-15' },
        { method: 'Virement bancaire', amount: 100 }, // old entry: invoice payment date
        { id: 'p3', method: 'Espèces', amount: 600, date: '2026-12-01' },
      ],
    });
    const entries = buildPaymentEntries(inv, 0, 0);
    expect(entries.map(e => [e.date, e.journalType, e.lines[0].account_code, e.lines[0].debit, e.sourceId])).toEqual([
      ['2026-11-03', 'banque', '5141', 200, 'inv1:pay'],
      ['2026-11-15', 'banque', '5141', 300, 'inv1:pay:1'],
      ['2026-11-03', 'banque', '5141', 100, 'inv1:pay:2'],
      ['2026-12-01', 'caisse', '5161', 600, 'inv1:pay:3'],
    ]);
    // A second run books only what is not booked yet, still at its own date.
    expect(buildPaymentEntries(inv, 600, 3).map(e => [e.date, e.lines[0].debit])).toEqual([['2026-12-01', 600]]);
  });

  it('refuses a payment dated before the invoice unless it is confirmed as an advance', () => {
    const early: PaymentEntry = { method: 'Chèque', amount: 100, date: '2026-10-30' };
    expect(paymentEntryError(early, '2026-11-02')).toMatch(/précède la facture.*Avance/);
    expect(paymentEntryError({ ...early, advance: true }, '2026-11-02')).toBeNull();
    expect(paymentEntryError({ method: 'Chèque', amount: 100 }, '2026-11-02')).toBeNull();
    expect(paymentEntryError({ ...early, date: '2026-11-02' }, '2026-11-02')).toBeNull();
    expect(paymentEntryError({ kind: 'vat_withholding', method: 'x', amount: 10, date: '2026-10-30', advance: true }, '2026-11-02')).toMatch(/retenue/);
  });
});

describe('VAT withheld at source by the client (art. 117-IV)', () => {
  const withheld = (amount = 200, extra: Partial<PaymentEntry> = {}): PaymentEntry =>
    ({ id: 'w1', kind: 'vat_withholding', method: 'TVA retenue à la source', amount, date: '2026-11-20', withholding_rate: 100, ...extra });

  it('settles the invoice with a bank payment of the HT amount plus the withholding', () => {
    const inv = invoiceOf({ payment_methods_json: [{ id: 'b1', method: 'Virement bancaire', amount: 1000, date: '2026-11-20' }, withheld()] });
    expect(invoicePayment(inv)).toMatchObject({ paid: 1200, reste: 0, status: 'paid', received: 1000, withheld: 200, cash: 0, stampDuty: 0 });
  });

  it('is not money received: excluded from cash and bank totals', () => {
    const inv = invoiceOf({ payment_methods_json: [{ method: 'Espèces', amount: 500, date: '2026-11-20' }, withheld()] });
    const p = invoicePayment(inv);
    expect(p.received).toBe(500);
    expect(p.cash).toBe(500);
    expect(p.paid).toBe(700);
    expect(p.reste).toBe(500);
  });

  it('is booked D 34581 / C 3421 in the OD journal, at its date', () => {
    const inv = invoiceOf({ payment_methods_json: [{ id: 'b1', method: 'Virement bancaire', amount: 1000, date: '2026-11-18' }, withheld()] });
    const [bank, vat] = buildPaymentEntries(inv, 0, 0);
    expect(bank.lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['5141', 1000, 0], ['3421', 0, 1000]]);
    expect(vat).toMatchObject({ journalType: 'od', date: '2026-11-20', sourceType: 'payment', sourceId: 'inv1:pay:1' });
    expect(vat.lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['34581', 200, 0], ['3421', 0, 200]]);
    expect(PCM_SEED.find(a => a.code === '34581')).toMatchObject({ class: 3, type: 'bilan_actif' });
  });

  it('defaults to the VAT not yet withheld, 75 % for services, never more than what is left', () => {
    expect(defaultWithholding(invoiceOf(), 20)).toBe(200);
    expect(defaultWithholding(invoiceOf(), 20, 75)).toBe(150);
    expect(defaultWithholding(invoiceOf({ payment_methods_json: [withheld(50)] }), 20)).toBe(150);
    expect(defaultWithholding(invoiceOf({ payment_methods_json: [{ method: 'Chèque', amount: 1100 }] }), 20)).toBe(100);
    expect(defaultWithholding(invoiceOf({ tva_rate: 0 }), 20)).toBe(0);
    expect(withholdingBase(200, 20)).toBe(1000);
    expect(withholdingBase(150, 20, 75)).toBe(1000);
  });

  it('is listed for a period with client, ICE, invoice, date, base and VAT, and exported to CSV', () => {
    const invoices = [
      invoiceOf({ payment_methods_json: [withheld()] }),
      invoiceOf({ id: 'inv2', quoteNumber: 'CM2611-9', payment_methods_json: [withheld(150, { date: '2026-12-02', withholding_rate: 75 })] }),
      invoiceOf({ id: 'inv3', quoteNumber: 'CM2611-10', payment_methods_json: [{ method: 'Chèque', amount: 1200, date: '2026-11-21' }] }),
    ];
    const rows = withholdingStatement(invoices, '2026-11-01', '2026-11-30', 20);
    expect(rows).toEqual([{ date: '2026-11-20', client: 'Hôtel Atlas', ice: '001234567000089', invoice: 'CM2611-4', invoiceDate: '2026-11-02', tvaRate: 20, share: 100, base: 1000, withheld: 200, reference: '' }]);
    expect(withholdingStatement(invoices, '2026-11-01', '2026-12-31', 20).map(r => r.base)).toEqual([1000, 1000]);
    const csv = withholdingCsvRows(rows);
    expect(csv[0]).toMatchObject({ 'Client': 'Hôtel Atlas', 'ICE client': '001234567000089', 'N° facture': 'CM2611-4', 'Base HT': 1000, 'TVA retenue': 200 });
    expect(csv[1]).toMatchObject({ 'Date de la retenue': 'TOTAL', 'TVA retenue': 200 });
  });

  it('shows apart in the client balance', async () => {
    quotes().push(row('f1', { payment_methods_json: [{ method: 'Virement bancaire', amount: 1000, date: '2026-11-20' }, withheld()] }));
    state.db.tables.clients = [];
    const [client] = await Docs.getClientFinancialSummary();
    expect(client).toMatchObject({ totalAmount: 1200, paidAmount: 1200, withheldAmount: 200, remaining: 0 });
  });
});

describe('stamp duty on cash payments (art. 252-I-B)', () => {
  it('is 0.25 % of the cash amount, rounded to the centime', () => {
    expect(CASH_STAMP_DUTY_RATE).toBe(0.25);
    expect(cashStampDuty(1000)).toBe(2.5);
    expect(cashStampDuty(333)).toBe(0.83);
    expect(isCashMethod('Espèces') && !isCashMethod('Versement') && !isCashMethod('Carte bancaire')).toBe(true);
  });

  it('when on, is collected on top: it neither settles the invoice nor counts as received', () => {
    const inv = invoiceOf({ payment_methods_json: [{ id: 'c1', method: 'Espèces', amount: 1200, date: '2026-11-05', stamp_duty: 3 }] });
    expect(invoicePayment(inv)).toMatchObject({ paid: 1200, received: 1200, stampDuty: 3, reste: 0 });
    expect(invoiceOf().totalAmount).toBe(1200);
  });

  it('is booked D 5161 / C 44578 apart from the payment, once', () => {
    const inv = invoiceOf({ payment_methods_json: [{ id: 'c1', method: 'Espèces', amount: 1200, date: '2026-11-05', stamp_duty: 3 }] });
    const [pay] = buildPaymentEntries(inv, 0, 0);
    expect(pay.lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['5161', 1200, 0], ['3421', 0, 1200]]);
    const [duty] = buildStampDutyEntries(inv, new Set());
    expect(duty).toMatchObject({ journalType: 'caisse', date: '2026-11-05', sourceType: 'stamp_duty', sourceId: 'inv1:timbre:c1' });
    expect(duty.lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['5161', 3, 0], ['44578', 0, 3]]);
    expect(duty.lines.some(l => l.account_code.startsWith('7'))).toBe(false);
    expect(buildStampDutyEntries(inv, new Set([stampDutySourceId('inv1', 'c1')]))).toEqual([]);
    expect(PCM_SEED.find(a => a.code === '44578')).toMatchObject({ class: 4, type: 'bilan_passif' });
  });

  it('when off (no duty recorded), nothing is collected or booked; a stray duty on a cheque is ignored', () => {
    const off = invoiceOf({ payment_methods_json: [{ id: 'c1', method: 'Espèces', amount: 1200, date: '2026-11-05' }] });
    expect(invoicePayment(off).stampDuty).toBe(0);
    expect(buildStampDutyEntries(off, new Set())).toEqual([]);
    const cheque = invoiceOf({ payment_methods_json: [{ id: 'x', method: 'Chèque', amount: 1200, stamp_duty: 3 }] });
    expect(invoicePaymentLines(cheque)[0].stampDuty).toBe(0);
  });

  it('is listed by month for the declaration, with a CSV', () => {
    const invoices = [
      invoiceOf({ payment_methods_json: [{ id: 'a', method: 'Espèces', amount: 1000, date: '2026-11-05', stamp_duty: 2.5 }, { id: 'b', method: 'Espèces', amount: 200, date: '2026-12-01', stamp_duty: 0.5 }] }),
    ];
    const rows = stampDutyStatement(invoices, '2026-11');
    expect(rows).toEqual([{ date: '2026-11-05', client: 'Hôtel Atlas', invoice: 'CM2611-4', cash: 1000, duty: 2.5, reference: '' }]);
    expect(stampDutyCsvRows(rows)[1]).toMatchObject({ 'Date': 'TOTAL', 'Droit de timbre 0,25 %': 2.5 });
  });
});

describe('cash limit (art. 193)', () => {
  it('warns, with the 6 % fine, once a sale of 20,000 DH or more is partly settled in cash', () => {
    expect(cashLimitWarning(25000, 5000)).toMatchObject({ fine: 1500 });
    expect(cashLimitWarning(25000, 5000)!.message).toMatch(/6 %.*1\s500,00 DH.*art\. 193/);
    expect(cashLimitWarning(20000, 20000)).toMatchObject({ fine: 1200 });
    expect(cashLimitWarning(19999.99, 19999.99)).toBeNull();
    expect(cashLimitWarning(30000, 0)).toBeNull();
  });

  it('counts the cash of every payment of the invoice', () => {
    const inv = invoiceOf({ totalAmount: 24000, payment_method: 'Espèces', avance_amount: 4000, payment_methods_json: [{ method: 'Espèces', amount: 16000 }, { method: 'Chèque', amount: 4000 }] });
    expect(invoicePayment(inv).cash).toBe(20000);
    expect(cashLimitWarning(inv.totalAmount, invoicePayment(inv).cash)?.fine).toBe(1440);
  });
});

describe('attestation de régularité fiscale', () => {
  it('lasts 6 months (one constant), warns 30 days before, and is missing when not entered', () => {
    expect(TAX_ATTESTATION_VALIDITY_MONTHS).toBe(6);
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(taxAttestationStatus('', '2026-11-25')).toMatchObject({ state: 'missing' });
    expect(taxAttestationStatus('', '2026-11-25').message).toMatch(/vos clients assujettis doivent retenir la TVA/);
    expect(taxAttestationStatus('2026-05-25', '2026-11-25')).toMatchObject({ state: 'expired' });
    expect(taxAttestationStatus('2026-05-26', '2026-11-25')).toMatchObject({ state: 'expiring', validUntil: '2026-11-25', daysLeft: 0 });
    expect(taxAttestationStatus('2026-06-20', '2026-11-25')).toMatchObject({ state: 'expiring', daysLeft: 24 });
    expect(taxAttestationStatus('2026-09-01', '2026-11-25')).toMatchObject({ state: 'valid', validUntil: '2027-02-28' });
  });
});

describe('invoice numbers at finalisation', () => {
  it('a new draft has a provisional reference and takes no number', async () => {
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    expect(isProvisionalNumber(draft.quoteNumber)).toBe(true);
    expect(counter).toBe(0);
    const copy = await Docs.duplicateDocument(draft.id);
    expect(isProvisionalNumber(copy.quoteNumber)).toBe(true);
    expect(counter).toBe(0);
  });

  it('numbers drafts in the order they are finalised, by the month of their date', async () => {
    const first = await Docs.createEmptyDocument('invoice', 'c1');
    const second = await Docs.createEmptyDocument('invoice', 'c1');
    for (const id of [first.id, second.id]) Object.assign(stored(id), { customer_info: { fullName: 'Ali' }, items: [line('a')], total_amount: 1200 });
    const b = await Docs.updateDocument(second.id, { status: 'final' });
    expect(b).toMatchObject({ quoteNumber: `CM${ym}-1`, status: 'final' });
    const a = await Docs.finalizeInvoice(first.id);
    expect(a.quoteNumber).toBe(`CM${ym}-2`);
    // Dated in October: the October series.
    const oct = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(oct.id), { customer_info: { fullName: 'Ali' }, items: [line('a')], quote_date: '2026-10-15' });
    expect((await Docs.finalizeInvoice(oct.id)).quoteNumber).toBe('CM2610-3');
  });

  it('refuses to finalise an empty draft, and to type a number on a provisional one', async () => {
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    await expect(Docs.finalizeInvoice(draft.id)).rejects.toThrow(/client/);
    await expect(Docs.updateDocument(draft.id, { status: 'final' })).rejects.toThrow(/client/);
    await expect(Docs.updateDocument(draft.id, { quoteNumber: 'CM2611-50' })).rejects.toThrow(/attribué automatiquement/);
    expect(counter).toBe(0);
  });

  it('lets drafts be deleted without a gap, and they do not block deleting the last invoice', async () => {
    quotes().push(row('f1', { quote_number: 'CM2611-1', created_at: '2026-11-01T10:00:00.000Z' }));
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    expect(Docs.deletionNotice({ ...draft })).toMatch(/aucun trou/);
    expect(Docs.deletionNotice({ status: 'final', quoteNumber: 'CM2611-1', document_type: 'invoice' })).toMatch(/ne sera pas réutilisé/);
    await Docs.deleteDocument('f1');
    await Docs.deleteDocument(draft.id);
    expect(quotes()).toEqual([]);
    expect(counter).toBe(0);
  });

  it('leaves drafts that already hold a number untouched', async () => {
    quotes().push(row('d1', { quote_number: 'CM2611-7', status: 'draft', quote_date: '2026-11-05' }));
    await Docs.updateDocument('d1', { notes: 'x', quote_date: '2026-11-20' });
    expect(stored('d1').quote_number).toBe('CM2611-7');
    const done = await Docs.finalizeInvoice('d1');
    expect(done).toMatchObject({ quoteNumber: 'CM2611-7', status: 'final' });
    expect(counter).toBe(0);
    // and they still hold their place in the series
    quotes().push(row('f0', { quote_number: 'CM2611-6', created_at: '2026-11-01T10:00:00.000Z' }));
    await expect(Docs.deleteDocument('f0')).rejects.toThrow(/dernière facture/);
  });

  it('skips a number already used in the series', async () => {
    quotes().push(row('typed', { quote_number: `CM${ym}-1` }));
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(draft.id), { customer_info: { fullName: 'Ali' }, items: [line('a')] });
    expect((await Docs.finalizeInvoice(draft.id)).quoteNumber).toBe(`CM${ym}-2`);
  });

  it('does not give one draft two numbers when two people finalise it at once (no database function yet)', async () => {
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(draft.id), { customer_info: { fullName: 'Ali' }, items: [line('a')] });
    // Someone else finalises it between our read and our write.
    state.db.rpc.next_document_number = () => {
      const n = ++counter;
      if (n === 1) Object.assign(stored(draft.id), { quote_number: `CM${ym}-99`, status: 'final' });
      return n;
    };
    await expect(Docs.finalizeInvoice(draft.id)).rejects.toThrow(ALREADY_FINALISED_MESSAGE);
    expect(stored(draft.id).quote_number).toBe(`CM${ym}-99`);
  });

  it('uses the database function when it exists, and reports its refusals', async () => {
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(draft.id), { customer_info: { fullName: 'Ali' }, items: [line('a')] });
    const calls: string[] = [];
    state.db.rpc.stocky_finalize_invoice = ({ p_invoice_id }: { p_invoice_id: string }) => {
      calls.push(p_invoice_id);
      Object.assign(stored(p_invoice_id), { quote_number: 'CM2611-42', status: 'final' });
      return 'CM2611-42';
    };
    expect((await Docs.finalizeInvoice(draft.id)).quoteNumber).toBe('CM2611-42');
    expect(calls).toEqual([draft.id]);
    expect(counter).toBe(0);

    const other = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(other.id), { customer_info: { fullName: 'Ali' }, items: [line('a')] });
    state.db.rpc.stocky_finalize_invoice = () => { throw new Error('permission denied for table quotes'); };
    await expect(Docs.finalizeInvoice(other.id)).rejects.toThrow(/permission denied/);
    expect(stored(other.id).status).toBe('draft');
  });

  it('issues an invoice from a proforma in one step; a failed numbering leaves no invoice and frees the lines', async () => {
    quotes().push(row('p1', { document_type: 'proforma', status: 'draft', items: [line('a'), line('b')], total_amount: 2400 }));
    const inv = await Docs.createInvoiceFromProforma('p1', ['a'], 'c1');
    expect(inv).toMatchObject({ quoteNumber: `CM${ym}-1`, status: 'final' });
    state.db.rpc.next_document_number = () => { throw new Error('counter down'); };
    await expect(Docs.createInvoiceFromProforma('p1', ['b'], 'c1')).rejects.toThrow(/counter down/);
    expect(quotes().filter(q => q.document_type === 'invoice').map(q => q.id)).toEqual([inv.id]);
    expect(stored('p1').items.find((i: { id: string }) => i.id === 'b').is_billed).toBe(false);
  });

  it('from a proforma without a client, gives a draft to complete (no number taken)', async () => {
    quotes().push(row('p2', { document_type: 'proforma', status: 'draft', customer_info: { fullName: '' } }));
    const inv = await Docs.createInvoiceFromProforma('p2', ['a'], 'c1');
    expect(inv.status).toBe('draft');
    expect(isProvisionalNumber(inv.quoteNumber)).toBe(true);
    expect(counter).toBe(0);
  });
});

describe('before the migration is run', () => {
  it('saves the other settings when the new columns are missing, and reads them as unavailable', async () => {
    state.db.failWrite = (table, _op, payload) => {
      const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
      for (const col of ['tax_attestation_date', 'cash_stamp_duty']) {
        if (rows.some(r => r && col in r)) return `Could not find the '${col}' column of '${table}' in the schema cache`;
      }
    };
    await CompanySettingsService.updateCompanySettings('c1', { company_name: 'B', payment_terms_days: 30, tax_attestation_date: '2026-11-01', cash_stamp_duty: true });
    expect(state.db.tables.companies[0]).toMatchObject({ name: 'B', payment_terms_days: 30 });
    expect(state.db.tables.companies[0]).not.toHaveProperty('cash_stamp_duty');
    invalidateCompaniesCache();
    const s = await CompanySettingsService.getSettings('c1');
    expect(s).toMatchObject({ cash_stamp_duty: false, tax_attestation_date: '', payment_settings_available: false });
  });

  it('saves and reads them once it is run', async () => {
    Object.assign(state.db.tables.companies[0], { cash_stamp_duty: false, tax_attestation_date: null });
    await CompanySettingsService.updateCompanySettings('c1', { tax_attestation_date: '2026-11-01', cash_stamp_duty: true });
    invalidateCompaniesCache();
    expect(await CompanySettingsService.getSettings('c1')).toMatchObject({ cash_stamp_duty: true, tax_attestation_date: '2026-11-01', payment_settings_available: true });
  });

  it('finalises from the browser when the database function is missing', async () => {
    const draft = await Docs.createEmptyDocument('invoice', 'c1');
    Object.assign(stored(draft.id), { customer_info: { fullName: 'Ali' }, items: [line('a')] });
    expect(state.db.rpc.stocky_finalize_invoice).toBeUndefined();
    expect((await Docs.finalizeInvoice(draft.id)).quoteNumber).toBe(`CM${ym}-1`);
  });
});

// PDF text, decoded as in invoicePdfMentions.test.ts.
function pdfText(output: string): string {
  const pieces: string[] = [];
  for (const m of output.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    pieces.push(m[1].replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\(.)/g, '$1'));
  }
  return pieces.join(' ').replace(/\s+/g, ' ');
}
const pdfOf = async (q: Quote) => pdfText((await PdfExportService.buildQuotePdf(q, null, undefined, undefined, false, 'invoice', undefined, true)).doc.output());

describe('invoice PDF', () => {
  const items = [{ id: 'a', quantity: 1, unitPrice: 1200, subtotal: 1200, quoteName: 'Four', quoteBrand: 'Rational', quoteBarcode: 'R-1', addedAt: new Date(), product: null as never, priceType: 'normal' as const, marginPercentage: 0, finalPrice: 1200 }];

  it('lists each settlement with its date, the withholding apart, and the stamp duty outside the total', async () => {
    const text = await pdfOf(invoiceOf({
      items, payment_methods_json: [
        { id: 'b', method: 'Virement bancaire', amount: 800, date: '2026-11-18', reference: 'VIR-1' },
        { id: 'w', kind: 'vat_withholding', method: 'TVA retenue à la source', amount: 200, date: '2026-11-20' },
        { id: 'c', method: 'Espèces', amount: 200, date: '2026-11-21', stamp_duty: 0.5 },
      ],
    }));
    expect(text).toContain('Règlements :');
    expect(text).toContain('18/11/2026 · Virement bancaire · VIR-1 : 800,00 Dh');
    expect(text).toMatch(/20\/11\/2026 · TVA retenue à la source par le client.*non encaissée : 200,00 Dh/);
    expect(text).toContain('21/11/2026 · Espèces : 200,00 Dh + droit de timbre 0,25 % : 0,50 Dh (perçu en sus)');
    expect(text).toContain('ENCAISSÉ');
    expect(text).toContain('TVA RETENUE PAR LE CLIENT');
    expect(text).toContain('TOTAL TTC');
    expect(text).toContain('1 200,00 Dh');
  });

  it('client statement: settlements at their dates, withholding apart, drafts without a number', async () => {
    const text = pdfText((await PdfExportService.buildClientFinancialPdf('Hôtel Atlas', [
      invoiceOf({ payment_methods_json: [
        { id: 'b', method: 'Chèque', amount: 1000, date: '2026-11-18', reference: 'CHQ-7' },
        { id: 'w', kind: 'vat_withholding', method: 'TVA retenue à la source', amount: 200, date: '2026-11-20' },
      ] }),
      invoiceOf({ id: 'd', status: 'draft', quoteNumber: 'BROUILLON-ABC123' }),
    ], 20, null)).output());
    expect(text).toContain('Réglé');
    expect(text).toMatch(/18\/11\/2026 CM2611-4 Chèque CHQ-7 1 000,00/);
    expect(text).toMatch(/20\/11\/2026 CM2611-4 TVA retenue par le client 200,00/);
    expect(text).toMatch(/Encaissé 1 000,00/);
    expect(text).toContain('Brouillon');
    expect(text).not.toContain('BROUILLON-ABC123');
  });

  it('a draft says BROUILLON and never shows a series number', async () => {
    const text = await pdfOf(invoiceOf({ items, status: 'draft', quoteNumber: 'BROUILLON-3F9A2C' }));
    expect(text).toContain('BROUILLON');
    expect(text).toContain('3F9A2C');
    expect(text).not.toContain('N° de piece');
    expect(text).not.toMatch(/Arrêté la présente facture/);
    const { filename } = await PdfExportService.buildQuotePdf(invoiceOf({ items, status: 'draft', quoteNumber: 'BROUILLON-3F9A2C' }), null, undefined, undefined, false, 'invoice');
    expect(filename).toMatch(/^Brouillon_facture_/);
  });
});
