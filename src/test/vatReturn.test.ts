import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { Quote } from '../types';
import type { Supplier, SupplierInvoice, SupplierInvoiceLine, SupplierPayment } from '../accounting/supplierInvoices';
import {
  buildVatEntryLines, computeVatReturn, creditBroughtForward, deductionCategory, filingDeadline, ledgerComparison, parsePeriodKey,
  periodContaining, previousPeriod, suggestedPeriodicity, taxableTurnover, vatPeriod, vatSettingsError,
  type SavedDeclaration, type VatReturnInput, type VatSettings,
} from '../accounting/vatReturn';
import { buildVatReturnPdf } from '../utils/vatReturnPdf';
import {
  deductionCsvRows, deductionRows, deductionStatementFileName, deductionStatementIssues, deductionStatementXml, zipDeductionStatement,
} from '../accounting/vatDeductionStatement';

// ── A hand-built company, October to December 2026 ───────────────────────
//
// Customer invoices (TTC, rate of each invoice):
//   F1 FAC2610-1  05/10  12 000 @20 %  paid 6 000 on 10/10 (virement) and 6 000 on 15/11 (chèque)
//   F2 FAC2610-2  08/10   5 500 @10 %  paid in full on 20/10 (espèces)
//   F3 FAC2610-3  12/10  24 000 @20 %  client pays 20 000 and withholds the 4 000 VAT on 25/10 (art. 117-IV)
//   F4 FAC2609-9  20/09   2 400 @20 %  paid in full on 25/09; credit note AV-0001 of 1 200 on 15/10
//   F5 draft      18/10   1 200 @20 %  paid 1 200 on 18/10 but never finalised
//   F6 FAC2512-4  20/12/2025 1 140 @14 % (old rate) paid 1 140 on 03/10/2026
// Supplier invoices and payments:
//   SI1 FA-100  goods (6111) HT 10 000 VAT 2 000, TTC 12 000; paid 6 000 on 05/10 by transfer (share 1/2)
//   SI2 FA-101  asset (2355) HT 20 000 VAT 4 000, TTC 24 000; paid in full on 10/10 by cheque
//   SI3 FS-7    services: 6136 HT 5 000 VAT 1 000 + reception 6142 HT 1 000 VAT 100 NOT deductible;
//               TTC 7 100 paid in cash on 12/10; the cash limit took its 1 000 of VAT (stored on the payment)
//   SI4 FT-55   works (6133) HT 10 000 VAT 2 000, TTC 12 000; paid 10 000 + 2 000 VAT withheld on 20/10
// Settings: cash basis, prorata 80 %, opening credit 1 000 at 01/10/2026.

const inv = (p: Partial<Quote> & { id: string; quoteNumber: string; totalAmount: number }): Quote => ({
  createdAt: new Date('2026-10-01T10:00:00'), updatedAt: new Date('2026-10-01T10:00:00'), status: 'final', customer: { fullName: `Client ${p.id}`, phoneNumber: '', address: '', city: '', salesPerson: '' } as Quote['customer'],
  items: [], document_type: 'invoice', avance_amount: 0, payment_methods_json: [], tva_rate: 20, ...p,
} as Quote);

const pay = (id: string, amount: number, date: string, method = 'Virement bancaire', extra: Record<string, unknown> = {}) => ({ id, method, amount, date, kind: 'payment' as const, ...extra });

const invoices: Quote[] = [
  inv({ id: 'F1', quoteNumber: 'FAC2610-1', quote_date: '2026-10-05', totalAmount: 12000, payment_methods_json: [pay('p1a', 6000, '2026-10-10'), pay('p1b', 6000, '2026-11-15', 'Chèque')] }),
  inv({ id: 'F2', quoteNumber: 'FAC2610-2', quote_date: '2026-10-08', totalAmount: 5500, tva_rate: 10, payment_methods_json: [pay('p2', 5500, '2026-10-20', 'Espèces')] }),
  inv({ id: 'F3', quoteNumber: 'FAC2610-3', quote_date: '2026-10-12', totalAmount: 24000, customer: { fullName: 'Office public', ice: '002000000000011' } as Quote['customer'],
    payment_methods_json: [pay('p3', 20000, '2026-10-25'), { id: 'w3', method: 'TVA retenue à la source', kind: 'vat_withholding', amount: 4000, date: '2026-10-25', withholding_rate: 100 }] }),
  inv({ id: 'F4', quoteNumber: 'FAC2609-9', quote_date: '2026-09-20', totalAmount: 2400, payment_methods_json: [pay('p4', 2400, '2026-09-25')] }),
  inv({ id: 'F5', quoteNumber: 'BROUILLON-ABC123', status: 'draft', quote_date: '2026-10-18', totalAmount: 1200, payment_methods_json: [pay('p5', 1200, '2026-10-18', 'Espèces')] }),
  inv({ id: 'F6', quoteNumber: 'FAC2512-4', quote_date: '2025-12-20', totalAmount: 1140, tva_rate: 14, payment_methods_json: [pay('p6', 1140, '2026-10-03')] }),
];
const avoirs: Quote[] = [inv({ id: 'AV1', quoteNumber: 'AV-0001', document_type: 'avoir', parent_document_id: 'F4', quote_date: '2026-10-15', totalAmount: 1200 })];

