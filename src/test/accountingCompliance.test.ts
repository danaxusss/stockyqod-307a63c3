import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { buildFecRows, checkFec, fecAmount, fecFileName, fecText, FEC_COLUMNS, type FecInput } from '../accounting/fec';
import { cmBaseFromBalances, estimateCorporateTax, isRate, resultBeforeTaxFromBalances } from '../accounting/corporateTax';
import {
  defaultAccountsFor, degressiveRefusal, depreciationSchedule, dotationForYear, expenseAccountHint, netBookValue,
  nonDeductibleDepreciation, passengerCarCap, ASSET_PRESETS,
} from '../accounting/depreciation';
import { balancesOf, buildOpeningLines, decideNewFiscalYear } from '../accounting/fiscalYears';
import { validateEntryLines } from '../accounting/entryValidation';
import { buildBilan } from '../accounting/bilan';
import { grandLivreRows, journalRows, reportHeader, toCsv } from '../accounting/ledgerExport';
import { PCM_SEED } from '../accounting/pcmSeed';
import { AccountingService } from '../utils/supabaseAccounting';
import { AssetsService, type FixedAsset } from '../utils/supabaseAssets';
import type { FiscalYear } from '../types';

beforeEach(() => {
  state.db = createFakeDb({ accounting_fiscal_years: [], journal_entries: [], journal_entry_lines: [], accounts: [], journals: [] });
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(() => { vi.useRealTimers(); });

const fy = (label: string, status: 'open' | 'closed' = 'open'): FiscalYear => ({
  id: `fy${label}`, company_id: 'c1', label, start_date: `${label}-01-01`, end_date: `${label}-12-31`, status, closed_at: null, closed_by: null,
});

// ── FEC ──────────────────────────────────────────────────────────────────────
describe('FEC', () => {
  const input: FecInput = {
    journals: [{ id: 'jv', code: 'VT', label: 'Ventes' }, { id: 'ja', code: 'AN', label: 'À-nouveaux' }],
    accounts: [
      { id: 'a1', code: '3421', label: 'Clients' }, { id: 'a2', code: '7111', label: 'Ventes de marchandises' },
      { id: 'a3', code: '4455', label: 'État - TVA facturée' }, { id: 'a4', code: '5141', label: 'Banque' },
      { id: 'a5', code: '1111', label: 'Capital social' }, { id: 'aux1', code: '3421001', label: 'Client\tA' },
    ],
    entries: [
      { id: 'v2', journal_id: 'jv', entry_number: 2, entry_date: '2026-03-10', reference: 'FA-2', label: 'Facture 2', status: 'reversed', posted_at: '2026-03-10T10:00:00Z' },
      { id: 'v1', journal_id: 'jv', entry_number: 1, entry_date: '2026-03-01', reference: 'FA-1', label: 'Facture 1', status: 'posted', posted_at: '2026-03-02T08:00:00Z' },
      { id: 'an', journal_id: 'ja', entry_number: 1, entry_date: '2026-01-01', reference: 'AN 2026', label: 'À-nouveaux', status: 'posted', posted_at: '2026-01-15T08:00:00Z' },
      { id: 'd1', journal_id: 'jv', entry_number: null, entry_date: '2026-04-01', reference: null, label: 'Brouillon', status: 'draft', posted_at: null },
    ],
    lines: [
      { entry_id: 'v1', account_code: '3421', aux_account_id: 'aux1', label: 'Client A', debit: 1200, credit: 0, lettrage_code: 'AA', lettered_at: '2026-04-02T09:00:00Z', sort_order: 0 },
      { entry_id: 'v1', account_code: '7111', label: null, debit: 0, credit: 1000, sort_order: 1 },
      { entry_id: 'v1', account_code: '4455', label: 'TVA', debit: 0, credit: 200, sort_order: 2 },
      { entry_id: 'v2', account_code: '3421', debit: 1234567.5, credit: 0, sort_order: 0 },
      { entry_id: 'v2', account_code: '7111', debit: 0, credit: 1234567.5, sort_order: 1 },
      { entry_id: 'an', account_code: '5141', debit: 500, credit: 0, sort_order: 0 },
      { entry_id: 'an', account_code: '1111', debit: 0, credit: 500, sort_order: 1 },
      { entry_id: 'd1', account_code: '3421', debit: 99, credit: 0, sort_order: 0 },
    ],
  };

  it('has one row per booked line, ordered by journal and number, drafts left out', () => {
    const rows = buildFecRows(input);
    expect(rows).toHaveLength(7);
    expect(rows.map(r => r.Num_Ecriture)).toEqual(['AN-000001', 'AN-000001', 'VT-000001', 'VT-000001', 'VT-000001', 'VT-000002', 'VT-000002']);
    const first = rows[2];
    expect(first).toMatchObject({
      Code_Journal: 'VT', Libelle_Journal: 'Ventes', Date_Ecriture: '20260301', Num_Compte: '3421', Libelle_Compte: 'Clients',
      Num_Compte_Aux: '3421001', Libelle_Compte_Aux: 'Client A', Ref_Piece: 'FA-1', Date_Piece: '20260301', Libelle_Ecriture: 'Client A',
      Montant_Debit: '1200,00', Montant_Credit: '0,00', Lettrage_Ecriture: 'AA', Date_Lettrage: '20260402', Date_Validation: '20260302',
      Montant_Devise: '', Id_Devise: '',
    });
    // The entry label stands in for a line without one.
    expect(rows[3].Libelle_Ecriture).toBe('Facture 1');
    expect(rows[5].Montant_Debit).toBe('1234567,50');
  });

  it('writes a tab-separated text file with the avis 24 header and a dated name', () => {
    const txt = fecText(buildFecRows(input));
    expect(txt.endsWith('\r\n')).toBe(true);
    const lines = txt.slice(0, -2).split('\r\n');
    expect(lines[0].split('\t')).toEqual([...FEC_COLUMNS]);
    expect(lines).toHaveLength(8);
    expect(lines.every(l => l.split('\t').length === 18)).toBe(true);
    expect(fecAmount(0.1 + 0.2)).toBe('0,30');
    expect(fecAmount(-5)).toBe('-5,00');
    expect(fecFileName({ if_number: '12 345 678', ice: '001' }, '2026-12-31')).toBe('FEC_12345678_20261231.txt');
    expect(fecFileName({ if_number: '', ice: '001234567000089' }, '2026-12-31')).toBe('FEC_001234567000089_20261231.txt');
  });

  it('passes the controls on sound books and reports the drafts left out', () => {
    const c = checkFec(input, { draftCount: 1 });
    expect(c.errors).toEqual([]);
    expect(c.totalDebit).toBe(c.totalCredit);
    expect(c.entryCount).toBe(3);
    expect(c.warnings.join(' ')).toMatch(/1 écriture en brouillon/);
  });

  it('reports an unbalanced entry, a gap or repeat in the numbering and an account missing from the chart', () => {
    const bad: FecInput = {
      ...input,
      entries: [...input.entries, { id: 'v4', journal_id: 'jv', entry_number: 4, entry_date: '2026-05-01', reference: 'X', label: 'X', status: 'posted', posted_at: '2026-05-01' },
        { id: 'v4b', journal_id: 'jv', entry_number: 4, entry_date: '2026-05-02', reference: 'Y', label: 'Y', status: 'posted', posted_at: '2026-05-02' }],
      lines: [...input.lines,
        { entry_id: 'v4', account_code: '9999', debit: 10, credit: 0 }, { entry_id: 'v4', account_code: '7111', debit: 0, credit: 9 },
        { entry_id: 'v4b', account_code: '5141', debit: 1, credit: 0 }, { entry_id: 'v4b', account_code: '7111', debit: 0, credit: 1 }],
    };
    const c = checkFec(bad);
    const all = c.errors.join('\n');
    expect(all).toMatch(/Total débit 1236278,50 ≠ total crédit 1236277,50/);
    expect(all).toMatch(/VT n° 4 déséquilibrée/);
    expect(all).toMatch(/VT : numérotation interrompue, manque 3/);
    expect(all).toMatch(/VT : numéro\(s\) en double 4/);
    expect(all).toMatch(/absent\(s\) du plan comptable : 9999/);
  });

  it('is read past the 1,000-row server cap, drafts counted apart', async () => {
    state.db.maxRows = 1000;
    for (let i = 0; i < 1100; i++) {
      state.db.tables.journal_entries.push({ id: `e${String(i).padStart(5, '0')}`, company_id: 'c1', fiscal_year_id: 'fy', journal_id: 'jv', entry_number: i + 1, status: 'posted', entry_date: '2026-02-01' });
      state.db.tables.journal_entry_lines.push(
        { id: `l${i}a`, entry_id: `e${String(i).padStart(5, '0')}`, account_code: '3421', debit: 1, credit: 0 },
        { id: `l${i}b`, entry_id: `e${String(i).padStart(5, '0')}`, account_code: '7111', debit: 0, credit: 1 },
      );
    }
    state.db.tables.journal_entries.push({ id: 'dr', company_id: 'c1', fiscal_year_id: 'fy', journal_id: 'jv', status: 'draft', entry_date: '2026-02-01' });
    const data = await AccountingService.fecData('fy');
    expect(data.entries).toHaveLength(1100);
    expect(data.lines).toHaveLength(2200);
    expect(data.draftCount).toBe(1);
  });
});

// ── Closing and fiscal years ─────────────────────────────────────────────────
describe('closing', () => {
  it('carries a profit to 1191 (credit) and a loss to 1199 (debit)', () => {
    const profit = buildOpeningLines(balancesOf([
      { account_code: '5141', debit: 1500, credit: 0 }, { account_code: '1111', debit: 0, credit: 1000 }, { account_code: '7111', debit: 0, credit: 500 },
    ]));
    expect(profit.find(l => l.account_code === '1191')).toMatchObject({ debit: 0, credit: 500 });
    expect(profit.some(l => l.account_code === '1199' || l.account_code === '7111')).toBe(false);

    const loss = buildOpeningLines(balancesOf([
      { account_code: '5141', debit: 700, credit: 0 }, { account_code: '1111', debit: 0, credit: 1000 }, { account_code: '6111', debit: 300, credit: 0 },
    ]));
    expect(loss.find(l => l.account_code === '1199')).toMatchObject({ debit: 300, credit: 0 });
    expect(loss.some(l => l.account_code === '1191')).toBe(false);
    const sum = (ls: typeof loss) => Math.round(ls.reduce((s, l) => s + l.debit - l.credit, 0) * 100);
    expect(sum(profit)).toBe(0);
    expect(sum(loss)).toBe(0);
  });

  it('books the loss of a closed year on 1199 in the opening entry, adding 1199 to an older chart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-10T10:00:00'));
    state.db.tables.accounting_fiscal_years.push(fy('2025'));
    state.db.tables.journals = [{ id: 'j-od', company_id: 'c1', code: 'OD', type: 'od' }, { id: 'j-an', company_id: 'c1', code: 'AN', type: 'anouveaux' }];
    state.db.tables.accounts = ['1111', '1191', '5141', '6111'].map(code => ({ id: code, company_id: 'c1', code, label: code, class: Number(code[0]) }));
    state.db.tables.journal_entries.push({ id: 'e1', company_id: 'c1', fiscal_year_id: 'fy2025', journal_id: 'j-od', status: 'posted', entry_date: '2025-06-01', entry_number: 1 });
    state.db.tables.journal_entry_lines.push(
      { id: 'l1', entry_id: 'e1', account_code: '6111', debit: 300, credit: 0 },
      { id: 'l2', entry_id: 'e1', account_code: '5141', debit: 0, credit: 300 },
    );
    state.db.rpc.post_journal_entry = ({ p_entry_id }: { p_entry_id: string }) => {
      const e = state.db.tables.journal_entries.find(x => x.id === p_entry_id)!;
      Object.assign(e, { status: 'posted', entry_number: 1 });
      return e;
    };
    const res = await AccountingService.closeExercice(fy('2025'), 'u');
    expect(res.newYearLabel).toBe('2026');
    const an = state.db.tables.journal_entries.find(e => e.source_type === 'anouveaux')!;
    const lines = state.db.tables.journal_entry_lines.filter(l => l.entry_id === an.id);
    expect(lines.find(l => l.account_code === '1199')).toMatchObject({ debit: 300, credit: 0 });
    expect(state.db.tables.accounts.some(a => a.code === '1199')).toBe(true);
    expect(state.db.tables.accounting_fiscal_years.find(y => y.label === '2025')?.status).toBe('closed');
  });
});

