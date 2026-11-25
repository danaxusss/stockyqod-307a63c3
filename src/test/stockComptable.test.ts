import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import {
  averageCostAtDate, buildStockStatement, dayEndInstant, exclVat, inventoryCsvRows, isOpeningBalance, levelValue, movementsAfter,
  quantitiesAtDate, statementTotals, vatRuleText, type ValuationMovement, type ValuationProduct,
} from '../inventory/lib/stockValuation';
import { buildStockEntryLines, openingStockBalance, stockEntryAmounts, stockEntryState, stockVariation } from '../accounting/stockEntry';
import { balancesOf } from '../accounting/fiscalYears';
import { resultBeforeTaxFromBalances } from '../accounting/corporateTax';
import { buildBilan } from '../accounting/bilan';
import { buildFecRows } from '../accounting/fec';
import { toCsv } from '../accounting/ledgerExport';
import { AccountingService } from '../utils/supabaseAccounting';
import { StockService } from '../utils/supabaseStock';
import { buildStockInventoryPdf } from '../utils/stockInventoryPdf';
import type { FiscalYear } from '../types';

let seq = 0;
const mv = (over: Partial<ValuationMovement> & Pick<ValuationMovement, 'quantity' | 'created_at'>): ValuationMovement => ({
  id: `m${++seq}`, barcode: 'P1', location_key: 'DEP', type: Number(over.quantity) >= 0 ? 'in' : 'out', unit_cost: null,
  reason: null, source_type: 'manual', created_by: 'u', ...over,
});
const product = (over: Partial<ValuationProduct> = {}): ValuationProduct => ({ barcode: 'P1', name: 'Four', brand: 'ATA', stock_levels: { DEP: 10 }, buyprice: 110, ...over });

// The year end 31/12/2025 ends at 23:00 UTC (Morocco is UTC+1 in winter).
const BEFORE = '2025-12-20T10:00:00Z';
const AFTER = '2026-01-10T10:00:00Z';
const AFTER2 = '2026-02-10T10:00:00Z';

describe('stock at a date: quantities', () => {
  it('ends the day at local midnight in Casablanca', () => {
    expect(new Date(dayEndInstant('2025-12-31')).toISOString()).toBe('2025-12-31T23:00:00.000Z');
    const late = [mv({ quantity: 1, created_at: '2025-12-31T22:59:59Z' }), mv({ quantity: 2, created_at: '2025-12-31T23:30:00Z' })];
    // 23:30 UTC is 00:30 on 1 January in Casablanca: after the year end.
    expect(movementsAfter(late, '2025-12-31').map(m => m.quantity)).toEqual([2]);
  });

  it('takes the current level and undoes only the movements after the date', () => {
    const p = product({ stock_levels: { DEP: 7 } });
    const later = movementsAfter([
      mv({ quantity: 4, created_at: BEFORE }),          // before: already in the level at the date
      mv({ quantity: 5, created_at: AFTER }),           // received after
      mv({ quantity: -2, created_at: AFTER2 }),         // sold after
    ], '2025-12-31');
    expect(quantitiesAtDate(p, later)).toEqual({ DEP: 4 });
  });

  it('follows a transfer between locations, and counts and reversals as the deltas they are', () => {
    const p = product({ stock_levels: { DEP: 3, SHOW: 5, VIDE: 'n/a' } });
    const later = movementsAfter([
      mv({ type: 'transfer_out', quantity: -4, location_key: 'DEP', created_at: AFTER }),
      mv({ type: 'transfer_in', quantity: 4, location_key: 'SHOW', created_at: AFTER }),
      mv({ type: 'count', quantity: -1, location_key: 'SHOW', source_type: 'count', created_at: AFTER2 }),
      mv({ type: 'adjustment', quantity: 2, location_key: 'DEP', source_type: 'reversal', created_at: AFTER2 }),
    ], '2025-12-31');
    expect(quantitiesAtDate(p, later)).toEqual({ DEP: 5, SHOW: 2, VIDE: 0 });
  });

  it('keeps the stock of a product without movements, and stock that predates the movements', () => {
    expect(quantitiesAtDate(product({ stock_levels: { DEP: 12 } }), [])).toEqual({ DEP: 12 });
    // The first migration recorded the existing level without changing it.
    const opening = mv({ type: 'count', quantity: 12, source_type: 'count', reason: "Solde d'ouverture", created_by: 'system', created_at: AFTER });
    expect(isOpeningBalance(opening)).toBe(true);
    expect(quantitiesAtDate(product({ stock_levels: { DEP: 12 } }), [opening])).toEqual({ DEP: 12 });
    expect(levelValue('3.5')).toBe(3.5);
    expect(levelValue('abc')).toBe(0);
    expect(levelValue(-2)).toBe(-2);
  });

  it('lists quantities per location and keeps only the locations in scope', () => {
    const p = product({ stock_levels: { DEP: 3, SHOW: 5, AUTRE: 9 } });
    const [line] = buildStockStatement([p], [mv({ quantity: 2, location_key: 'SHOW', created_at: AFTER })], {
      day: '2025-12-31', vatRate: 20, keyInScope: k => k !== 'AUTRE',
    });
    expect(line.byKey).toEqual({ DEP: 3, SHOW: 3 });
    expect(line.quantity).toBe(6);
  });
});

