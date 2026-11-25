import { describe, expect, it } from 'vitest';
import type { SupplierInvoice, SupplierInvoiceLine, SupplierPayment } from '../accounting/supplierInvoices';
import { bookingState, buildSupplierInvoiceEntry, buildSupplierPaymentEntry, invoiceSourceId, isSupplierSourceId, paymentSourceId } from '../accounting/supplierPosting';
import { cashLimits, cashWarning, remittanceMonth, splitPayment, suggestVatWithholding, withholdingStatement } from '../accounting/supplierWithholding';
import { PCM_SEED } from '../accounting/pcmSeed';

const inv = (p: Partial<SupplierInvoice> = {}): SupplierInvoice => ({
  id: 'i1', company_id: 'c1', supplier_id: 's1', number: 'FF-2026-0001', supplier_invoice_number: 'FA-77', invoice_date: '2026-03-10',
  reception_date: null, delivery_date: null, due_date: '2026-05-09', due_kind: 'legal', nature: 'marchandises', is_works: false, description: null,
  status: 'validated', total_ht: 0, total_vat: 0, total_ttc: 0, total_nondeductible_vat: 0, paid_amount: 0, ir_rate: null, ir_amount: 0,
  litigation_amount: null, litigation_date: null, judgment_amount: null, judgment_date: null, cash_over_limit: false,
  source_po_id: null, source_receipt_id: null, notes: null, created_by: null, ...p,
});
const ln = (p: Partial<SupplierInvoiceLine>): SupplierInvoiceLine => ({ position: 0, label: 'x', barcode: 'P1', quantity: 1, amount_ht: 0, vat_rate: 20, vat_amount: 0, account_code: '6111', vat_nondeductible: false, ...p });
const pay = (p: Partial<SupplierPayment>): SupplierPayment => ({
  id: 'p1', company_id: 'c1', invoice_id: 'i1', supplier_id: 's1', payment_date: '2026-04-15', amount: 0, mode: 'virement', reference: null, bank: null,
  vat_withholding_rate: 0, vat_withheld: 0, ir_withheld: 0, cash_vat_nondeductible: 0, cash_expense_nondeductible: 0, notes: null, created_by: null, ...p,
});
const supplier = { name: 'Inox Maroc', first_name: null, legal_type: 'societe' as const };
const sums = (lines: { debit: number; credit: number }[]) => ({
  debit: Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100,
  credit: Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100,
});
const byAccount = (lines: { account_code: string; debit: number; credit: number }[]) =>
  Object.fromEntries(lines.map(l => [l.account_code, l.debit ? l.debit : -l.credit]));