const supplier = (p: Partial<Supplier> & { id: string; name: string }): Supplier => ({ company_id: 'c1', legal_type: 'societe', payment_days: 60, ...p } as Supplier);
const suppliers = [
  supplier({ id: 'S1', name: 'Inox Maroc', if_number: '1234567', ice: '001234567000089' }),
  supplier({ id: 'S2', name: 'Benali', first_name: 'Karim', legal_type: 'personne_physique', if_number: '7654321', ice: '000111222000033' }),
  supplier({ id: 'S3', name: 'Atlas Travaux', if_number: '1112223', ice: null }),
];
const sinv = (p: Partial<SupplierInvoice> & { id: string; supplier_id: string; supplier_invoice_number: string; invoice_date: string; total_ht: number; total_vat: number }): SupplierInvoice => ({
  company_id: 'c1', number: `FF-${p.id}`, reception_date: null, delivery_date: null, due_date: '2026-12-31', due_kind: 'legal', nature: 'marchandises', is_works: false,
  description: null, status: 'validated', total_ttc: p.total_ht + p.total_vat, total_nondeductible_vat: 0, paid_amount: 0, ir_rate: null, ir_amount: 0,
  litigation_amount: null, litigation_date: null, judgment_amount: null, judgment_date: null, cash_over_limit: false, source_po_id: null, source_receipt_id: null, notes: null, created_by: null, ...p,
} as SupplierInvoice);
const supplierInvoices = [
  sinv({ id: 'SI1', supplier_id: 'S1', supplier_invoice_number: 'FA-100', invoice_date: '2026-09-28', total_ht: 10000, total_vat: 2000, description: 'Fours mixtes' }),
  sinv({ id: 'SI2', supplier_id: 'S1', supplier_invoice_number: 'FA-101', invoice_date: '2026-10-02', total_ht: 20000, total_vat: 4000, nature: 'immobilisation', description: 'Serveur informatique' }),
  sinv({ id: 'SI3', supplier_id: 'S2', supplier_invoice_number: 'FS-7', invoice_date: '2026-10-01', total_ht: 6000, total_vat: 1100, total_nondeductible_vat: 100, nature: 'services', description: 'Conseil et réception' }),
  sinv({ id: 'SI4', supplier_id: 'S3', supplier_invoice_number: 'FT-55', invoice_date: '2026-10-15', total_ht: 10000, total_vat: 2000, nature: 'services', is_works: true, description: 'Travaux d’aménagement' }),
];
const line = (invoice_id: string, account_code: string, amount_ht: number, vat_rate: number, vat_nondeductible = false, label = account_code): SupplierInvoiceLine => ({
  invoice_id, position: 0, label, barcode: null, quantity: null, amount_ht, vat_rate, vat_amount: Math.round(amount_ht * vat_rate) / 100, account_code, vat_nondeductible,
});
const supplierLines = new Map<string, SupplierInvoiceLine[]>([
  ['SI1', [line('SI1', '6111', 10000, 20)]],
  ['SI2', [line('SI2', '2355', 20000, 20)]],
  ['SI3', [line('SI3', '6136', 5000, 20), line('SI3', '6142', 1000, 10, true)]],
  ['SI4', [line('SI4', '6133', 10000, 20)]],
]);
const spay = (p: Partial<SupplierPayment> & { id: string; invoice_id: string; supplier_id: string; payment_date: string; amount: number }): SupplierPayment => ({
  company_id: 'c1', mode: 'virement', reference: null, bank: null, vat_withholding_rate: 0, vat_withheld: 0, ir_withheld: 0, cash_vat_nondeductible: 0, cash_expense_nondeductible: 0, notes: null, created_by: null, ...p,
} as SupplierPayment);
const supplierPayments = [
  spay({ id: 'P1', invoice_id: 'SI1', supplier_id: 'S1', payment_date: '2026-10-05', amount: 6000 }),
  spay({ id: 'P2', invoice_id: 'SI2', supplier_id: 'S1', payment_date: '2026-10-10', amount: 24000, mode: 'cheque' }),
  spay({ id: 'P3', invoice_id: 'SI3', supplier_id: 'S2', payment_date: '2026-10-12', amount: 7100, mode: 'especes', cash_vat_nondeductible: 1000, cash_expense_nondeductible: 2100 }),
  spay({ id: 'P4', invoice_id: 'SI4', supplier_id: 'S3', payment_date: '2026-10-20', amount: 10000, vat_withheld: 2000, vat_withholding_rate: 100 }),
];

