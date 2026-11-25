import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: true }),
}));

import {
  brandsOf, buildInvoicedStock, canSeeInvoicedStock, filterRecon, openingErrors, openingPayload, parseOpeningCsv, proposeOpening,
  reconTotals, returnKey, type InvoicedOpening, type PurchaseInvoiceInput, type ReconcileInput, type SalesDocInput,
} from '../inventory/lib/invoicedStock';
import { reconCsvRows, reconNotes, reconTitle } from '../inventory/lib/invoicedStockExport';
import { buildInvoicedStockPdf } from '../utils/invoicedStockPdf';
import { buildStockStatement, type ValuationProduct } from '../inventory/lib/stockValuation';
import { InvoicedStockSchemaMissingError, InvoicedStockService } from '../utils/supabaseInvoicedStock';
import { toCsv } from '../accounting/ledgerExport';
import { readAllConfig } from '../utils/readAll';

// ── A small company, used throughout ──────────────────────────────────────
// Four mixte: 12 in the warehouse, 132 TTC = 110 HT. Plat inox: 5, 24 TTC = 20 HT.
const products: ValuationProduct[] = [
  { barcode: 'P1', name: 'Four mixte', brand: 'ATA', stock_levels: { DEP: 12 }, buyprice: 132 },
  { barcode: 'P2', name: 'Plat inox', brand: 'Inoxa', stock_levels: { DEP: 5 }, buyprice: 24 },
  { barcode: 'P3', name: 'Bac gastro', brand: 'ATA', stock_levels: { DEP: 0 }, buyprice: 60 },
];
const real = (day = '2026-07-31') => buildStockStatement(products, [], { day, vatRate: 20 });
const opening = (asOf = '2026-06-30'): InvoicedOpening => ({ asOf, quantities: new Map([['P1', 10], ['P2', 3]]) });

const pinv = (id: string, date: string, lines: Array<[string | null, number | null, string?]>, over: Partial<PurchaseInvoiceInput> = {}): PurchaseInvoiceInput => ({
  id, company_id: 'c1', number: `FF-2026-${id}`, supplier_invoice_number: `S-${id}`, supplierName: 'Inox Maroc', invoice_date: date, status: 'validated',
  lines: lines.map(([barcode, quantity, account]) => ({ barcode, quantity, amount_ht: 100, account_code: account || '6111', label: barcode || 'Transport' })),
  ...over,
});
const item = (barcode: string | null, quantity: number, subtotal: number, name = 'Article') => ({
  id: `${barcode}-${quantity}`, quantity, subtotal, product: barcode ? { barcode, name } : { barcode: '', name }, quoteName: name,
});
const sdoc = (id: string, type: 'invoice' | 'avoir', date: string, items: ReturnType<typeof item>[], over: Partial<SalesDocInput> = {}): SalesDocInput => ({
  id, quoteNumber: id, document_type: type, status: 'final', issuing_company_id: 'c1', company_id: 'c1',
  quote_date: date, createdAt: `${date}T10:00:00Z`, customer: { fullName: 'Hôtel Atlas' }, tva_rate: 20, items, ...over,
});

const purchases = [
  pinv('0001', '2026-06-15', [['P1', 4]]),                                  // before the opening: inside it
  pinv('0002', '2026-07-10', [['P1', 5], [null, null, '6141'], ['P2', 2, '61111']]),
  pinv('0003', '2026-07-12', [['P1', 100]], { status: 'draft', number: null }), // draft: not a purchase
  pinv('0004', '2026-07-12', [['P1', 50]], { company_id: 'c2' }),              // another company's books
  pinv('0005', '2026-08-05', [['P1', 7]]),                                  // after the day
  pinv('0006', '2026-07-11', [['P2', 9, '6119']]),                           // a rebate account, not goods
];
const sales = [
  sdoc('FAC2607-1', 'invoice', '2026-07-15', [item('P1', 3, 600, 'Four mixte'), item(null, 1, 240, 'Installation')]),
  sdoc('FAC2607-2', 'invoice', '2026-07-16', [item('P1', 8, 1600)], { issuing_company_id: 'c2' }), // issued by c2
  sdoc('BROUILLON-ABC123', 'invoice', '2026-07-16', [item('P1', 9, 1800)], { status: 'draft' }),
  sdoc('FAC2606-9', 'invoice', '2026-06-20', [item('P1', 2, 400)], { issuing_company_id: null }),  // owner c1, before the opening
  sdoc('FAC2607-3', 'invoice', '2026-07-20', [item('P2', 4, 120)]),
  sdoc('AV-0001', 'avoir', '2026-07-18', [item('P1', 1, 200)], { parent_document_id: 'FAC2607-1' }),  // goods put back in stock
  sdoc('AV-0002', 'avoir', '2026-07-22', [item('P2', 1, 30)], { parent_document_id: 'FAC2607-3' }),   // not put back: a price reduction?
  sdoc('AV-0003', 'avoir', '2026-07-23', [], { totalAmount: 120 }),                                     // an amount only
  sdoc('BL-1', 'bl' as never, '2026-07-05', [item('P1', 50, 0)]),                                        // not an invoice
];
const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  companyId: 'c1', day: '2026-07-31', opening: opening(), purchases, sales,
  returnedToStock: new Set([returnKey('AV-0001', 'P1')]), real: real(), companyVatRate: 20, ...over,
});
const line = (rec: ReturnType<typeof buildInvoicedStock>, barcode: string) => rec.lines.find(l => l.barcode === barcode)!;