describe('supplier invoice entry (journal AC)', () => {
  it('one rate: D 6111 HT, D 34552 VAT, C 4411 TTC, at the invoice date', () => {
    const e = buildSupplierInvoiceEntry(inv(), [ln({ amount_ht: 1000, vat_amount: 200 })], supplier);
    expect(e).toMatchObject({ journalType: 'achat', date: '2026-03-10', reference: 'FA-77', sourceType: 'invoice', sourceId: 'sinv:i1' });
    expect(byAccount(e.lines)).toEqual({ '6111': 1000, '34552': 200, '4411': -1200 });
    expect(sums(e.lines)).toEqual({ debit: 1200, credit: 1200 });
    expect(e.lines.find(l => l.account_code === '34552')?.vat_rate).toBe(20);
  });

  it('two rates: one VAT line per rate', () => {
    const e = buildSupplierInvoiceEntry(inv(), [
      ln({ amount_ht: 1000, vat_rate: 20, vat_amount: 200 }),
      ln({ amount_ht: 500, vat_rate: 10, vat_amount: 50, account_code: '6111', barcode: 'P2' }),
      ln({ amount_ht: 100, vat_rate: 10, vat_amount: 10, account_code: '6141', barcode: null, quantity: null }),
    ], supplier);
    const vat = e.lines.filter(l => l.account_code === '34552').map(l => [l.vat_rate, l.debit]);
    expect(vat).toEqual([[10, 60], [20, 200]]);
    expect(byAccount(e.lines)).toMatchObject({ '6111': 1500, '6141': 100, '4411': -1860 });
    expect(sums(e.lines)).toEqual({ debit: 1860, credit: 1860 });
  });

  it('non-deductible VAT joins the cost of its line', () => {
    const e = buildSupplierInvoiceEntry(inv({ nature: 'services' }), [
      ln({ account_code: '6142', barcode: null, amount_ht: 1000, vat_amount: 200, vat_nondeductible: true }),
      ln({ account_code: '6133', barcode: null, amount_ht: 500, vat_amount: 100 }),
    ], supplier);
    expect(byAccount(e.lines)).toEqual({ '6142': 1200, '6133': 500, '34552': 100, '4411': -1800 });
    expect(sums(e.lines)).toEqual({ debit: 1800, credit: 1800 });
  });

  it('an asset line recovers its VAT on 34551', () => {
    const e = buildSupplierInvoiceEntry(inv({ nature: 'immobilisation' }), [
      ln({ account_code: '2355', barcode: null, amount_ht: 10000, vat_amount: 2000 }),
      ln({ account_code: '6141', barcode: null, amount_ht: 200, vat_amount: 40 }),
    ], supplier);
    expect(byAccount(e.lines)).toEqual({ '2355': 10000, '6141': 200, '34551': 2000, '34552': 40, '4411': -12240 });
    expect(sums(e.lines)).toEqual({ debit: 12240, credit: 12240 });
  });

  it('refuses a draft', () => {
    expect(() => buildSupplierInvoiceEntry(inv({ status: 'draft' }), [ln({ amount_ht: 1, vat_amount: 0.2 })], supplier)).toThrow(/brouillon/);
  });
});

describe('supplier payment entry', () => {
  it('bank payment: D 4411 / C 5141', () => {
    const e = buildSupplierPaymentEntry(pay({ amount: 1200, reference: 'VIR-9' }), inv(), supplier);
    expect(e).toMatchObject({ journalType: 'banque', date: '2026-04-15', reference: 'VIR-9', sourceType: 'payment', sourceId: 'spay:p1' });
    expect(byAccount(e.lines)).toEqual({ '4411': 1200, '5141': -1200 });
  });

  it('VAT withheld: the supplier gets the HT, 44581 carries the VAT owed to the State', () => {
    const e = buildSupplierPaymentEntry(pay({ amount: 10000, vat_withholding_rate: 100, vat_withheld: 2000 }), inv(), supplier);
    expect(byAccount(e.lines)).toEqual({ '4411': 12000, '5141': -10000, '44581': -2000 });
    expect(sums(e.lines)).toEqual({ debit: 12000, credit: 12000 });
  });

  it('IR withheld on fees goes to 44525; cash goes to the cash journal', () => {
    const e = buildSupplierPaymentEntry(pay({ amount: 5500, ir_withheld: 500, mode: 'especes' }), inv({ nature: 'services' }), supplier);
    expect(e.journalType).toBe('caisse');
    expect(byAccount(e.lines)).toEqual({ '4411': 6000, '5161': -5500, '44525': -500 });
    expect(sums(e.lines)).toEqual({ debit: 6000, credit: 6000 });
  });

  it('a set-off clears a customer receivable in OD', () => {
    const e = buildSupplierPaymentEntry(pay({ amount: 300, mode: 'compensation' }), inv(), supplier);
    expect(e.journalType).toBe('od');
    expect(byAccount(e.lines)).toEqual({ '4411': 300, '3421': -300 });
  });

  it('source ids are told apart from customer documents and the state follows the entries', () => {
    expect(invoiceSourceId('a')).toBe('sinv:a');
    expect(paymentSourceId('b')).toBe('spay:b');
    expect(isSupplierSourceId('sinv:a')).toBe(true);
    expect(isSupplierSourceId('inv-1:pay:2')).toBe(false);
    // Customer payment totals look for ":pay" in the source id.
    expect('spay:b'.includes(':pay')).toBe(false);
    expect(bookingState([{ source_id: 'sinv:a', status: 'reversed' }], 'sinv:a')).toBe('none');
    expect(bookingState([{ source_id: 'sinv:a', status: 'draft' }], 'sinv:a')).toBe('draft');
    expect(bookingState([{ source_id: 'sinv:a', status: 'draft' }, { source_id: 'sinv:a', status: 'posted' }], 'sinv:a')).toBe('posted');
  });

  it('the seed has the withholding accounts', () => {
    const codes = new Set(PCM_SEED.map(a => a.code));
    for (const c of ['44525', '44581', '34551', '34552', '4411', '5141', '5161', '6111', '6136', '2332']) expect(codes.has(c)).toBe(true);
  });
});