describe('stock at a date: average cost', () => {
  it('undoes one receipt after the date with the posting formula', () => {
    // 5 at 80 at the year end, then 5 received at 140: (5×80 + 5×140) / 10 = 110 now.
    const p = product({ stock_levels: { DEP: 10 }, buyprice: 110 });
    const later = movementsAfter([mv({ quantity: 5, unit_cost: 140, created_at: AFTER })], '2025-12-31');
    expect(averageCostAtDate(p, later)).toEqual({ cost: 80, fallback: null });
  });

  it('undoes two receipts newest first, the stock total over every location, sales in between', () => {
    // At the date: 10 at 50 (DEP 6, SHOW 4). Receipt 10 @ 80 → 65; sale −4 (16 left); receipt 4 @ 100 → (16×65 + 400) / 20 = 72.
    const p = product({ stock_levels: { DEP: 12, SHOW: 8 }, buyprice: 72 });
    const later = movementsAfter([
      mv({ quantity: 10, unit_cost: 80, location_key: 'DEP', created_at: AFTER }),
      mv({ quantity: -4, location_key: 'DEP', created_at: '2026-01-20T10:00:00Z' }),
      mv({ quantity: 4, unit_cost: 100, location_key: 'SHOW', created_at: AFTER2 }),
    ], '2025-12-31');
    expect(averageCostAtDate(p, later)).toEqual({ cost: 50, fallback: null });
    expect(quantitiesAtDate(p, later)).toEqual({ DEP: 6, SHOW: 4 });
  });

  it('falls back to the current cost, marked, after a receipt without a cost', () => {
    const p = product({ stock_levels: { DEP: 10 }, buyprice: 110 });
    const later = movementsAfter([mv({ quantity: 5, unit_cost: null, created_at: AFTER })], '2025-12-31');
    expect(averageCostAtDate(p, later)).toEqual({ cost: 110, fallback: 'receipt_without_cost' });
  });

  it('falls back when the stock would be zero or less before a receipt, and when there is no cost', () => {
    // Sold out at the date, 5 received at 140 since: the cost before cannot be known.
    const p = product({ stock_levels: { DEP: 5 }, buyprice: 140 });
    const later = movementsAfter([mv({ quantity: 5, unit_cost: 140, created_at: AFTER })], '2025-12-31');
    expect(averageCostAtDate(p, later)).toEqual({ cost: 140, fallback: 'stock_not_positive' });
    expect(averageCostAtDate(product({ buyprice: 0 }), [])).toEqual({ cost: 0, fallback: 'no_cost' });
    // A cost edited by hand since makes the undo absurd: current cost, marked.
    const odd = product({ stock_levels: { DEP: 10 }, buyprice: 20 });
    expect(averageCostAtDate(odd, movementsAfter([mv({ quantity: 5, unit_cost: 300, created_at: AFTER })], '2025-12-31')).fallback).toBe('inconsistent');
  });
});