const settings: VatSettings = { regime: 'encaissement', periodicity: 'M', prorata: 80, openingCredit: 1000, startDate: '2026-10-01' };
const base = (p: Partial<VatReturnInput> = {}): VatReturnInput => ({
  period: vatPeriod('M', 2026, 10), settings, companyRate: 20, invoices, avoirs, supplierInvoices, supplierLines, supplierPayments, suppliers, declarations: [], ...p,
});
const vatOfRate = (r: ReturnType<typeof computeVatReturn>, rate: number) => r.sales.byRate.find(l => l.rate === rate);

describe('periods and deadlines', () => {
  it('builds months and quarters, their keys and their filing deadline (end of the following month, art. 110/111)', () => {
    const oct = vatPeriod('M', 2026, 10);
    expect(oct).toMatchObject({ key: '2026-10', start: '2026-10-01', end: '2026-10-31', label: 'octobre 2026' });
    expect(filingDeadline(oct)).toEqual({ electronic: '2026-11-30', paper: '2026-11-19' });
    const q4 = vatPeriod('T', 2026, 4);
    expect(q4).toMatchObject({ key: '2026-T4', start: '2026-10-01', end: '2026-12-31' });
    expect(filingDeadline(q4).electronic).toBe('2027-01-31');
    expect(filingDeadline(vatPeriod('T', 2026, 1)).electronic).toBe('2026-04-30');
    expect(filingDeadline(vatPeriod('M', 2026, 1)).electronic).toBe('2026-02-28');
    expect(previousPeriod(vatPeriod('M', 2026, 1)).key).toBe('2025-12');
    expect(previousPeriod(vatPeriod('T', 2026, 1)).key).toBe('2025-T4');
    expect(periodContaining('T', '2026-11-25').key).toBe('2026-T4');
    expect(parsePeriodKey('2026-T2')?.end).toBe('2026-06-30');
    expect(parsePeriodKey('2026-13')).toBeNull();
  });

  it('proposes monthly at 1 000 000 DH of taxable turnover, quarterly below or for a new company (art. 108)', () => {
    expect(suggestedPeriodicity(1_000_000).periodicity).toBe('M');
    expect(suggestedPeriodicity(999_999.99).periodicity).toBe('T');
    expect(suggestedPeriodicity(null).periodicity).toBe('T');
  });

  it('checks the settings', () => {
    expect(vatSettingsError({ prorata: 0 })).toMatch(/prorata/);
    expect(vatSettingsError({ prorata: 80, openingCredit: -1 })).toMatch(/crédit/);
    expect(vatSettingsError({ startDate: '2026-10-15' })).toMatch(/premier jour/);
    expect(vatSettingsError(settings)).toBeNull();
  });

  it('sorts accounts into the deduction blocks of art. 112-I-8°', () => {
    expect(deductionCategory('2355')).toBe('immobilisations');
    expect(deductionCategory('6111')).toBe('achats');
    expect(deductionCategory('6125')).toBe('achats');
    expect(deductionCategory('6136')).toBe('services');
    expect(deductionCategory('6133')).toBe('services');
  });
});