describe('VAT withheld at source (art. 117)', () => {
  const base = { legalType: 'societe' as const, nature: 'immobilisation' as const, isWorks: false, certificateDate: null, paymentDate: '2026-06-01', invoiceTtc: 12000 };
  it('equipment goods and works without a valid attestation: 100 %', () => {
    expect(suggestVatWithholding(base)).toMatchObject({ rate: 100, reason: expect.stringMatching(/117-IV/) });
    expect(suggestVatWithholding({ ...base, certificateDate: '2025-11-01' }).rate).toBe(100);
    expect(suggestVatWithholding({ ...base, certificateDate: '2026-01-15' }).rate).toBe(0);
    expect(suggestVatWithholding({ ...base, nature: 'services', isWorks: true }).rate).toBe(100);
  });
  it('listed services: 75 % / 100 % from a person, nothing from a company unless the buyer is a big one', () => {
    const s = { ...base, nature: 'services' as const };
    expect(suggestVatWithholding({ ...s, legalType: 'personne_physique', certificateDate: '2026-03-01' }).rate).toBe(75);
    expect(suggestVatWithholding({ ...s, legalType: 'personne_physique' }).rate).toBe(100);
    expect(suggestVatWithholding(s).rate).toBe(0);
    expect(suggestVatWithholding({ ...s, buyerWithholdsOnCompanies: true, certificateDate: '2026-03-01' }).rate).toBe(75);
    expect(suggestVatWithholding({ ...s, buyerWithholdsOnCompanies: true }).rate).toBe(100);
  });
  it('services of 5,000 DH or less within 50,000 a month are excluded; goods never withheld', () => {
    const s = { ...base, nature: 'services' as const, legalType: 'personne_physique' as const };
    expect(suggestVatWithholding({ ...s, invoiceTtc: 5000 }).rate).toBe(0);
    expect(suggestVatWithholding({ ...s, invoiceTtc: 5000, supplierMonthServicesTtc: 52000 }).rate).toBe(100);
    expect(suggestVatWithholding({ ...base, nature: 'marchandises' }).rate).toBe(0);
  });
  it('splits a payment between the supplier, the VAT and the IR withheld', () => {
    expect(splitPayment({ settled: 12000, invoiceTtc: 12000, invoiceVat: 2000, vatRate: 100, invoiceIr: 0, irAlreadyWithheld: 0, closesInvoice: true }))
      .toEqual({ vatWithheld: 2000, irWithheld: 0, cash: 10000 });
    expect(splitPayment({ settled: 6000, invoiceTtc: 12000, invoiceVat: 2000, vatRate: 75, invoiceIr: 1000, irAlreadyWithheld: 0, closesInvoice: false }))
      .toEqual({ vatWithheld: 750, irWithheld: 500, cash: 4750 });
    // The last payment takes what is left of the IR.
    expect(splitPayment({ settled: 6000, invoiceTtc: 12000, invoiceVat: 2000, vatRate: 0, invoiceIr: 1000, irAlreadyWithheld: 499.99, closesInvoice: true }).irWithheld).toBe(500.01);
  });
  it('the withheld amounts are paid the month after', () => {
    expect(remittanceMonth('2026-12-15')).toBe('2027-01');
  });
});