describe('stock at a date: value', () => {
  it('values excluding VAT: purchase prices are stored including VAT', () => {
    expect(exclVat(120, 20)).toBe(100);
    expect(exclVat(110, 10)).toBe(100);
    expect(vatRuleText(20)).toMatch(/^Valeur hors taxe : .*TTC.*1,20.*20 %/);
  });

  it('shows a negative quantity, flags it, values it at zero and leaves it out of the totals', () => {
    const lines = buildStockStatement([
      product({ barcode: 'A', stock_levels: { DEP: 4 }, buyprice: 120 }),
      product({ barcode: 'B', stock_levels: { DEP: -3 }, buyprice: 60 }),
      product({ barcode: 'C', stock_levels: { DEP: 0 }, buyprice: 60 }),
      product({ barcode: 'D', stock_levels: { DEP: 2.5 }, buyprice: 0 }),
    ], [], { day: '2026-11-25', vatRate: 20 });
    const [a, b, , d] = lines;
    expect(a).toMatchObject({ quantity: 4, unitCostTtc: 120, unitCost: 100, value: 400, currentCost: false, negative: false });
    expect(b).toMatchObject({ quantity: -3, unitCost: 50, value: 0, negative: true });
    expect(d).toMatchObject({ quantity: 2.5, value: 0, currentCost: true, fallbackReason: 'no_cost' });
    expect(statementTotals(lines)).toEqual({ references: 2, quantity: 6.5, value: 400, fallbackLines: 1, negativeLines: 1 });
  });
});

describe('stock entry builder', () => {
  it('cancels the opening stock and records the closing stock through 6114', () => {
    expect(buildStockEntryLines({ opening: 2000, closing: 3500, endDate: '2026-12-31' }).map(l => [l.account_code, l.debit, l.credit])).toEqual([
      ['6114', 2000, 0], ['3111', 0, 2000], ['3111', 3500, 0], ['6114', 0, 3500],
    ]);
    expect(stockVariation(2000, 3500)).toBe(-1500);
  });

  it('leaves out a pair whose amount is zero, refuses both zero', () => {
    expect(buildStockEntryLines({ opening: 0, closing: 800, endDate: '2026-12-31' }).map(l => [l.account_code, l.debit, l.credit])).toEqual([['3111', 800, 0], ['6114', 0, 800]]);
    expect(buildStockEntryLines({ opening: 800, closing: 0, endDate: '2026-12-31' }).map(l => [l.account_code, l.debit, l.credit])).toEqual([['6114', 800, 0], ['3111', 0, 800]]);
    expect(() => buildStockEntryLines({ opening: 0, closing: 0, endDate: '2026-12-31' })).toThrow(/aucune écriture/);
    expect(() => buildStockEntryLines({ opening: 10, closing: -1, endDate: '2026-12-31' })).toThrow(/négatif/);
  });

  it('reads the opening stock without the stock entries and their reversals, and the amounts back', () => {
    const lines = [
      { entry_id: 'an', account_code: '3111', debit: 2000, credit: 0, source_type: 'anouveaux', source_id: 'an:fy' },
      { entry_id: 's1', account_code: '3111', debit: 0, credit: 2000, source_type: 'manual', source_id: 'stock:fy' },
      { entry_id: 's1', account_code: '3111', debit: 900, credit: 0, source_type: 'manual', source_id: 'stock:fy' },
      { entry_id: 'r1', account_code: '3111', debit: 2000, credit: 900, source_type: 'reversal', source_id: 's1' },
    ];
    expect(openingStockBalance(lines, 'fy', new Set(['s1']))).toBe(2000);
    expect(stockEntryAmounts(buildStockEntryLines({ opening: 2000, closing: 900, endDate: '2026-12-31' }))).toEqual({ opening: 2000, closing: 900 });
    expect(stockEntryState([{ id: 'a', status: 'reversed' }]).state).toBe('none');
    expect(stockEntryState([{ id: 'a', status: 'reversed' }, { id: 'b', status: 'draft' }]).state).toBe('draft');
    expect(stockEntryState([{ id: 'a', status: 'posted', entry_number: 4 }]).entry?.entry_number).toBe(4);
  });
});