describe('fiscal years: two open at most, no date far ahead', () => {
  const today = '2026-11-25';

  it('opens the next year while only one is open, up to one year ahead', () => {
    expect(decideNewFiscalYear([fy('2026')], '2027-01-05', today)).toMatchObject({ ok: true, label: '2027', start_date: '2027-01-01', end_date: '2027-12-31' });
    expect(decideNewFiscalYear([fy('2025', 'closed'), fy('2026')], '2027-11-25', today).ok).toBe(true);
    expect(decideNewFiscalYear([], '2026-03-01', today).ok).toBe(true);
  });

  it('refuses a third open year', () => {
    const d = decideNewFiscalYear([fy('2025'), fy('2026')], '2027-01-05', today);
    expect(d.ok).toBe(false);
    expect(d.message).toBe('Clôturez l\'exercice 2025 avant d\'ouvrir l\'exercice 2027 : deux exercices au plus peuvent être ouverts.');
  });

  it('refuses a date more than one year ahead (a mistyped 2062) and a year before a closed one', () => {
    expect(decideNewFiscalYear([fy('2026')], '2062-03-01', today).message).toMatch(/^Date hors exercice : le 01\/03\/2062/);
    expect(decideNewFiscalYear([fy('2026')], '2027-11-26', today).ok).toBe(false);
    expect(decideNewFiscalYear([fy('2025', 'closed'), fy('2026')], '2024-05-01', today).message).toMatch(/2025 est déjà clôturé/);
  });

  it('refuses the entry instead of creating the year, and the pages still load', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:00:00'));
    state.db.tables.accounting_fiscal_years.push(fy('2025'), fy('2026'));
    state.db.tables.journals = [{ id: 'j-od', company_id: 'c1', code: 'OD', type: 'od' }];
    const lines = [{ account_code: '6111', debit: 10, credit: 0 }, { account_code: '4411', debit: 0, credit: 10 }];
    await expect(AccountingService.createEntry({ journal_id: 'j-od', entry_date: '2062-01-05' }, lines)).rejects.toThrow(/Date hors exercice/);
    await expect(AccountingService.createEntry({ journal_id: 'j-od', entry_date: '2027-01-05' }, lines)).rejects.toThrow(/Clôturez l'exercice 2025/);
    expect(state.db.tables.accounting_fiscal_years).toHaveLength(2);
    expect(state.db.tables.journal_entries).toHaveLength(0);

    // In 2027 with 2025 and 2026 still open, today's year cannot be opened: the latest open year is shown.
    vi.setSystemTime(new Date('2027-02-01T10:00:00'));
    expect((await AccountingService.ensureCurrentFiscalYear()).label).toBe('2026');
  });

  it('removes an empty open year, never one with entries', async () => {
    state.db.tables.accounting_fiscal_years.push(fy('2062'), fy('2026'));
    state.db.tables.journal_entries.push({ id: 'e', company_id: 'c1', fiscal_year_id: 'fy2026', status: 'draft', entry_date: '2026-01-02' });
    await expect(AccountingService.deleteEmptyFiscalYear(fy('2026'))).rejects.toThrow(/contient des écritures/);
    await AccountingService.deleteEmptyFiscalYear(fy('2062'));
    expect(state.db.tables.accounting_fiscal_years.map(y => y.label)).toEqual(['2026']);
  });
});