describe('October 2026, cash basis (encaissement)', () => {
  const r = computeVatReturn(base());

  it('counts the money received in October, each at its invoice rate', () => {
    // 20 %: F1 6 000 → 5 000 + 1 000; F3 20 000 → 16 666.67 + 3 333.33 and the 4 000 withheld → 3 333.33 + 666.67;
    //        F4's credit note: invoice already paid in full, so the 1 200 lowers October: −1 000 / −200.
    //        Base 5 000 + 20 000 − 1 000 = 24 000; VAT 1 000 + 4 000 − 200 = 4 800.
    expect(vatOfRate(r, 20)).toMatchObject({ base: 24000, vat: 4800, legal: true });
    expect(vatOfRate(r, 20)!.items.map(i => i.kind)).toEqual(['encaissement', 'avoir', 'encaissement', 'retenue']);
    // 10 %: F2 5 500 → 5 000 + 500.
    expect(vatOfRate(r, 10)).toMatchObject({ base: 5000, vat: 500 });
    // 14 % (gone since 2026): F6 1 140 → 1 000 + 140, on its own line.
    expect(vatOfRate(r, 14)).toMatchObject({ base: 1000, vat: 140, legal: false });
    // Total due: 4 800 + 500 + 140 = 5 440 on 30 000 HT. The second half of F1 (November) is not here.
    expect(r.sales.totalVat).toBe(5440);
    expect(r.sales.totalBase).toBe(30000);
    expect(r.sales.creditNotes).toMatchObject({ base: -1000, vat: -200 });
  });

  it('leaves the draft invoice out and says so', () => {
    expect(r.sales.byRate.flatMap(l => l.items).some(i => i.docId === 'F5')).toBe(false);
    const w = r.warnings.find(x => x.code === 'draft_paid')!;
    // 1 200 @20 % → VAT 200 not counted.
    expect(w.message).toMatch(/200,00 DH/);
    expect(w.level).toBe('error');
    // A 2025 invoice at 14 % paid in 2026 keeps its rate (art. 125-III): information, not an error.
    expect(r.warnings.find(x => x.code === 'old_rate')).toMatchObject({ level: 'info', refs: ['FAC2512-4 (14 %)'] });
    expect(r.warnings.find(x => x.code === 'old_rate_2026')).toBeUndefined();
    const wrong = computeVatReturn(base({ invoices: [inv({ id: 'F9', quoteNumber: 'FAC2610-9', quote_date: '2026-10-02', totalAmount: 1140, tva_rate: 14, payment_methods_json: [pay('p9', 1140, '2026-10-04')] })], avoirs: [] }));
    expect(wrong.warnings.find(x => x.code === 'old_rate_2026')).toMatchObject({ level: 'error', refs: ['FAC2610-9 (14 %)'] });
  });

  it('deducts the VAT of the supplier payments of October, by block, then the prorata', () => {
    const cat = (c: string) => r.deductions.byCategory.find(x => x.category === c)!;
    // Goods: half of FA-100 paid → HT 5 000, VAT 1 000.
    expect(cat('achats')).toMatchObject({ base: 5000, vat: 1000, vatAfterProrata: 800 });
    // Services: FS-7 HT 5 000, VAT 1 000 − 1 000 lost in cash = 0 (the 100 of the reception line is excluded);
    //           FT-55 settled 10 000 + 2 000 withheld = the whole invoice → HT 10 000, VAT 2 000.
    expect(cat('services')).toMatchObject({ base: 15000, vat: 2000, vatAfterProrata: 1600 });
    // Asset: FA-101 paid in full → HT 20 000, VAT 4 000.
    expect(cat('immobilisations')).toMatchObject({ base: 20000, vat: 4000, vatAfterProrata: 3200 });
    // 7 000 before prorata, × 80 % = 5 600; 1 400 not deductible.
    expect(r.deductions).toMatchObject({ totalVat: 7000, totalAfterProrata: 5600, prorataLoss: 1400, cashLoss: 1000, excludedVat: 100, prorata: 80 });
  });

  it('brings the opening credit, sets the withheld VAT against the VAT due and carries the rest', () => {
    expect(r.credit).toMatchObject({ amount: 1000, source: 'opening' });
    expect(r.clientWithholdings.total).toBe(4000);
    // 5 440 − 5 600 − 1 000 − 4 000 = −5 160: a credit of 5 160, of which 4 000 came from the withholding (refundable, art. 103-6°).
    expect(r.net).toBe(-5160);
    expect(r.toPay).toBe(0);
    expect(r.creditToCarry).toBe(5160);
    expect(r.refundableCredit).toBe(4000);
  });

  it('shows the VAT withheld from suppliers apart, to pay in November', () => {
    expect(r.supplierWithholdings.total).toBe(2000);
    expect(r.supplierWithholdings.byMonth).toEqual([{ month: '2026-11', amount: 2000 }]);
    expect(r.supplierWithholdings.items[0]).toMatchObject({ supplierName: 'Atlas Travaux', invoiceNumber: 'FT-55', dueMonth: '2026-11' });
  });

  it('flags what the relevé lacks and the cash-limit loss', () => {
    expect(r.warnings.find(w => w.code === 'supplier_ids')!.refs).toEqual(['Atlas Travaux (ICE manquant)']);
    expect(r.warnings.find(w => w.code === 'cash_loss')!.message).toMatch(/1 000,00 DH/);
    expect(r.warnings.find(w => w.code === 'nondeductible_lines')!.message).toMatch(/100,00 DH/);
    expect(r.warnings.find(w => w.code === 'refundable')).toBeTruthy();
  });

  it('builds a balanced OD entry for the return', () => {
    const lines = buildVatEntryLines(r);
    // D 4455 5 440 | C 34551 3 200 | C 34552 2 400 (800 + 1 600) | C 34581 4 000 | C 3456 1 000 | D 3456 5 160
    expect(lines).toEqual([
      { account_code: '4455', label: 'TVA exigible de la période', debit: 5440, credit: 0 },
      { account_code: '34551', label: 'TVA déductible sur immobilisations', debit: 0, credit: 3200 },
      { account_code: '34552', label: 'TVA déductible sur achats et services', debit: 0, credit: 2400 },
      { account_code: '34581', label: 'TVA retenue à la source par les clients', debit: 0, credit: 4000 },
      { account_code: '3456', label: 'Crédit de TVA reporté', debit: 0, credit: 1000 },
      { account_code: '3456', label: 'Crédit de TVA à reporter', debit: 5160, credit: 0 },
    ]);
  });
});

