import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { buildPaymentEntries, buildPayslipEntry } from '../accounting/postingRules';
import { computeAnciennete, periodEnd } from '../utils/payrollCalc';
import { AssetsService, type FixedAsset } from '../utils/supabaseAssets';
import { AccountingService } from '../utils/supabaseAccounting';
import { PayrollRunService } from '../utils/supabasePayrollRun';
import type { Payslip, Quote } from '../types';

const balance = (lines: { debit: number; credit: number }[]) =>
  Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100 + 0;

beforeEach(() => {
  state.db = createFakeDb({ accounting_fiscal_years: [], journal_entries: [], journal_entry_lines: [] });
  try { localStorage.clear(); } catch { /* */ }
});

describe('customer payments', () => {
  const invoice = {
    id: 'inv1', quoteNumber: 'CM2610-1', totalAmount: 10000, createdAt: new Date('2026-10-02'),
    customer: { fullName: 'Client A' }, payment_method: 'Virement bancaire', payment_date: '2026-10-05',
    avance_amount: 4000, payment_methods_json: [{ method: 'Espèces', amount: 6000, reference: '', bank: '' }],
  } as unknown as Quote;

  it('books every payment, including one recorded after the first was booked', () => {
    const all = buildPaymentEntries(invoice, 0, 0);
    expect(all.map(d => [d.journalType, d.lines[0].debit, d.sourceId])).toEqual([
      ['banque', 4000, 'inv1:pay'], ['caisse', 6000, 'inv1:pay:1'],
    ]);
    const rest = buildPaymentEntries(invoice, 4000, 1);
    expect(rest.map(d => [d.lines[0].debit, d.sourceId])).toEqual([[6000, 'inv1:pay:1']]);
    expect(buildPaymentEntries(invoice, 10000, 2)).toEqual([]);
    expect(rest.every(d => balance(d.lines) === 0)).toBe(true);
  });
});

describe('payslip entry', () => {
  it('charges TFP and clears advances on 3488, balanced', () => {
    const p = {
      id: 'p1', period_month: 2, period_year: 2026, payslip_number: 'PAIE-2026-001',
      total_gross: 10000, cnss_employee: 268.8, amo_employee: 226, cimr_employee: 0, ir_amount: 800,
      cnss_employer: 538.8, amo_employer: 411, alloc_familiales: 640, tfp_employer: 160,
      other_deductions: 1200, net_salary: 10000 - 268.8 - 226 - 800 - 1200,
    } as unknown as Payslip;
    const e = buildPayslipEntry(p, 'Ali', 1000);
    expect(e.date).toBe('2026-02-28');
    expect(e.lines.find(l => l.account_code === '3488')?.credit).toBe(1000);
    expect(e.lines.find(l => l.account_code === '4488')?.credit).toBe(200);
    expect(e.lines.find(l => l.label === 'Charges patronales')?.debit).toBe(1749.8);
    expect(balance(e.lines)).toBe(0);
  });
});

describe('seniority', () => {
  it('is measured at the end of the pay month, in completed years', () => {
    expect(computeAnciennete('2021-03-15', 10000, periodEnd(2, 2026)).rate).toBe(0.05);
    expect(computeAnciennete('2021-03-15', 10000, periodEnd(3, 2026)).rate).toBe(0.10);
    expect(computeAnciennete('2024-03-31', 10000, periodEnd(3, 2026)).rate).toBe(0.05);
  });
});

describe('depreciation', () => {
  it('is prorated from the month of acquisition, the remainder in the last year', () => {
    const a = { amount: 100000, salvage: 0, duration_years: 5, acquisition_date: '2026-10-01', depreciations: [] } as unknown as FixedAsset;
    expect(AssetsService.dotationForYear(a, 2026)).toBe(5000);
    expect(AssetsService.dotationForYear(a, 2025)).toBe(0);
    const late = { ...a, depreciations: [2026, 2027, 2028, 2029, 2030].map(year => ({ year, amount: year === 2026 ? 5000 : 20000 })) } as FixedAsset;
    expect(AssetsService.dotationForYear(late, 2031)).toBe(15000);
  });
});