// ── Corporate tax ────────────────────────────────────────────────────────────
describe('corporate tax estimate', () => {
  it('applies one proportional rate to the whole profit, by year', () => {
    expect(isRate(2025, 300_000)).toBe(0.175);
    expect(isRate(2025, 300_000.01)).toBe(0.20);
    expect(isRate(2025, 1_000_000)).toBe(0.20);
    expect(isRate(2025, 1_000_000.01)).toBe(0.2275);
    expect(isRate(2025, 100_000_000)).toBe(0.34);
    expect(isRate(2024, 200_000)).toBe(0.15);
    expect(isRate(2023, 5_000_000)).toBe(0.2825);
    expect(isRate(2026, 200_000)).toBe(0.20);
    expect(isRate(2026, 5_000_000)).toBe(0.20);
    expect(isRate(2026, 100_000_000)).toBe(0.35);
    // A later year keeps the last rates until a finance law adds a row.
    expect(isRate(2030, 150_000_000)).toBe(0.35);
  });

  it('2025, small profit: IS at 17.5 %; 2026 instalments at the 2026 rate (transition)', () => {
    const e = estimateCorporateTax({ year: 2025, resultBeforeTax: 200_000, cmBase: 2_000_000 });
    expect(e).toMatchObject({ rate: 0.175, isAmount: 35_000, cmAmount: 5_000, cmApplies: false, isDue: 35_000, css: 0, netResult: 165_000, instalmentYear: 2026 });
    expect(e.instalments).toEqual([
      { due: '2026-03-31', amount: 10_000 }, { due: '2026-06-30', amount: 10_000 },
      { due: '2026-09-30', amount: 10_000 }, { due: '2026-12-31', amount: 10_000 },
    ]);
  });

  it('2026, small profit: IS at 20 %, instalments of 25 %', () => {
    const e = estimateCorporateTax({ year: 2026, resultBeforeTax: 200_000, cmBase: 2_000_000 });
    expect(e).toMatchObject({ isAmount: 40_000, isDue: 40_000 });
    expect(e.instalments.map(i => i.amount)).toEqual([10_000, 10_000, 10_000, 10_000]);
  });

  it('2025, 800,000: the 20 % rate; 2,000,000: 22.75 % on the whole profit and CSS 1.5 %', () => {
    expect(estimateCorporateTax({ year: 2025, resultBeforeTax: 800_000, cmBase: 5_000_000 }).isDue).toBe(160_000);
    const e = estimateCorporateTax({ year: 2025, resultBeforeTax: 2_000_000, cmBase: 30_000_000 });
    expect(e).toMatchObject({ rate: 0.2275, isAmount: 455_000, cmAmount: 75_000, isDue: 455_000, cssRate: 0.015, css: 30_000, netResult: 1_515_000 });
  });

  it('2026, 2,000,000: 20 % and CSS 1.5 %; 6,000,000 in 2025: CSS 2.5 % of the whole profit', () => {
    expect(estimateCorporateTax({ year: 2026, resultBeforeTax: 2_000_000, cmBase: 30_000_000 })).toMatchObject({ isDue: 400_000, css: 30_000 });
    expect(estimateCorporateTax({ year: 2025, resultBeforeTax: 6_000_000, cmBase: 50_000_000 })).toMatchObject({ isDue: 1_365_000, cssRate: 0.025, css: 150_000 });
    expect(estimateCorporateTax({ year: 2026, resultBeforeTax: 999_999, cmBase: 0 }).css).toBe(0);
    expect(estimateCorporateTax({ year: 2026, resultBeforeTax: 150_000_000, cmBase: 0 })).toMatchObject({ isDue: 52_500_000, css: 7_500_000 });
    // CSS runs until 2028 (art. 273).
    expect(estimateCorporateTax({ year: 2029, resultBeforeTax: 2_000_000, cmBase: 0 }).css).toBe(0);
  });

  it('cotisation minimale: 0.25 % of turnover when higher than the IS', () => {
    const e = estimateCorporateTax({ year: 2026, resultBeforeTax: 10_000, cmBase: 4_000_000 });
    expect(e).toMatchObject({ isAmount: 2_000, cmAmount: 10_000, cmApplies: true, isDue: 10_000 });
    expect(e.instalments.map(i => i.amount)).toEqual([2_500, 2_500, 2_500, 2_500]);
  });

  it('a loss still pays the 3,000 MAD minimum, in one instalment', () => {
    const e = estimateCorporateTax({ year: 2026, resultBeforeTax: -50_000, cmBase: 1_000_000 });
    expect(e).toMatchObject({ isAmount: 0, cmAmount: 3_000, cmApplies: true, isDue: 3_000, css: 0, netResult: -53_000 });
    expect(e.instalments).toEqual([{ due: '2027-03-31', amount: 3_000 }]);
  });

  it('takes the base and the result from the balances: 711/712/718/73x in, reprises out, tax booked set aside', () => {
    const bal = new Map<string, number>([
      ['7111', -1_000_000], ['7119', 20_000], ['7124', -200_000], ['7138', -50_000], ['7191', -30_000], ['7381', -10_000], ['7394', -5_000],
      ['6111', 600_000], ['6701', 40_000],
    ]);
    expect(cmBaseFromBalances(bal)).toBe(1_190_000);
    expect(resultBeforeTaxFromBalances(bal)).toEqual({ result: 675_000, taxBooked: 40_000 });
  });

  it('creates the draft entry 6701 / 4453 once, adding both accounts to an older chart', async () => {
    state.db.tables.accounts = [{ id: 'x', company_id: 'c1', code: '1111', label: 'Capital', class: 1 }];
    state.db.tables.journals = [{ id: 'j-od', company_id: 'c1', code: 'OD', type: 'od' }];
    state.db.tables.accounting_fiscal_years.push(fy('2026'));
    await AccountingService.createCorporateTaxDraft(fy('2026'), 40_000, 'u');
    const e = state.db.tables.journal_entries[0];
    expect(e).toMatchObject({ status: 'draft', entry_date: '2026-12-31', source_id: 'is:fy2026' });
    const lines = state.db.tables.journal_entry_lines.filter(l => l.entry_id === e.id);
    expect(lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['6701', 40_000, 0], ['4453', 0, 40_000]]);
    expect(state.db.tables.accounts.map(a => a.code).sort()).toEqual(['1111', '4453', '6701']);
    await expect(AccountingService.createCorporateTaxDraft(fy('2026'), 40_000, 'u')).rejects.toThrow(/existe déjà/);
  });
});