describe('the same data on the invoice basis (débit)', () => {
  const r = computeVatReturn(base({ settings: { ...settings, regime: 'debit' } }));
  it('counts the invoices issued in October and the credit note, not the money', () => {
    // 20 %: F1 12 000 → 10 000 + 2 000; F3 24 000 → 20 000 + 4 000; AV-0001 −1 000 / −200 → 29 000 / 5 800.
    expect(vatOfRate(r, 20)).toMatchObject({ base: 29000, vat: 5800 });
    // 10 %: F2 → 5 000 / 500. F6 (invoiced in 2025) and F4 (September) are not in October.
    expect(vatOfRate(r, 10)).toMatchObject({ base: 5000, vat: 500 });
    expect(vatOfRate(r, 14)).toBeUndefined();
    expect(r.sales.totalVat).toBe(6300);
    // Deductions follow the payment on either basis: 5 600. 6 300 − 5 600 − 1 000 − 4 000 = −4 300.
    expect(r.deductions.totalAfterProrata).toBe(5600);
    expect(r.creditToCarry).toBe(4300);
    expect(buildVatEntryLines(r)[0]).toMatchObject({ account_code: '4455', debit: 6300 });
  });

  it('taxes an advance received before its invoice when received (art. 95)', () => {
    const adv = inv({ id: 'F9', quoteNumber: 'FAC2611-1', quote_date: '2026-11-02', totalAmount: 12000, payment_methods_json: [pay('a9', 3600, '2026-10-28', 'Virement', { advance: true })] });
    const deb = { ...settings, regime: 'debit' as const };
    const oct = computeVatReturn(base({ settings: deb, invoices: [adv], avoirs: [], supplierPayments: [] }));
    // 3 600 → HT 3 000, VAT 600 in October.
    expect(oct.sales.byRate[0].items[0]).toMatchObject({ kind: 'avance', ttc: 3600, ht: 3000, vat: 600 });
    const nov = computeVatReturn(base({ period: vatPeriod('M', 2026, 11), settings: deb, invoices: [adv], avoirs: [], supplierPayments: [] }));
    // November: the invoice less the advance, 8 400 → 7 000 + 1 400.
    expect(nov.sales.byRate[0].items[0]).toMatchObject({ kind: 'facture', ttc: 8400, ht: 7000, vat: 1400, fullAmount: 12000 });
  });
});

