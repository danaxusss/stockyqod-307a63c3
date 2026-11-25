import { describe, expect, it } from 'vitest';
import {
  addMonths, certificateValidOn, defaultDueDate, delayStart, dueDateError, invoiceErrors, invoiceTotals, invoicedQuantities,
  isDuplicateNumber, lineErrors, linesFromCosts, matchSupplier, overdueDays, remainingOf, statusFromAmounts, supplierErrors,
  supplierNameCandidates, ttcToHt, vatOf, type SupplierInvoiceLine,
} from '../accounting/supplierInvoices';

const line = (p: Partial<SupplierInvoiceLine> = {}): SupplierInvoiceLine => ({
  position: 0, label: 'Article', barcode: 'P1', quantity: 1, amount_ht: 100, vat_rate: 20, vat_amount: 20, account_code: '6111', vat_nondeductible: false, ...p,
});
const draft = { supplier_id: 's1', supplier_invoice_number: 'FA-1', invoice_date: '2026-03-10', delivery_date: null, due_date: '2026-05-09', due_kind: 'legal' as const, nature: 'marchandises' as const };

describe('supplier invoice totals', () => {
  it('totals by rate, highest first, with the non-deductible VAT apart', () => {
    const t = invoiceTotals([
      line({ amount_ht: 1000, vat_rate: 20, vat_amount: 200 }),
      line({ amount_ht: 500, vat_rate: 10, vat_amount: 50 }),
      line({ amount_ht: 300, vat_rate: 20, vat_amount: 60, vat_nondeductible: true }),
      line({ amount_ht: 40, vat_rate: 0, vat_amount: 0 }),
    ]);
    expect(t.byRate).toEqual([
      { rate: 20, base: 1300, vat: 260, ttc: 1560, nonDeductibleVat: 60 },
      { rate: 10, base: 500, vat: 50, ttc: 550, nonDeductibleVat: 0 },
      { rate: 0, base: 40, vat: 0, ttc: 40, nonDeductibleVat: 0 },
    ]);
    expect(t).toMatchObject({ ht: 1840, vat: 310, ttc: 2150, nonDeductibleVat: 60, deductibleVat: 250 });
  });

  it('rounds VAT to the centime and brings TTC costs back to HT', () => {
    expect(vatOf(33.33, 20)).toBe(6.67);
    expect(ttcToHt(1200, 20)).toBe(1000);
    expect(ttcToHt(110, 10)).toBe(100);
  });

  it('derives the status from what is settled', () => {
    expect(statusFromAmounts(true, 100, 100)).toBe('draft');
    expect(statusFromAmounts(false, 100, 0)).toBe('validated');
    expect(statusFromAmounts(false, 100, 40)).toBe('partial');
    expect(statusFromAmounts(false, 100, 100)).toBe('paid');
    expect(remainingOf({ total_ttc: 100, paid_amount: 40 })).toBe(60);
  });
});

describe('due date (loi 69-21)', () => {
  it('defaults to 60 days from the invoice, or the supplier delay, never beyond 120', () => {
    expect(defaultDueDate({ invoice_date: '2026-03-10', delivery_date: null })).toBe('2026-05-09');
    expect(defaultDueDate({ invoice_date: '2026-03-10', delivery_date: null }, 90)).toBe('2026-06-08');
    expect(defaultDueDate({ invoice_date: '2026-03-10', delivery_date: null }, 200)).toBe('2026-07-08');
  });

  it('runs from the end of the month of delivery when the invoice came later', () => {
    expect(delayStart({ invoice_date: '2026-04-15', delivery_date: '2026-03-05' })).toBe('2026-03-31');
    expect(delayStart({ invoice_date: '2026-03-20', delivery_date: '2026-03-05' })).toBe('2026-03-20');
    expect(defaultDueDate({ invoice_date: '2026-04-15', delivery_date: '2026-03-05' })).toBe('2026-05-30');
  });

  it('refuses more than 60 days without agreement and more than 120 with one', () => {
    expect(dueDateError({ ...draft, due_date: '2026-05-09' })).toBeNull();
    expect(dueDateError({ ...draft, due_date: '2026-05-10' })).toMatch(/60 jours au plus/);
    expect(dueDateError({ ...draft, due_kind: 'agreed', due_date: '2026-07-08' })).toBeNull();
    expect(dueDateError({ ...draft, due_kind: 'agreed', due_date: '2026-07-09' })).toMatch(/120 jours/);
    expect(dueDateError({ ...draft, due_date: '2026-03-01' })).toMatch(/précéder/);
  });
});