describe('cash limits (art. 11-II and 106-II)', () => {
  const p = (id: string, date: string, amount: number, mode = 'especes', supplier_id = 's1') => ({ id, supplier_id, payment_date: date, amount, mode, vatRatio: 1 / 6 });
  it('accepted modes are never limited', () => {
    const r = cashLimits([p('a', '2026-04-01', 90000, 'virement'), p('b', '2026-04-01', 9000, 'carte')]);
    expect(r.get('a')).toEqual({ overDay: false, overMonth: false, vatNonDeductible: 0, expenseNonDeductible: 0 });
    expect(r.get('b')!.overDay).toBe(false);
  });
  it('above 5,000 DH a day: VAT of that day lost, expense deductible up to 5,000', () => {
    const r = cashLimits([p('a', '2026-04-01', 3000), p('b', '2026-04-01', 3000), p('c', '2026-04-02', 4000), p('d', '2026-04-01', 3000, 'especes', 's2')]);
    expect(r.get('a')).toEqual({ overDay: true, overMonth: false, vatNonDeductible: 500, expenseNonDeductible: 0 });
    expect(r.get('b')).toEqual({ overDay: true, overMonth: false, vatNonDeductible: 500, expenseNonDeductible: 1000 });
    expect(r.get('c')!.overDay).toBe(false);
    expect(r.get('d')!.overDay).toBe(false);
    expect(cashWarning(r.get('b'))).toMatch(/5 000 DH en espèces le même jour/);
    expect(cashWarning(r.get('c'))).toBeNull();
  });
  it('above 50,000 DH in the month: the part beyond loses its VAT and its deduction', () => {
    const days = Array.from({ length: 11 }, (_, i) => p(`d${i}`, `2026-04-${String(i + 1).padStart(2, '0')}`, 4800, 'versement'));
    const r = cashLimits(days);
    // 10 × 4,800 = 48,000; the 11th payment brings 52,800: 2,800 beyond.
    expect(r.get('d9')!.overMonth).toBe(false);
    expect(r.get('d10')).toEqual({ overDay: false, overMonth: true, vatNonDeductible: Math.round(2800 / 6 * 100) / 100, expenseNonDeductible: 2800 });
  });
});

describe('monthly withholding statement', () => {
  it('lists VAT and IR/IS apart, payments of the month only', () => {
    const invoices = new Map([
      ['i1', { supplier_invoice_number: 'FA-1', invoice_date: '2026-04-01', total_ttc: 12000, total_ht: 10000, total_vat: 2000, ir_rate: null, supplier: { name: 'Atlas', if_number: '123', ice: '001234567000089' } }],
      ['i2', { supplier_invoice_number: 'H-7', invoice_date: '2026-04-02', total_ttc: 6000, total_ht: 5000, total_vat: 1000, ir_rate: 10, supplier: { name: 'Benali', if_number: '456', ice: '' } }],
    ]);
    const s = withholdingStatement('2026-04', [
      { invoice_id: 'i1', payment_date: '2026-04-20', amount: 4000, vat_withheld: 2000, ir_withheld: 0, vat_withholding_rate: 100 },
      { invoice_id: 'i1', payment_date: '2026-05-02', amount: 6000, vat_withheld: 0, ir_withheld: 0, vat_withholding_rate: 0 },
      { invoice_id: 'i2', payment_date: '2026-04-30', amount: 5500, vat_withheld: 0, ir_withheld: 500, vat_withholding_rate: 0 },
    ], invoices);
    expect(s.vat).toEqual([expect.objectContaining({ supplier: 'Atlas', if_number: '123', ice: '001234567000089', base: 1000, rate: 100, amount: 2000, payment_date: '2026-04-20' })]);
    expect(s.ir).toEqual([expect.objectContaining({ supplier: 'Benali', base: 5000, rate: 10, amount: 500 })]);
    expect(s.totalVat).toBe(2000);
    expect(s.totalIr).toBe(500);
  });
});