describe('credit notes on a cash basis', () => {
  it('on an unpaid invoice only lowers what is collected later', () => {
    const f = inv({ id: 'F1', quoteNumber: 'FAC1', quote_date: '2026-10-01', totalAmount: 12000, payment_methods_json: [pay('x', 10800, '2026-11-10')] });
    const a = inv({ id: 'A1', quoteNumber: 'AV-1', document_type: 'avoir', parent_document_id: 'F1', quote_date: '2026-10-20', totalAmount: 1200 });
    const oct = computeVatReturn(base({ invoices: [f], avoirs: [a], supplierPayments: [] }));
    expect(oct.sales.totalVat).toBe(0);
    const nov = computeVatReturn(base({ period: vatPeriod('M', 2026, 11), invoices: [f], avoirs: [a], supplierPayments: [] }));
    // 10 800 collected = the price net of the credit note: VAT 1 800, nothing deducted twice.
    expect(nov.sales.totalVat).toBe(1800);
  });

  it('never counts more than the price net of credit notes, even when the client pays the full amount', () => {
    const f = inv({ id: 'F1', quoteNumber: 'FAC1', quote_date: '2026-10-01', totalAmount: 12000, payment_methods_json: [pay('x', 12000, '2026-11-10')] });
    const a = inv({ id: 'A1', quoteNumber: 'AV-1', document_type: 'avoir', parent_document_id: 'F1', quote_date: '2026-10-20', totalAmount: 1200 });
    const nov = computeVatReturn(base({ period: vatPeriod('M', 2026, 11), invoices: [f], avoirs: [a], supplierPayments: [] }));
    expect(nov.sales.byRate[0].items[0]).toMatchObject({ ttc: 10800, vat: 1800, fullAmount: 12000 });
  });
});

describe('credit carried over two periods', () => {
  const oct = computeVatReturn(base());
  const filed = (r: typeof oct, key: string): SavedDeclaration => ({ period: key, status: 'filed', credit_report: r.creditToCarry, snapshot: { result: JSON.parse(JSON.stringify(r)) } });

  it('November starts from October’s saved credit, December from November’s', () => {
    const nov = computeVatReturn(base({ period: vatPeriod('M', 2026, 11), declarations: [filed(oct, '2026-10')] }));
    // November: F1's second 6 000 → VAT 1 000; no deduction; 1 000 − 5 160 = −4 160.
    expect(nov.credit).toMatchObject({ amount: 5160, source: 'declaration', fromPeriod: '2026-10', filed: true, missing: [] });
    expect(nov.sales.totalVat).toBe(1000);
    expect(nov.creditToCarry).toBe(4160);

    const big = inv({ id: 'F7', quoteNumber: 'FAC2612-1', quote_date: '2026-12-03', totalAmount: 36000, payment_methods_json: [pay('p7', 36000, '2026-12-05')] });
    const dec = computeVatReturn(base({ period: vatPeriod('M', 2026, 12), invoices: [...invoices, big], declarations: [filed(oct, '2026-10'), filed(nov, '2026-11')] }));
    // December: 36 000 → VAT 6 000; 6 000 − 4 160 = 1 840 to pay.
    expect(dec.credit.amount).toBe(4160);
    expect(dec.toPay).toBe(1840);
    expect(dec.creditToCarry).toBe(0);
  });

  it('warns about a period with no declaration in between, and about a credit from a draft', () => {
    const dec = computeVatReturn(base({ period: vatPeriod('M', 2026, 12), declarations: [{ ...filed(oct, '2026-10'), status: 'draft' }] }));
    expect(dec.credit.missing).toEqual(['2026-11']);
    expect(dec.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['missing_periods', 'previous_not_filed']));
  });

  it('uses no ledger line and no credit before the start date', () => {
    expect(creditBroughtForward(vatPeriod('M', 2026, 9), [], settings)).toMatchObject({ amount: 0, source: 'none' });
    expect(creditBroughtForward(vatPeriod('M', 2026, 11), [], settings)).toMatchObject({ amount: 1000, source: 'opening', missing: ['2026-10'] });
  });

  it('offers a payment of an earlier period left out of the saved declarations, within one year (art. 101-3°)', () => {
    const lateInv = sinv({ id: 'SI5', supplier_id: 'S1', supplier_invoice_number: 'FA-110', invoice_date: '2026-10-28', total_ht: 1000, total_vat: 200, description: 'Pièces' });
    const latePay = spay({ id: 'P5', invoice_id: 'SI5', supplier_id: 'S1', payment_date: '2026-10-30', amount: 1200 });
    const lines = new Map([...supplierLines, ['SI5', [line('SI5', '6111', 1000, 20)]]]);
    // October was filed before P5 was recorded: its stored list does not have P5.
    const input = base({ period: vatPeriod('M', 2026, 11), declarations: [filed(oct, '2026-10')], supplierInvoices: [...supplierInvoices, lateInv], supplierLines: lines, supplierPayments: [...supplierPayments, latePay] });
    const nov = computeVatReturn(input);
    expect(nov.latePayments).toEqual([expect.objectContaining({ paymentId: 'P5', vat: 200, deadline: '2027-10-01', expired: false })]);
    expect(nov.deductions.totalVat).toBe(0);
    expect(nov.warnings.find(w => w.code === 'late_deductions')).toBeTruthy();
    const withLate = computeVatReturn({ ...input, includeLatePaymentIds: ['P5'] });
    // 200 × 80 % = 160 deducted in November, marked as coming from an earlier period.
    expect(withLate.deductions.totalAfterProrata).toBe(160);
    expect(withLate.deductions.items[0]).toMatchObject({ paymentId: 'P5', late: true });
    expect(deductionRows(withLate)[0]).toMatchObject({ num: 'FA-110', dpai: '2026-10-30', late: true });
  });
});