// ── Chart of accounts ────────────────────────────────────────────────────────
describe('chart of accounts', () => {
  it('seeds the accounts a trading company needs, without the 14 % and 7 % VAT', () => {
    const codes = new Set(PCM_SEED.map(a => a.code));
    for (const c of ['1199', '4453', '4457', '3453', '3456', '6119', '7119', '6701', '6192', '6193', '2332', '2822']) expect(codes.has(c)).toBe(true);
    expect(codes.has('44552')).toBe(false);
    expect(codes.has('44557')).toBe(false);
    expect(new Set(PCM_SEED.filter(a => a.vat_rate != null).map(a => a.vat_rate))).toEqual(new Set([20, 10]));
  });

  it('deactivates an account only without entry lines, renames only accounts the company created', async () => {
    const sys = { id: 'a1', company_id: 'c1', code: '44552', label: 'TVA 14%', class: 4, is_system: true, active: true };
    const own = { id: 'a2', company_id: 'c1', code: '61251', label: 'Eau', class: 6, is_system: false, active: true };
    const used = { id: 'a3', company_id: 'c1', code: '6111', label: 'Achats', class: 6, is_system: true, active: true };
    state.db.tables.accounts = [sys, own, used];
    state.db.tables.journal_entry_lines.push({ id: 'l', company_id: 'c1', entry_id: 'e', account_code: '6111', debit: 1, credit: 0 });
    await AccountingService.setAccountActive(sys as never, false);
    expect(state.db.tables.accounts[0].active).toBe(false);
    await expect(AccountingService.setAccountActive(used as never, false)).rejects.toThrow(/a des écritures/);
    await expect(AccountingService.updateAccountLabel(sys as never, 'x')).rejects.toThrow(/ne se modifie pas/);
    await AccountingService.updateAccountLabel(own as never, '  Eau et électricité ');
    expect(state.db.tables.accounts[1].label).toBe('Eau et électricité');
    await expect(AccountingService.createAccount({ code: '6111', label: 'X', class: 6, type: 'charge' })).rejects.toThrow(/existe déjà/);
  });
});