describe('fiscal years', () => {
  beforeEach(() => {
    state.db.tables.accounting_fiscal_years.push({ id: 'fy26', company_id: 'c1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' });
    state.db.tables.journals = [{ id: 'j-od', company_id: 'c1', code: 'OD', type: 'od' }];
  });

  it('files an entry in the year of its date, creating that year when needed', async () => {
    const e = await AccountingService.createEntry({ journal_id: 'j-od', entry_date: '2027-01-05' }, [
      { account_code: '6111', debit: 10, credit: 0 }, { account_code: '4411', debit: 0, credit: 10 },
    ]);
    const fy27 = state.db.tables.accounting_fiscal_years.find(y => y.label === '2027');
    expect(fy27).toBeTruthy();
    expect(state.db.tables.journal_entries.find(x => x.id === e.id)?.fiscal_year_id).toBe(fy27!.id);
  });

  it('refuses a closed year and shows the year containing today unless another is picked', async () => {
    state.db.tables.accounting_fiscal_years[0].status = 'closed';
    await expect(AccountingService.fiscalYearFor('2026-05-01')).rejects.toThrow(/clôturé/);
    AccountingService.setDisplayedFiscalYear('fy26');
    expect((await AccountingService.ensureCurrentFiscalYear()).id).toBe('fy26');
  });

  it('reads reversed entries in reports, so a reversal cancels its original', async () => {
    state.db.tables.journal_entries.push(
      { id: 'e1', company_id: 'c1', fiscal_year_id: 'fy26', status: 'reversed', entry_date: '2026-03-01' },
      { id: 'e2', company_id: 'c1', fiscal_year_id: 'fy26', status: 'posted', entry_date: '2026-03-05', source_type: 'reversal' },
    );
    state.db.tables.journal_entry_lines.push(
      { id: 'l1', entry_id: 'e1', account_code: '6111', debit: 100, credit: 0 },
      { id: 'l2', entry_id: 'e2', account_code: '6111', debit: 0, credit: 100 },
    );
    const lines = await AccountingService.getPostedLines('fy26');
    expect(balance(lines.filter(l => l.account_code === '6111'))).toBe(0);
  });
});

describe('payroll run posting', () => {
  beforeEach(() => {
    state.db.tables.accounting_fiscal_years.push({ id: 'fy26', company_id: 'c1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' });
    state.db.tables.journals = [{ id: 'j-paie', company_id: 'c1', code: 'PAIE', type: 'paie' }];
    state.db.tables.payroll_runs = [{ id: 'r1', company_id: 'c1', period_month: 2, period_year: 2026, status: 'validated', journal_entry_id: null }];
    state.db.tables.payslips = [{
      id: 'p1', run_id: 'r1', company_id: 'c1', created_at: '1', total_gross: 10000, net_salary: 7705.2,
      cnss_employee: 268.8, amo_employee: 226, ir_amount: 800, cnss_employer: 538.8, amo_employer: 411, alloc_familiales: 640, tfp_employer: 160,
      other_deductions: 1000,
    }];
    state.db.tables.payslip_variables = [];
  });

  it('books the run once, loans on 3488, into the year of the pay month', async () => {
    await PayrollRunService.postToAccounting('r1', 'u');
    const entry = state.db.tables.journal_entries[0];
    expect(entry).toMatchObject({ source_id: 'run:r1', entry_date: '2026-02-28', fiscal_year_id: 'fy26' });
    const lines = state.db.tables.journal_entry_lines.filter(l => l.entry_id === entry.id);
    expect(lines.find(l => l.account_code === '3488')?.credit).toBe(1000);
    expect(balance(lines)).toBe(0);
  });

  it('refuses a draft run and a run whose payslips were posted one by one', async () => {
    state.db.tables.payroll_runs[0].status = 'draft';
    await expect(PayrollRunService.postToAccounting('r1', 'u')).rejects.toThrow(/Validez/);
    state.db.tables.payroll_runs[0].status = 'validated';
    state.db.tables.journal_entries.push({ id: 'x', company_id: 'c1', source_id: 'p1', status: 'posted' });
    await expect(PayrollRunService.postToAccounting('r1', 'u')).rejects.toThrow(/individuellement/);
  });
});