describe('invoiced stock: the count', () => {
  it('opening + validated goods purchases − issued sales + goods returned, next to the real stock', () => {
    const rec = buildInvoicedStock(input());
    // Four mixte: 10 + 5 − 3 + 1 = 13 invoiced, 12 in the warehouse: one more on the invoices.
    expect(line(rec, 'P1')).toMatchObject({ opening: 10, bought: 5, sold: 3, returned: 1, invoiced: 13, real: 12, gap: -1, unitCost: 110, gapValue: -110, invoicedValue: 1430, realValue: 1320 });
    // Plat inox: 3 + 2 − 4 = 1 invoiced, 5 in the warehouse.
    expect(line(rec, 'P2')).toMatchObject({ opening: 3, bought: 2, sold: 4, returned: 0, invoiced: 1, real: 5, gap: 4, unitCost: 20, gapValue: 80 });
    // Nothing for the Bac gastro: no stock, no document.
    expect(rec.lines.map(l => l.barcode)).toEqual(['P1', 'P2']);
    expect(rec.counted).toEqual({ purchaseInvoices: 1, salesInvoices: 2, creditNotes: 1 });
    expect(rec.hasOpening).toBe(true);
    expect(reconTotals(rec.lines)).toMatchObject({ references: 2, gapLines: 2, invoiced: 14, real: 17, gap: 3, gapValue: -30 });
  });

  it('lists the documents counted per product, with their direction', () => {
    const rec = buildInvoicedStock(input());
    expect(rec.docs.get('P1')!.map(d => [d.kind, d.number, d.date, d.quantity, d.party])).toEqual([
      ['purchase', 'FF-2026-0002', '2026-07-10', 5, 'Inox Maroc'],
      ['sale', 'FAC2607-1', '2026-07-15', 3, 'Hôtel Atlas'],
      ['return', 'AV-0001', '2026-07-18', 1, 'Hôtel Atlas'],
    ]);
  });

  it('leaves out documents on or before the opening date, and counts them without an opening', () => {
    const rec = buildInvoicedStock(input({ opening: null }));
    // From zero: 4 + 5 bought (FF-0001 counted now), 2 + 3 sold (FAC2606-9 counted now), 1 returned.
    expect(line(rec, 'P1')).toMatchObject({ opening: 0, bought: 9, sold: 5, returned: 1, invoiced: 5, gap: 7 });
    expect(rec.hasOpening).toBe(false);
    // A document dated on the opening day itself is part of the opening.
    const onTheDay = buildInvoicedStock(input({ opening: opening('2026-07-10') }));
    expect(line(onTheDay, 'P1')).toMatchObject({ opening: 10, bought: 0, sold: 3, returned: 1, invoiced: 8 });
  });

  it('follows the date: only documents on or before the end of the day', () => {
    const mid = buildInvoicedStock(input({ day: '2026-07-12', real: real('2026-07-12') }));
    expect(line(mid, 'P1')).toMatchObject({ bought: 5, sold: 0, returned: 0, invoiced: 15 });
    const late = buildInvoicedStock(input({ day: '2026-08-31', real: real('2026-08-31') }));
    expect(line(late, 'P1')).toMatchObject({ bought: 12, invoiced: 20 });
    // On the opening day the invoiced stock is the opening.
    const atOpening = buildInvoicedStock(input({ day: '2026-06-30', real: real('2026-06-30') }));
    expect(line(atOpening, 'P1')).toMatchObject({ opening: 10, bought: 0, sold: 0, invoiced: 10 });
    // Before it the count is not defined.
    const before = buildInvoicedStock(input({ day: '2026-06-29', real: real('2026-06-29') }));
    expect(before.beforeOpening).toBe(true);
    expect(before.counted).toEqual({ purchaseInvoices: 0, salesInvoices: 0, creditNotes: 0 });
  });

  it('ignores drafts, other companies, invoices issued by another company and non-goods accounts', () => {
    const rec = buildInvoicedStock(input({ opening: null, day: '2026-07-31' }));
    // Not the 100 of the draft, the 50 of c2, the 8 issued by c2, the 9 of the draft sale, the 50 of the BL, nor the 6119 rebate.
    expect(line(rec, 'P1').bought).toBe(9);
    expect(line(rec, 'P1').sold).toBe(5);
    expect(line(rec, 'P2').bought).toBe(2);
    // The invoice issued by c2 is in c2's count, from c2's point of view.
    const c2 = buildInvoicedStock(input({ companyId: 'c2', opening: null }));
    expect(line(c2, 'P1')).toMatchObject({ bought: 50, sold: 8 });
  });

  it('totals sales lines without a catalogue product apart', () => {
    const rec = buildInvoicedStock(input());
    expect(rec.uncounted).toMatchObject({ saleLines: 1, saleAmountHt: 200, creditLines: 0 });
    expect(rec.uncounted.items[0]).toMatchObject({ kind: 'sale', number: 'FAC2607-1', label: 'Installation', quantity: 1, amountHt: 200 });
    // A code typed by hand that is not in the catalogue is not counted either.
    const typed = buildInvoicedStock(input({ sales: [sdoc('FAC2607-8', 'invoice', '2026-07-21', [item('ZZ-99', 2, 360, 'Hotte sur mesure')])] }));
    expect(typed.uncounted).toMatchObject({ saleLines: 1, saleAmountHt: 300 });
    expect(typed.lines.find(l => l.barcode === 'ZZ-99')).toBeUndefined();
  });

  it('counts a credit note as goods returned only for the products it put back in stock', () => {
    const rec = buildInvoicedStock(input());
    expect(line(rec, 'P2').returned).toBe(0);
    expect(rec.creditNotes.unreturned).toEqual([expect.objectContaining({ id: 'AV-0002', lines: 1, quantity: 1, amountHt: 25 })]);
    expect(rec.creditNotes.withoutGoods).toEqual([expect.objectContaining({ id: 'AV-0003', amountHt: 100 })]);
    // On request, the ones not put back are counted as returns too.
    const all = buildInvoicedStock(input({ countUnreturnedCredits: true }));
    expect(line(all, 'P2')).toMatchObject({ returned: 1, invoiced: 2, gap: 3 });
    expect(all.counted.creditNotes).toBe(2);
    // The amount-only credit note never adds stock back.
    expect(all.lines.reduce((s, l) => s + l.returned, 0)).toBe(2);
    // A credit note that put back only one of its products: the other stays apart.
    const partial = buildInvoicedStock(input({
      sales: [sdoc('AV-0009', 'avoir', '2026-07-25', [item('P1', 2, 400), item('P2', 1, 30)])],
      returnedToStock: new Set([returnKey('AV-0009', 'P1')]),
    }));
    expect(line(partial, 'P1').returned).toBe(2);
    expect(line(partial, 'P2').returned).toBe(0);
    expect(partial.creditNotes.unreturned).toEqual([expect.objectContaining({ id: 'AV-0009', lines: 1 })]);
  });

  it('keeps references that are only on documents, and filters and lists brands', () => {
    const rec = buildInvoicedStock(input({ purchases: [...purchases, pinv('0007', '2026-07-02', [['OLD-1', 3]])] }));
    expect(line(rec, 'OLD-1')).toMatchObject({ name: 'OLD-1', inCatalogue: false, invoiced: 3, real: 0, gap: -3, unitCost: 0 });
    expect(brandsOf(rec.lines)).toEqual(['ATA', 'Inoxa']);
    expect(filterRecon(rec.lines, { brand: 'ATA' }).map(l => l.barcode)).toEqual(['P1']);
    expect(filterRecon(rec.lines, { search: 'inox plat' }).map(l => l.barcode)).toEqual(['P2']);
    const noGap = buildInvoicedStock(input({ opening: { asOf: '2026-06-30', quantities: new Map([['P1', 9], ['P2', 6]]) } }));
    expect(filterRecon(noGap.lines, { onlyGaps: true }).map(l => l.barcode)).toEqual(['P2']);
    expect(line(noGap, 'P1').gap).toBe(0);
  });

  it('is shown to the roles that read supplier invoices only', () => {
    expect(canSeeInvoicedStock({ isCompta: true })).toBe(true);
    expect(canSeeInvoicedStock({ isFacturation: true })).toBe(true);
    expect(canSeeInvoicedStock({ isAdmin: true })).toBe(true);
    expect(canSeeInvoicedStock({ isSuperAdmin: true })).toBe(true);
    expect(canSeeInvoicedStock({})).toBe(false);
  });
});