// ── Fixed assets ─────────────────────────────────────────────────────────────
describe('depreciation schedules', () => {
  const asset = (over: Partial<FixedAsset> = {}) => ({
    account_code: '2340', acquisition_date: '2026-01-01', amount: 100_000, salvage: 0, duration_years: 5, method: 'lineaire', depreciations: [], ...over,
  }) as FixedAsset;

  it('linear with a salvage value: the salvage is never depreciated', () => {
    const a = asset({ amount: 110_000, salvage: 10_000, acquisition_date: '2026-04-01' });
    const s = depreciationSchedule(a);
    expect(s.map(r => [r.year, r.months, r.amount])).toEqual([[2026, 9, 15_000], [2027, 12, 20_000], [2028, 12, 20_000], [2029, 12, 20_000], [2030, 12, 20_000], [2031, 3, 5_000]]);
    expect(s[s.length - 1]).toMatchObject({ cumulative: 100_000, netBookValue: 10_000 });
    expect(netBookValue({ ...a, depreciations: [{ year: 2026, amount: 15_000 }] })).toBe(95_000);
    expect(netBookValue({ ...a, depreciations: s.map(r => ({ year: r.year, amount: r.amount })) })).toBe(10_000);
  });

  it('declining balance from 1 January: 40 % then the straight line of what is left', () => {
    // 5 years → coefficient 2 → 40 %. Year 4: 21,600 / 2 = 10,800 > 8,640.
    const s = depreciationSchedule(asset({ method: 'degressif' }));
    expect(s.map(r => r.amount)).toEqual([40_000, 24_000, 14_400, 10_800, 10_800]);
    expect(s[4].netBookValue).toBe(0);
  });

  it('declining balance from 1 July: prorated first year, six years in all', () => {
    const s = depreciationSchedule(asset({ method: 'degressif', acquisition_date: '2026-07-15' }));
    expect(s.map(r => [r.year, r.amount])).toEqual([[2026, 20_000], [2027, 32_000], [2028, 19_200], [2029, 11_520], [2030, 11_520], [2031, 5_760]]);
    expect(s[5].months).toBe(6);
    // 4 years → 1.5 × 25 % = 37.5 %; 10 years → 3 × 10 % = 30 %.
    expect(depreciationSchedule(asset({ method: 'degressif', duration_years: 4 }))[0].amount).toBe(37_500);
    expect(depreciationSchedule(asset({ method: 'degressif', duration_years: 10 }))[0].amount).toBe(30_000);
  });

  it('declining balance follows the dotations actually booked', () => {
    const booked = asset({ method: 'degressif', depreciations: [{ year: 2026, amount: 40_000 } as never] });
    expect(dotationForYear(booked, 2027)).toBe(24_000);
  });

  it('refuses the declining balance for buildings, passenger cars and short durations', () => {
    expect(degressiveRefusal({ account_code: '2321', duration_years: 20 })).toMatch(/constructions/);
    expect(degressiveRefusal({ account_code: '2340', passenger_car: true, duration_years: 5 })).toMatch(/voiture/);
    expect(degressiveRefusal({ account_code: '2355', duration_years: 2 })).toMatch(/3 ans/);
    expect(degressiveRefusal({ account_code: '2332', duration_years: 10 })).toBeNull();
  });

  it('charges each asset class to its own dotation account; presets agree with the seed', () => {
    expect(defaultAccountsFor('2111')).toEqual({ depreciation: '2811', expense: '6191' });
    expect(defaultAccountsFor('2220')).toEqual({ depreciation: '2822', expense: '6192' });
    expect(defaultAccountsFor('2340')).toEqual({ depreciation: '2834', expense: '6193' });
    expect(expenseAccountHint({ account_code: '2340', expense_account_code: '6191' })).toBe('6193');
    expect(expenseAccountHint({ account_code: '2340', expense_account_code: '6193' })).toBeNull();
    const seed = new Set(PCM_SEED.map(a => a.code));
    for (const p of ASSET_PRESETS) {
      expect([p.account_code, p.depreciation_account_code, p.expense_account_code].every(c => seed.has(c))).toBe(true);
      expect(defaultAccountsFor(p.account_code)).toEqual({ depreciation: p.depreciation_account_code, expense: p.expense_account_code });
    }
  });
});