describe('quarter against months', () => {
  it('the fourth quarter adds October and November, with one opening credit', () => {
    const q = computeVatReturn(base({ period: vatPeriod('T', 2026, 4), settings: { ...settings, periodicity: 'T' } }));
    // Sales: October 5 440 + November 1 000 = 6 440; deductions 5 600; credit 1 000; withheld 4 000.
    // 6 440 − 5 600 − 1 000 − 4 000 = −4 160: the same as October then November month by month.
    expect(q.sales.totalVat).toBe(6440);
    expect(q.deductions.totalAfterProrata).toBe(5600);
    expect(q.credit).toMatchObject({ amount: 1000, source: 'opening', missing: [] });
    expect(q.creditToCarry).toBe(4160);
    expect(q.deadline.electronic).toBe('2027-01-31');
  });

  it('measures last year’s taxable turnover for the periodicity rule', () => {
    // 2025 on the cash basis: nothing was collected in 2025 (F6 was paid in 2026).
    expect(taxableTurnover({ invoices, avoirs, regime: 'encaissement', start: '2025-01-01', end: '2025-12-31' })).toBe(0);
    // On the invoice basis F6 counts in 2025: HT 1 000.
    expect(taxableTurnover({ invoices, avoirs, regime: 'debit', start: '2025-01-01', end: '2025-12-31' })).toBe(1000);
  });
});