describe('invoiced stock: the opening', () => {
  it('proposes the real stock at the opening date, every non-zero quantity', () => {
    const atDate = buildStockStatement([...products, { barcode: 'P4', name: 'Grill', stock_levels: { DEP: -2 }, buyprice: 0 }], [
      { barcode: 'P1', location_key: 'DEP', type: 'in', quantity: 2, unit_cost: 132, created_at: '2026-07-05T10:00:00Z' },
    ], { day: '2026-06-30', vatRate: 20 });
    expect(proposeOpening(atDate)).toEqual([{ barcode: 'P1', quantity: 10 }, { barcode: 'P2', quantity: 5 }, { barcode: 'P4', quantity: -2 }]);
  });

  it('checks the opening before saving and drops zero lines', () => {
    expect(openingErrors('2026-06-30', [{ barcode: 'P1', quantity: 1 }], '2026-11-25')).toEqual([]);
    expect(openingErrors('', [], '2026-11-25')).toEqual(['Indiquez la date de l’ouverture.']);
    expect(openingErrors('2026-12-01', [], '2026-11-25')).toEqual(['La date de l’ouverture ne peut pas être dans le futur.']);
    expect(openingErrors('2026-06-30', [{ barcode: 'P1', quantity: 1 }, { barcode: 'P1', quantity: 2 }, { barcode: 'P2', quantity: NaN }, { barcode: ' ', quantity: 1 }]))
      .toEqual(['P1 : référence en double.', 'P2 : quantité invalide.', 'Une ligne n’a pas de référence.']);
    expect(openingPayload([{ barcode: ' P1 ', quantity: 0.1 + 0.2 }, { barcode: 'P2', quantity: 0 }])).toEqual([{ barcode: 'P1', quantity: 0.3 }]);
  });

  it('reads a CSV of reference;quantity and reports the lines it cannot read', () => {
    const text = '﻿Référence;Quantité\r\nP1;10\r\n"P2";2,5\r\n\r\nP3;abc\r\n;4\r\nP9;1\r\nP1;3\r\nP2,7\r\nP3;1;x\r\nP3\t-1\r\n';
    const { lines, problems } = parseOpeningCsv(text, new Set(['P1', 'P2', 'P3']));
    expect(lines).toEqual([{ barcode: 'P1', quantity: 10 }, { barcode: 'P2', quantity: 2.5 }, { barcode: 'P3', quantity: -1 }]);
    expect(problems.map(p => [p.line, p.reason])).toEqual([
      [5, 'quantité illisible'],
      [6, 'référence vide'],
      [7, 'référence inconnue du catalogue'],
      [8, 'référence déjà importée plus haut'],
      [9, 'séparateur « ; » manquant'],
      [10, 'plus de deux colonnes'],
    ]);
    // Without a header, the first line is data; "1 234,5" reads as 1234.5.
    expect(parseOpeningCsv('P1;1 234,5').lines).toEqual([{ barcode: 'P1', quantity: 1234.5 }]);
  });
});