describe('passenger cars', () => {
  it('caps the deductible value at 400,000 MAD from 2025, 300,000 before', () => {
    expect(passengerCarCap('2025-01-01')).toBe(400_000);
    expect(passengerCarCap('2024-12-31')).toBe(300_000);
    const car = { account_code: '2340', acquisition_date: '2025-01-10', amount: 500_000, duration_years: 5, passenger_car: true, method: 'lineaire' };
    expect(nonDeductibleDepreciation(car, 100_000)).toBe(20_000);
    expect(nonDeductibleDepreciation(car, dotationForYear({ ...car, acquisition_date: '2025-03-01' }, 2025))).toBe(16_666.67);
    expect(nonDeductibleDepreciation({ ...car, acquisition_date: '2024-06-01', amount: 400_000 }, 80_000)).toBe(20_000);
    expect(nonDeductibleDepreciation({ ...car, amount: 350_000 }, 70_000)).toBe(0);
    expect(nonDeductibleDepreciation({ ...car, passenger_car: false }, 100_000)).toBe(0);
  });
});

describe('asset deletion', () => {
  const a = { id: 'as1', company_id: 'c1', label: 'Camion', account_code: '2340', acquisition_date: '2026-01-01', amount: 100, duration_years: 5, salvage: 0, method: 'lineaire', depreciation_account_code: '2834', expense_account_code: '6193' } as FixedAsset;

  it('is refused once a dotation was booked, allowed before', async () => {
    state.db.tables.fixed_assets = [{ ...a }, { ...a, id: 'as2' }];
    state.db.tables.journal_entries.push({ id: 'e', company_id: 'c1', source_type: 'depreciation', source_id: 'amort:as1:2026', status: 'posted' });
    await expect(AssetsService.remove({ ...a, depreciations: [{ id: 'd', asset_id: 'as1', year: 2026, amount: 20, entry_id: 'e' }] })).rejects.toThrow(/ne peut pas être supprimée/);
    // Even when the depreciation row is gone, the entry still refers to the asset.
    await expect(AssetsService.remove({ ...a, depreciations: [] })).rejects.toThrow(/ne peut pas être supprimée/);
    await AssetsService.remove({ ...a, id: 'as2', depreciations: [] });
    expect(state.db.tables.fixed_assets.map(x => x.id)).toEqual(['as1']);
  });

  it('a new vehicle is charged to 6193 unless the form says otherwise', async () => {
    state.db.tables.fixed_assets = [];
    await AssetsService.create({ label: 'Camion', account_code: '2340', acquisition_date: '2026-01-01', amount: 100_000 });
    expect(state.db.tables.fixed_assets[0]).toMatchObject({ depreciation_account_code: '2834', expense_account_code: '6193' });
    expect('passenger_car' in state.db.tables.fixed_assets[0]).toBe(false);
    await expect(AssetsService.create({ label: 'Voiture', account_code: '2340', acquisition_date: '2026-01-01', amount: 100_000, method: 'degressif', passenger_car: true })).rejects.toThrow(/voiture/);
  });
});