describe('checks', () => {
  it('requires the product and quantity on goods lines only', () => {
    expect(lineErrors(line(), 0)).toEqual([]);
    expect(lineErrors(line({ barcode: null }), 0)).toEqual(['Ligne 1 : une ligne de marchandises doit indiquer l’article.']);
    expect(lineErrors(line({ quantity: null }), 1)).toEqual(['Ligne 2 : une ligne de marchandises doit indiquer la quantité.']);
    expect(lineErrors(line({ account_code: '6141', barcode: null, quantity: null }), 0)).toEqual([]);
    expect(lineErrors(line({ vat_rate: 13 }), 0).join()).toMatch(/taux de TVA invalide/);
    expect(lineErrors(line({ vat_amount: 25 }), 0).join()).toMatch(/s’écarte/);
  });

  it('checks the header, and IR/IS only on services', () => {
    expect(invoiceErrors(draft, [line()])).toEqual([]);
    expect(invoiceErrors({ ...draft, supplier_id: '', supplier_invoice_number: ' ' }, [])).toEqual([
      'Choisissez le fournisseur.', 'Indiquez le numéro de la facture du fournisseur.', 'Ajoutez au moins une ligne.',
    ]);
    expect(invoiceErrors({ ...draft, ir_amount: 10 }, [line()]).join()).toMatch(/ne concerne que les services/);
    expect(invoiceErrors({ ...draft, nature: 'services', ir_amount: 10 }, [line({ account_code: '6136' })])).toEqual([]);
  });

  it('refuses the same supplier invoice number twice, spaces and case ignored', () => {
    const existing = [{ id: 'a', supplier_id: 's1', supplier_invoice_number: 'FA 001' }];
    expect(isDuplicateNumber({ supplier_id: 's1', supplier_invoice_number: 'fa001' }, existing)).toBe(true);
    expect(isDuplicateNumber({ id: 'a', supplier_id: 's1', supplier_invoice_number: 'FA001' }, existing)).toBe(false);
    expect(isDuplicateNumber({ supplier_id: 's2', supplier_invoice_number: 'FA001' }, existing)).toBe(false);
  });

  it('validates the supplier record (ICE 15 digits, IF digits, delay 0–120)', () => {
    expect(supplierErrors({ name: 'Inox', ice: '001 234 567 000 089', if_number: '123', payment_days: 60 })).toEqual([]);
    expect(supplierErrors({ name: '', ice: '123', if_number: '12A', payment_days: 150, email: 'x' })).toEqual([
      'Indiquez la raison sociale.', 'L’ICE doit comporter exactement 15 chiffres (3 saisis).', 'L’identifiant fiscal (IF) ne contient que des chiffres.',
      'Le délai de paiement ne peut pas dépasser 120 jours (maximum légal, loi 69-21).', 'Adresse e-mail invalide.',
    ]);
  });

  it('counts the attestation de régularité fiscale for six months', () => {
    expect(certificateValidOn('2026-01-15', '2026-07-14')).toBe(true);
    expect(certificateValidOn('2026-01-15', '2026-07-15')).toBe(false);
    expect(certificateValidOn('2026-01-15', '2026-01-14')).toBe(false);
    expect(certificateValidOn(null, '2026-01-14')).toBe(false);
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });
});

describe('prefill and existing data', () => {
  it('turns purchase order costs (TTC) into HT lines, merging a product listed twice', () => {
    const lines = linesFromCosts([
      { barcode: 'P1', label: 'Four', quantity: 2, unitCostTtc: 1200 },
      { barcode: 'P2', label: 'Plat', quantity: 0, unitCostTtc: 50 },
      { barcode: 'P1', label: 'Four', quantity: 1, unitCostTtc: 600 },
    ], 20);
    expect(lines).toEqual([{ position: 0, label: 'Four', barcode: 'P1', quantity: 3, amount_ht: 2500, vat_rate: 20, vat_amount: 500, account_code: '6111', vat_nondeductible: false }]);
  });

  it('offers supplier records for names already used, without the ones that have one', () => {
    expect(supplierNameCandidates(['Inox Maroc', ' inox  maroc ', 'Atlas', '', null], ['Atlas', 'Sud Froid', 'Known'], [{ name: 'known' }])).toEqual([
      { name: 'Inox Maroc', orders: 2 }, { name: 'Atlas', orders: 1 }, { name: 'Sud Froid', orders: 0 },
    ]);
  });

  it('finds the supplier of a purchase order by id, provider or name', () => {
    const list = [{ id: 's1', name: 'Inox Maroc', provider_id: 'p9' }, { id: 's2', name: 'Atlas', provider_id: null }];
    expect(matchSupplier(list, { supplier_id: 's2' })?.id).toBe('s2');
    expect(matchSupplier(list, { provider_id: 'p9' })?.id).toBe('s1');
    expect(matchSupplier(list, { provider_name: ' atlas ' })?.id).toBe('s2');
    expect(matchSupplier(list, { provider_name: 'Autre' })).toBeUndefined();
  });

  it('counts quantities bought on validated invoices per product (goods lines only)', () => {
    const q = invoicedQuantities([
      { status: 'validated', lines: [line({ quantity: 2, amount_ht: 200 }), line({ account_code: '6141', barcode: 'P1', quantity: 9 })] },
      { status: 'paid', lines: [line({ quantity: 3, amount_ht: 300 })] },
      { status: 'draft', lines: [line({ quantity: 50 })] },
    ]);
    expect(q.get('P1')).toEqual({ quantity: 5, amountHt: 500 });
  });

  it('counts days overdue on validated invoices with something left to pay', () => {
    const inv = { status: 'validated' as const, due_date: '2026-05-09', total_ttc: 100, paid_amount: 0 };
    expect(overdueDays(inv, '2026-05-19')).toBe(10);
    expect(overdueDays({ ...inv, paid_amount: 100 }, '2026-05-19')).toBe(0);
    expect(overdueDays({ ...inv, status: 'draft' }, '2026-05-19')).toBe(0);
  });
});