// ── Through the fake database ─────────────────────────────────────────────
const fy = (label: string): FiscalYear => ({ id: `fy${label}`, company_id: 'c1', label, start_date: `${label}-01-01`, end_date: `${label}-12-31`, status: 'open', closed_at: null, closed_by: null });

beforeEach(() => {
  state.db = createFakeDb({
    accounting_fiscal_years: [fy('2026')],
    journals: [{ id: 'j-od', company_id: 'c1', code: 'OD', type: 'od' }],
    accounts: ['1111', '3421', '4411', '6111', '7111'].map(code => ({ id: code, company_id: 'c1', code, label: code, class: Number(code[0]) })),
    journal_entries: [], journal_entry_lines: [],
  });
  let n = 10;
  state.db.rpc.post_journal_entry = ({ p_entry_id }: { p_entry_id: string }) => {
    const e = state.db.tables.journal_entries.find(x => x.id === p_entry_id)!;
    Object.assign(e, { status: 'posted', entry_number: ++n });
    return e;
  };
  // Inserted rows get an id like the database default.
  let ids = 0;
  const original = state.db.failWrite;
  state.db.failWrite = (table, op, payload) => {
    if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) r.id ??= `${table}-${++ids}`;
    return original?.(table, op, payload);
  };
});
afterEach(() => { vi.useRealTimers(); });

function postEntry(id: string, lines: Array<[string, number, number]>, extra: Record<string, unknown> = {}) {
  state.db.tables.journal_entries.push({ id, company_id: 'c1', fiscal_year_id: 'fy2026', journal_id: 'j-od', status: 'posted', entry_date: '2026-06-01', entry_number: 1, ...extra });
  lines.forEach(([account_code, debit, credit], i) => state.db.tables.journal_entry_lines.push({ id: `${id}-${i}`, entry_id: id, company_id: 'c1', account_code, debit, credit, sort_order: i }));
}