describe('relevé de déductions', () => {
  const r = computeVatReturn(base());
  const rows = deductionRows(r);

  it('has one line per payment and rate, in payment order; a payment whose VAT was all lost has none', () => {
    expect(rows.map(x => [x.ord, x.num, x.mht, x.tva, x.ttc, x.mp, x.dpai])).toEqual([
      [1, 'FA-100', 5000, 1000, 6000, 4, '2026-10-05'],
      [2, 'FA-101', 20000, 4000, 24000, 2, '2026-10-10'],
      [3, 'FT-55', 10000, 2000, 12000, 4, '2026-10-20'],
    ]);
    expect(rows[0]).toMatchObject({ des: 'Fours mixtes', if: '1234567', nom: 'Inox Maroc', ice: '001234567000089', tx: 20, prorata: 80, dfac: '2026-09-28' });
  });

  it('blocks the export while an identifier is missing', () => {
    const issues = deductionStatementIssues(rows, '84016950');
    expect(issues.filter(i => i.level === 'error').map(i => i.message)).toEqual(['Ligne 3 (Atlas Travaux, facture FT-55) : ICE du fournisseur manquant.']);
    expect(deductionStatementIssues(rows, '').some(i => /IF\) de la société manquant/.test(i.message))).toBe(true);
  });

  it('writes the XML of the SIMPL-TVA specification and zips it', () => {
    const xml = deductionStatementXml(rows.slice(0, 1), '84016950', vatPeriod('M', 2026, 10));
    expect(xml).toBe('﻿' + [
      '<DeclarationReleveDeduction>',
      '\t<identifiantFiscal>84016950</identifiantFiscal>',
      '\t<annee>2026</annee>',
      '\t<periode>10</periode>',
      '\t<regime>1</regime>',
      '\t<releveDeductions>',
      '\t\t<rd>',
      '\t\t\t<ord>1</ord>',
      '\t\t\t<num>FA-100</num>',
      '\t\t\t<des>Fours mixtes</des>',
      '\t\t\t<mht>5000.00</mht>',
      '\t\t\t<tva>1000.00</tva>',
      '\t\t\t<ttc>6000.00</ttc>',
      '\t\t\t<refF>',
      '\t\t\t\t<if>1234567</if>',
      '\t\t\t\t<nom>Inox Maroc</nom>',
      '\t\t\t\t<ice>001234567000089</ice>',
      '\t\t\t</refF>',
      '\t\t\t<tx>20.00</tx>',
      '\t\t\t<prorata>80</prorata>',
      '\t\t\t<mp>',
      '\t\t\t\t<id>4</id>',
      '\t\t\t</mp>',
      '\t\t\t<dpai>2026-10-05</dpai>',
      '\t\t\t<dfac>2026-09-28</dfac>',
      '\t\t</rd>',
      '\t</releveDeductions>',
      '</DeclarationReleveDeduction>',
    ].join('\r\n'));
    const q = deductionStatementXml([], '84016950', vatPeriod('T', 2026, 4));
    expect(q).toContain('<periode>4</periode>\r\n\t<regime>2</regime>');
    // Characters XML reserves are escaped.
    expect(deductionStatementXml([{ ...rows[0], nom: 'A & B <SARL>' }], '1', vatPeriod('M', 2026, 1))).toContain('<nom>A &amp; B &lt;SARL&gt;</nom>');
    const name = deductionStatementFileName('84016950', vatPeriod('M', 2026, 10), 'xml');
    expect(name).toBe('ReleveDeductions_84016950_2026_M10.xml');
    const files = unzipSync(zipDeductionStatement(xml, name));
    expect(Object.keys(files)).toEqual([name]);
    // UTF-8 with its byte-order mark, as the specification's example file (EF BB BF).
    expect([...files[name].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect('\uFEFF' + strFromU8(files[name])).toBe(xml);
  });

  it('gives the same lines as CSV, with French headers', () => {
    const csv = deductionCsvRows(rows);
    expect(csv[1]).toMatchObject({ 'N° ordre': 2, 'N° facture': 'FA-101', 'Mode de paiement': '2 - Chèque', 'Date de paiement': '10/10/2026', 'Catégorie': 'Immobilisation', 'Prorata %': 80 });
  });
});

describe('PDF of the return', () => {
  it('prints the figures, the SIMPL-TVA notice and the lists, on two pages', () => {
    const r = computeVatReturn(base());
    const pdf = buildVatReturnPdf(r, deductionRows(r), { name: 'Cuisimat SARL', if: '84016950', ice: '001525874000045' }, { status: 'draft', producedAt: new Date('2026-11-25T10:00:00') });
    expect(pdf.getNumberOfPages()).toBe(2);
    const raw = pdf.output();
    for (const text of ['Cuisimat SARL', 'IF 84016950', '5 440,00', '5 600,00', '5 160,00', '4 000,00', 'SIMPL-TVA', 'FA-101', 'FAC2610-3', 'brouillon']) expect(raw).toContain(text);
  });
});

describe('ledger comparison', () => {
  it('reads the movements of 4455, 3455 and 34581 in the period, the return’s own entry left out', () => {
    const c = ledgerComparison([
      { account_code: '4455', debit: 0, credit: 2000, entry_date: '2026-10-05' },
      { account_code: '44553', debit: 0, credit: 500, entry_date: '2026-10-08' },
      { account_code: '4455', debit: 200, credit: 0, entry_date: '2026-10-15' },
      { account_code: '4455', debit: 0, credit: 999, entry_date: '2026-09-30' },
      { account_code: '4455', debit: 5440, credit: 0, entry_date: '2026-10-31', source_id: 'tva:2026-10' },
      { account_code: '34552', debit: 2000, credit: 0, entry_date: '2026-10-02' },
      { account_code: '34551', debit: 4000, credit: 0, entry_date: '2026-10-02' },
      { account_code: '34581', debit: 4000, credit: 0, entry_date: '2026-10-25' },
    ], vatPeriod('M', 2026, 10));
    expect(c).toEqual({ collected: 2300, recoverableAssets: 4000, recoverableCharges: 2000, recoverable: 6000, withheldByClients: 4000 });
  });
});