// ── Manual entries ───────────────────────────────────────────────────────────
describe('manual entry validation', () => {
  const chart = [{ code: '6111', active: true }, { code: '4411', active: true }, { code: '44552', active: false }];

  it('accepts a balanced entry on active accounts', () => {
    const c = validateEntryLines([
      { account_code: '6111', debit: 100, credit: 0 }, { account_code: '4411', debit: 0, credit: 100 }, { account_code: '', debit: 0, credit: 0 },
    ], chart, { forPosting: true });
    expect(c.errors).toEqual([]);
    expect(c.lines).toHaveLength(2);
    expect(c.balanced).toBe(true);
  });

  it('refuses a line with both a debit and a credit, a negative amount, an unknown or inactive account', () => {
    const c = validateEntryLines([
      { account_code: '6111', debit: 100, credit: 5 },
      { account_code: '4411', debit: -20, credit: 0 },
      { account_code: '9999', debit: 0, credit: 10 },
      { account_code: '44552', debit: 0, credit: 65 },
      { account_code: '', debit: 3, credit: 0 },
    ], chart, { forPosting: true });
    expect(c.errors).toEqual([
      'Ligne 1 : saisissez soit un débit, soit un crédit, pas les deux.',
      'Ligne 2 : un montant ne peut pas être négatif.',
      'Ligne 3 : le compte 9999 n\'existe pas dans le plan comptable.',
      'Ligne 4 : le compte 44552 est désactivé.',
      'Ligne 5 : compte manquant.',
      'Écriture déséquilibrée : le total des débits doit égaler celui des crédits.',
    ]);
  });

  it('allows an unbalanced draft but not its posting', () => {
    const lines = [{ account_code: '6111', debit: 100, credit: 0 }, { account_code: '4411', debit: 0, credit: 90 }];
    expect(validateEntryLines(lines, chart).errors).toEqual([]);
    expect(validateEntryLines(lines, chart, { forPosting: true }).errors).toHaveLength(1);
  });
});