describe('year-end stock entry in the books', () => {
  it('is created once per year as a draft, replaced while a draft, refused once posted, possible again once reversed', async () => {
    await AccountingService.saveStockEntryDraft(fy('2026'), { opening: 2000, closing: 3500 }, 'sara');
    const entries = () => state.db.tables.journal_entries.filter(e => e.source_id === 'stock:fy2026');
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ status: 'draft', entry_date: '2026-12-31', journal_id: 'j-od', reference: 'STOCK 2026' });
    expect(state.db.tables.accounts.map(a => a.code)).toEqual(expect.arrayContaining(['3111', '6114']));

    // The count found less: the draft is replaced, not duplicated.
    const res = await AccountingService.saveStockEntryDraft(fy('2026'), { opening: 2000, closing: 3200 }, 'sara');
    expect(res.replaced).toBe(true);
    expect(entries()).toHaveLength(1);
    const id = entries()[0].id;
    expect(state.db.tables.journal_entry_lines.filter(l => l.entry_id === id).map(l => [l.account_code, l.debit, l.credit]))
      .toEqual([['6114', 2000, 0], ['3111', 0, 2000], ['3111', 3200, 0], ['6114', 0, 3200]]);

    await AccountingService.postEntry(id, 'sara');
    await expect(AccountingService.saveStockEntryDraft(fy('2026'), { opening: 2000, closing: 3000 }, 'sara')).rejects.toThrow(/déjà validée \(n° 11\).*contre-passez-la/);

    // Reversed in Saisie: a corrected entry may be made.
    entries()[0].status = 'reversed';
    await AccountingService.saveStockEntryDraft(fy('2026'), { opening: 2000, closing: 3000 }, 'sara');
    expect(entries().map(e => e.status).sort()).toEqual(['draft', 'reversed']);
  });

  it('refuses an entry with nothing to record', async () => {
    await expect(AccountingService.saveStockEntryDraft(fy('2026'), { opening: 0, closing: 0 }, 'sara')).rejects.toThrow(/aucune écriture de stock/);
    expect(state.db.tables.journal_entries).toHaveLength(0);
  });

  it('changes the result of the year by the stock variation once posted; the bilan and the FEC take it from the ledger', async () => {
    postEntry('an', [['3111', 2000, 0], ['1111', 0, 2000]], { entry_date: '2026-01-01', source_type: 'anouveaux' });
    postEntry('buy', [['6111', 10_000, 0], ['4411', 0, 10_000]], { entry_number: 2 });
    postEntry('sale', [['3421', 15_000, 0], ['7111', 0, 15_000]], { entry_number: 3 });
    const resultNow = async () => resultBeforeTaxFromBalances(balancesOf(await AccountingService.getPostedLines('fy2026'))).result;
    expect(await resultNow()).toBe(5000);

    const lines = await AccountingService.getPostedLines('fy2026');
    const opening = openingStockBalance(lines, 'fy2026', new Set());
    expect(opening).toBe(2000);
    const { entry } = await AccountingService.saveStockEntryDraft(fy('2026'), { opening, closing: 3500 }, 'sara');
    // A draft changes nothing.
    expect(await resultNow()).toBe(5000);
    await AccountingService.postEntry(entry.id, 'sara');
    // Stock went up by 1,500 (6114 credit): the result goes up by as much.
    expect(await resultNow()).toBe(5000 - stockVariation(2000, 3500));
    expect(await resultNow()).toBe(6500);

    const balances = balancesOf(await AccountingService.getPostedLines('fy2026'));
    const bilan = buildBilan(balances);
    expect(bilan.actif.find(s => s.key === 'circulant')?.lines.find(l => l.code === '3111')?.amount).toBe(3500);
    expect(bilan.resultat).toBe(6500);
    expect(bilan.totalActif).toBe(bilan.totalPassif);

    const fec = await AccountingService.fecData('fy2026');
    const rows = buildFecRows({ ...fec, journals: [{ id: 'j-od', code: 'OD', label: 'Opérations diverses' }], accounts: [] });
    expect(rows.filter(r => r.Num_Compte === '6114').map(r => [r.Montant_Debit, r.Montant_Credit])).toEqual([['2000,00', '0,00'], ['0,00', '3500,00']]);

    // The 3111 balance at the year end now matches the valued stock.
    expect((await AccountingService.accountBalanceAt('3111', '2026-12-31'))?.balance).toBe(3500);
    expect((await AccountingService.accountBalanceAt('3111', '2026-06-30'))?.balance).toBe(2000);
    expect(await AccountingService.accountBalanceAt('3111', '2024-12-31')).toBeNull();
  });
});

describe('movements after a date are read past the 1,000-row cap', () => {
  it('reads every page', async () => {
    state.db.maxRows = 1000;
    state.db.tables.stock_movements = Array.from({ length: 2500 }, (_, i) => ({
      id: `m${String(i).padStart(5, '0')}`, barcode: 'P1', location_key: 'DEP', type: 'out', quantity: -1, unit_cost: null,
      created_at: i < 100 ? '2025-12-01T10:00:00.000Z' : '2026-01-05T10:00:00.000Z',
    }));
    const rows = await StockService.getMovementsSince(new Date(dayEndInstant('2025-12-31')).toISOString());
    expect(rows).toHaveLength(2400);
  });
});