describe('invoiced stock: saving and reading the opening', () => {
  beforeEach(() => {
    state.db = createFakeDb({});
    // The database function, as the migration defines it: one opening per company, lines replaced.
    state.db.rpc.replace_invoiced_stock_opening = ({ p_company_id, p_as_of, p_lines }: { p_company_id: string; p_as_of: string; p_lines: Array<{ barcode: string; quantity: number }> }) => {
      const t = state.db.tables;
      t.invoiced_stock_openings ||= [];
      t.invoiced_stock_opening_lines ||= [];
      let head = t.invoiced_stock_openings.find(o => o.company_id === p_company_id);
      if (!head) { head = { id: `o-${p_company_id}`, company_id: p_company_id }; t.invoiced_stock_openings.push(head); }
      Object.assign(head, { as_of: p_as_of, saved_by: 'sara', updated_at: '2026-11-25T10:00:00Z' });
      t.invoiced_stock_opening_lines = t.invoiced_stock_opening_lines.filter(l => l.opening_id !== head!.id);
      p_lines.forEach((l, i) => t.invoiced_stock_opening_lines.push({ id: `${head!.id}-${i}`, opening_id: head!.id, ...l }));
      return { id: head.id, as_of: p_as_of, lines: p_lines.length };
    };
  });
  afterEach(() => { readAllConfig.pageSize = 1000; });

  it('saves an opening, replaces it whole, and reads it back past the page size', async () => {
    expect(await InvoicedStockService.opening('c1')).toEqual({ opening: null, installed: true });
    expect(await InvoicedStockService.saveOpening('c1', '2026-06-30', [{ barcode: 'P1', quantity: 10 }, { barcode: 'P2', quantity: 0 }])).toBe(1);
    const first = (await InvoicedStockService.opening('c1')).opening!;
    expect(first.asOf).toBe('2026-06-30');
    expect([...first.quantities]).toEqual([['P1', 10]]);

    readAllConfig.pageSize = 2;
    await InvoicedStockService.saveOpening('c1', '2026-09-30', [1, 2, 3, 4, 5].map(i => ({ barcode: `R${i}`, quantity: i })));
    const second = (await InvoicedStockService.opening('c1')).opening!;
    expect(second.asOf).toBe('2026-09-30');
    expect([...second.quantities.keys()].sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    expect(second.quantities.has('P1')).toBe(false);
    expect(state.db.tables.invoiced_stock_openings).toHaveLength(1);
  });

  it('says to run the migration when the tables are not there', async () => {
    state.db.failRead = t => (t === 'invoiced_stock_openings' ? "Could not find the table 'public.invoiced_stock_openings' in the schema cache" : undefined);
    expect(await InvoicedStockService.opening('c1')).toEqual({ opening: null, installed: false });
    state.db.rpc.replace_invoiced_stock_opening = () => { throw new Error('Could not find the function public.replace_invoiced_stock_opening(p_as_of, p_company_id, p_lines) in the schema cache'); };
    const err = await InvoicedStockService.saveOpening('c1', '2026-06-30', [{ barcode: 'P1', quantity: 1 }]).catch(e => e);
    expect(err).toBeInstanceOf(InvoicedStockSchemaMissingError);
    expect(err.message).toBe('L’ouverture du stock facturé n’est pas encore installée : exécutez la migration 20261127130000_invoiced_stock.sql dans Supabase.');
  });

  it('reads validated supplier invoices of the company with their lines, and the products each credit note put back', async () => {
    state.db.tables.suppliers = [{ id: 's1', company_id: 'c1', name: 'Benali', first_name: 'Karim', legal_type: 'personne_physique' }];
    state.db.tables.supplier_invoices = [
      { id: 'i1', company_id: 'c1', number: 'FF-2026-0001', supplier_invoice_number: 'A1', supplier_id: 's1', invoice_date: '2026-07-10', status: 'paid' },
      { id: 'i2', company_id: 'c1', number: null, supplier_invoice_number: 'A2', supplier_id: 's1', invoice_date: '2026-07-11', status: 'draft' },
      { id: 'i3', company_id: 'c2', number: 'FF-2026-0001', supplier_invoice_number: 'B1', supplier_id: 's9', invoice_date: '2026-07-11', status: 'validated' },
    ];
    state.db.tables.supplier_invoice_lines = [
      { id: 'l1', invoice_id: 'i1', barcode: 'P1', quantity: '5', amount_ht: '500', account_code: '6111', label: 'Four' },
      { id: 'l2', invoice_id: 'i2', barcode: 'P1', quantity: 9, amount_ht: 900, account_code: '6111', label: 'Four' },
    ];
    const p = await InvoicedStockService.purchases('c1');
    expect(p.installed).toBe(true);
    expect(p.invoices).toEqual([expect.objectContaining({ id: 'i1', supplierName: 'Benali Karim', lines: [expect.objectContaining({ barcode: 'P1', quantity: 5, account_code: '6111' })] })]);

    state.db.tables.stock_movements = [
      { id: 'm1', source_type: 'return', source_id: 'AV-1', barcode: 'P1', quantity: 2 },
      { id: 'm2', source_type: 'return', source_id: 'RET-7', barcode: 'P2', quantity: 1 },
      { id: 'm3', source_type: 'bl', source_id: 'AV-1', barcode: 'P2', quantity: -1 },
    ];
    expect([...await InvoicedStockService.returnedToStock(['AV-1'])]).toEqual([returnKey('AV-1', 'P1')]);

    state.db.failRead = t => (t === 'supplier_invoices' ? "Could not find the table 'public.supplier_invoices' in the schema cache" : undefined);
    expect(await InvoicedStockService.purchases('c1')).toEqual({ invoices: [], installed: false });
  });
});

describe('invoiced stock: exports', () => {
  const rec = buildInvoicedStock(input());
  const ctx = { company: 'Cuisimat SARL', day: '2026-07-31', openingAsOf: '2026-06-30', producedAt: new Date(2026, 7, 1, 9, 5) };

  it('writes the CSV rows: heading, one row per reference, totals and notes', () => {
    const rows = reconCsvRows(rec.lines, rec, { ...ctx, filters: ['écarts seulement'] });
    expect(rows.slice(0, 8)).toEqual([
      ['Société', 'Cuisimat SARL'],
      ['État', 'Rapprochement stock facturé / stock réel au 31/07/2026'],
      ['Ouverture', 'au 30/06/2026'],
      ['Valorisation', 'Coût moyen pondéré (CMUP), hors taxe'],
      ['Écart', 'Écart = stock réel - stock facturé. Valeurs hors taxe au coût moyen pondéré à la date, signées.'],
      ['Filtres', 'écarts seulement'],
      ['Édité le', '01/08/2026 09:05'],
      ['Logiciel', 'Stocky'],
    ]);
    expect(rows[9]).toEqual(['Référence', 'Désignation', 'Marque', 'Ouverture', 'Acheté (factures fournisseurs)', 'Vendu (factures clients)', 'Retourné (avoirs)',
      'Stock facturé', 'Stock réel', 'Écart', 'Coût unitaire HT', 'Valeur stock facturé HT', 'Valeur stock réel HT', "Valeur de l'écart HT"]);
    expect(rows[10]).toEqual(['P1', 'Four mixte', 'ATA', '10', '5', '3', '1', '13', '12', '-1', '110,00', '1430,00', '1320,00', '-110,00']);
    expect(rows[11]).toEqual(['P2', 'Plat inox', 'Inoxa', '3', '2', '4', '0', '1', '5', '4', '20,00', '20,00', '100,00', '80,00']);
    expect(rows[13]).toEqual(['Total', '2 référence(s), 2 avec un écart', '', '13', '7', '7', '1', '14', '17', '3', '', '1450,00', '1420,00', '-30,00']);
    const notes = rows.slice(15).map(r => r[1]);
    expect(notes).toEqual([
      "Ouverture au 30/06/2026 : les factures datées de ce jour ou avant sont comprises dans l'ouverture.",
      '1 ligne(s) de factures sans article du catalogue (200,00 HT) : non comptées.',
      '1 avoir(s) avec des articles non remis en stock (25,00 HT) : traités comme des réductions de prix, non comptés.',
      "1 avoir(s) sans lignes d'articles (réductions de prix) : non comptés.",
      expect.stringMatching(/^Les avoirs fournisseurs .* ne sont pas encore gérés/),
      expect.stringMatching(/^Les ventes sont comptées dans la société qui a émis la facture/),
    ]);
    expect(toCsv(rows)).toContain('P1;Four mixte;ATA;10;5;3;1;13;12;-1;110,00;1430,00;1320,00;-110,00\r\n');
    expect(reconNotes(rec, { openingAsOf: null })[0]).toMatch(/^Aucune ouverture enregistrée : le stock facturé part de zéro/);
    expect(reconTitle('2026-12-31')).toBe('Rapprochement stock facturé / stock réel au 31/12/2026');
  });

  it('prints the PDF with the title, the lines, the totals, the notes and page numbers', () => {
    const text = buildInvoicedStockPdf(rec.lines, rec, {
      ...ctx, settings: { company_name: 'Cuisimat SARL', ice: '001234567000089', if_number: '12345678', rc: '9876' } as never,
    }).output();
    for (const s of ['Cuisimat SARL', 'ICE 001234567000089', 'Four mixte', 'Plat inox', '-110,00', '-30,00 MAD', 'Page 1 / 1']) expect(text).toContain(s);
    expect(text).toMatch(/RAPPROCHEMENT STOCK FACTUR. \/ STOCK R.EL AU 31\/07\/2026/);
    expect(text).toMatch(/Ouverture au 30\/06\/2026/);
    expect(text).toMatch(/non remis en stock/);
    expect(text).toMatch(/avoirs fournisseurs/);
  });
});