// ── Bilan ────────────────────────────────────────────────────────────────────
describe('bilan', () => {
  // Capital paid in the bank, a vehicle on a loan and its depreciation,
  // purchases and sales with VAT, a VAT credit carried on 4456, a customer
  // who paid more than invoiced, a supplier paid from an overdrawn account.
  const lines = [
    ['5141', 100_000, 0], ['1111', 0, 100_000],
    ['2340', 50_000, 0], ['1481', 0, 50_000],
    ['6193', 2_000, 0], ['2834', 0, 2_000],
    ['6111', 50_000, 0], ['34552', 10_000, 0], ['4411', 0, 60_000],
    ['3421', 36_000, 0], ['7111', 0, 30_000], ['4455', 0, 6_000],
    ['4455', 6_000, 0], ['34552', 0, 6_000], ['4456', 4_000, 0], ['34552', 0, 4_000],
    ['5141', 40_000, 0], ['3421', 0, 40_000],
    ['4411', 20_000, 0], ['5143', 0, 20_000],
  ].map(([account_code, debit, credit]) => ({ account_code: String(account_code), debit: Number(debit), credit: Number(credit) }));

  it('puts each balance on its side, the result on its own line, totals equal', () => {
    const b = buildBilan(balancesOf(lines), c => `L${c}`);
    const section = (side: 'actif' | 'passif', key: string) => b[side].find(s => s.key === key)!;
    expect(section('actif', 'immobilise')).toMatchObject({ total: 48_000 });
    expect(section('actif', 'circulant').lines).toEqual([{ code: '4456', label: 'L4456', amount: 4_000 }]);
    expect(section('actif', 'tresorerie_actif').total).toBe(140_000);
    expect(section('passif', 'capitaux').total).toBe(150_000);
    expect(section('passif', 'dettes').lines.map(l => [l.code, l.amount])).toEqual([['3421', 4_000], ['4411', 40_000]]);
    expect(section('passif', 'tresorerie_passif').total).toBe(20_000);
    expect(b.resultat).toBe(-22_000);
    expect(b.totalActif).toBe(192_000);
    expect(b.totalPassif).toBe(192_000);
  });
});

// ── Ledger CSV ───────────────────────────────────────────────────────────────
describe('ledger CSV exports', () => {
  const ctx = { company: 'Société A', report: 'Grand livre - tous les comptes', fiscalYear: fy('2026'), producedAt: new Date(2026, 10, 25, 9, 5) };
  const lines = [
    { account_code: '5141', entry_date: '2026-02-01', entry_number: 2, journal_id: 'jb', reference: 'R2', label: 'Règlement', debit: 0, credit: 300 },
    { account_code: '5141', entry_date: '2026-01-15', entry_number: 1, journal_id: 'jb', reference: 'R1', label: '=cmd', debit: 1000.5, credit: 0 },
    { account_code: '3421', entry_date: '2026-01-15', entry_number: 1, journal_id: 'jb', reference: 'R1', label: 'Client; A', debit: 0, credit: 1000.5 },
  ];

  it('opens with the company, the report, the year, the date produced and the software', () => {
    const csv = toCsv([...reportHeader(ctx), ...grandLivreRows(lines, ['3421', '5141'], c => `L${c}`, () => 'BQ')]);
    expect(csv.startsWith('﻿Société;Société A\r\nÉtat;Grand livre - tous les comptes\r\nExercice;2026 (du 01/01/2026 au 31/12/2026)\r\n')).toBe(true);
    expect(csv).toContain('Édité le;25/11/2026 09:05\r\nLogiciel;Stocky\r\n');
    expect(csv).toContain('5141;L5141;15/01/2026;BQ;1;R1;\'=cmd;1000,50;0,00;1000,50;');
    expect(csv).toContain('5141;L5141;01/02/2026;BQ;2;R2;Règlement;0,00;300,00;700,50;');
    expect(csv).toContain('3421;L3421;15/01/2026;BQ;1;R1;"Client; A";0,00;1000,50;-1000,50;');
    expect(csv).toContain(';Total général;;;;;;1000,50;1300,50;-300,00;');
  });

  it('lists a journal in number order with its totals', () => {
    const rows = journalRows(lines, c => `L${c}`);
    expect(rows[1][0]).toBe(1);
    expect(rows[rows.length - 1]).toEqual(['', '', '', '', '', 'Totaux', '1000,50', '1300,50']);
  });
});