describe('inventory exports', () => {
  const lines = () => buildStockStatement([
    product({ barcode: 'P-ÉTÉ', name: 'Plancha électrique à gaz, très longue désignation qui passe à la ligne dans le tableau', brand: 'Cuisimat', stock_levels: { DEP: 3, SHOW: 1.5 }, buyprice: 1200 }),
    product({ barcode: 'P2', name: 'Bac gastro', brand: '', stock_levels: { DEP: -2 }, buyprice: 60 }),
    product({ barcode: 'P3', name: 'Four mixte', stock_levels: { DEP: 2 }, buyprice: 0 }),
  ], [], { day: '2025-12-31', vatRate: 20 });

  it('writes the CSV with its heading lines, comma decimals and totals', () => {
    const rows = inventoryCsvRows(lines(), { company: 'Cuisimat SARL', day: '2025-12-31', vatRate: 20, producedAt: new Date(2026, 0, 15, 9, 5), keyLabel: k => (k === 'DEP' ? 'Dépôt' : k) });
    expect(rows.slice(0, 7)).toEqual([
      ['Société', 'Cuisimat SARL'],
      ['État', 'Inventaire détaillé au 31/12/2025'],
      ['Méthode', 'Coût moyen pondéré (CMUP), hors taxe'],
      ['Valeur hors taxe', expect.stringContaining('divisé par 1,20')],
      ['Emplacement', 'Tous les emplacements'],
      ['Édité le', '15/01/2026 09:05'],
      ['Logiciel', 'Stocky'],
    ]);
    expect(rows[8]).toEqual(['Référence', 'Désignation', 'Marque', 'Quantité', 'Coût unitaire HT', 'Valeur HT', 'Coût retenu', 'Détail par emplacement']);
    expect(rows[9]).toEqual(['P-ÉTÉ', expect.stringContaining('Plancha'), 'Cuisimat', '4,5', '1000,00', '4500,00', 'coût à la date', 'Dépôt 3 | SHOW 1,5']);
    expect(rows[10].slice(3, 6)).toEqual(['-2', '50,00', '0,00']);
    expect(rows[11][6]).toBe("coût actuel (aucun coût d'achat)");
    expect(rows[13]).toEqual(['Total', '2 références en stock', '', '6,5', '', '4500,00', '']);
    expect(rows.slice(14).map(r => r[1])).toEqual([expect.stringMatching(/^1 ligne\(s\) en quantité négative/), expect.stringMatching(/^1 ligne\(s\) valorisée\(s\) au coût moyen actuel/)]);
    const csv = toCsv(rows);
    expect(csv.startsWith('\uFEFFSociété;Cuisimat SARL\r\n')).toBe(true);
    // A negative quantity is written as a number, not escaped as a formula.
    expect(csv).toContain('P2;Bac gastro;;-2;50,00;0,00;');
  });

  it('prints the PDF with the identifiers, the title, the lines, the totals and page numbers', () => {
    const text = buildStockInventoryPdf(lines(), {
      day: '2025-12-31', vatRate: 20, producedAt: new Date(2026, 0, 15, 9, 5),
      settings: { company_name: 'Cuisimat SARL', ice: '001234567000089', if_number: '12345678', rc: '9876', address: 'Bd Zerktouni, Casablanca' } as never,
    }).output();
    for (const s of ['Cuisimat SARL', 'ICE 001234567000089', 'IF 12345678', 'RC 9876', 'Bac gastro', 'Four mixte', '4 500,00 MAD', '1 000,00', 'Page 1 / 1']) expect(text).toContain(s);
    // Accented text (WinAnsi bytes in the PDF) and the long name wrapped over two lines.
    expect(text).toMatch(/INVENTAIRE D.TAILL. AU 31\/12\/2025/);
    expect(text).toMatch(/M.thode : Co.t moyen pond.r. \\\(CMUP\\\), hors taxe/);
    expect(text).toContain("les prix d'achat sont saisis TTC");
    expect(text).toMatch(/\(Plancha .lectrique/);
    expect(text).not.toMatch(/\(Plancha [^)]*tableau\) Tj/);
    expect(text).toMatch(/quantit. n.gative/);
    expect(text).toMatch(/\(0,00 \*\)/);
  });
});
