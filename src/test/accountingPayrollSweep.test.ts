import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { AccountingService } from '../utils/supabaseAccounting';
import { computePayslip, leaveWorkingDays } from '../utils/payrollCalc';
import { PayrollSettingsService } from '../utils/supabasePayrollSettings';
import { SupabasePayslipsService } from '../utils/supabasePayslips';
import { officialSettingsFor } from '../utils/payrollDefaults';

beforeEach(() => {
  state.db = createFakeDb({ journal_entries: [], journal_entry_lines: [], payroll_settings: [], payslips: [] });
});

describe('ledger reads past the 1,000-row server cap', () => {
  const seed = (entries: number, linesPerEntry: number) => {
    state.db.maxRows = 1000;
    for (let i = 0; i < entries; i++) {
      const id = `e${String(i).padStart(5, '0')}`;
      state.db.tables.journal_entries.push({ id, company_id: 'c1', fiscal_year_id: 'fy', status: 'posted', source_id: `doc${i}`, source_type: 'invoice', entry_date: '2026-03-01' });
      for (let k = 0; k < linesPerEntry; k++) {
        const last = k === linesPerEntry - 1;
        state.db.tables.journal_entry_lines.push({ id: `${id}-${k}`, entry_id: id, company_id: 'c1', account_code: last ? '7111' : '3421', debit: last ? 0 : 10, credit: last ? 10 * (linesPerEntry - 1) : 0 });
      }
    }
  };

  it('knows every booked document, so none is booked twice', async () => {
    seed(1500, 2);
    const posted = await AccountingService.postedSourceIds();
    expect(posted.size).toBe(1500);
    expect(posted.has('doc1499')).toBe(true);
  });

  it('reads every line of a year, so the balance stays balanced', async () => {
    seed(1200, 4);
    const lines = await AccountingService.getPostedLines('fy');
    expect(lines).toHaveLength(4800);
    expect(Math.round(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0))).toBe(0);
  });
});

describe('payslip lines', () => {
  const absence = { type: 'retenue' as const, amount: 1000, soumis_cnss: true, soumis_ir: true };

  const settings = officialSettingsFor(2026);

  it('takes a taxable deduction (absence) off the taxable gross, not off the net', () => {
    const r = computePayslip({ base_salary: 6000, lines: [absence], settings });
    expect(r.gross_deductions).toBe(1000);
    expect(r.brut_imposable).toBe(5000);
    expect(r.brut_global).toBe(5000);
    expect(r.cnss_employee).toBe(224);
    expect(r.autres_retenues).toBe(0);
    expect(r.net_salary).toBe(r2(5000 - r.cnss_employee - r.amo_employee - r.ir_amount));
  });

  it('keeps advances and other non-taxable deductions after tax', () => {
    const r = computePayslip({ base_salary: 6000, settings, lines: [
      { type: 'gain', amount: 500, soumis_cnss: true, soumis_ir: true },
      { type: 'gain', amount: 300, soumis_cnss: false, soumis_ir: false },
      { type: 'retenue', amount: 400, soumis_cnss: false, soumis_ir: false },
    ] });
    expect(r).toMatchObject({ other_earnings: 800, brut_global: 6800, brut_imposable: 6500, cnss_base: 6500, autres_retenues: 400 });
  });
});

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('payslip numbers', () => {
  it('continue after the highest number, even when one was deleted', async () => {
    state.db.tables.payslips.push(
      { id: 'a', company_id: 'c1', period_year: 2026, payslip_number: 'PAIE-2026-001' },
      { id: 'c', company_id: 'c1', period_year: 2026, payslip_number: 'PAIE-2026-003' },
      { id: 'x', company_id: 'c2', period_year: 2026, payslip_number: 'PAIE-2026-009' },
    );
    expect(await SupabasePayslipsService.nextNumberSeq('c1', 2026)).toBe(4);
    expect(await SupabasePayslipsService.nextNumberSeq('c1', 2027)).toBe(1);
  });
});

describe('payroll settings', () => {
  it('are the signed-in company\'s, even for a super admin', async () => {
    const row = (company_id: string, tfp_rate: number) => ({ ...officialSettingsFor(2026), company_id, year: 2026, tfp_rate, ir_brackets: [[0, 999999999, 0, 0]] });
    state.db.tables.payroll_settings.push(row('c2', 0.05), row('c1', 0.02));
    const s = await PayrollSettingsService.get(2026);
    expect(s.tfp_rate).toBe(0.02);
  });
});

describe('leave days', () => {
  it('count working days: Sundays are not taken from the balance', () => {
    expect(leaveWorkingDays('2026-11-02', '2026-11-15')).toBe(12); // Mon → Sun, two weeks
    expect(leaveWorkingDays('2026-11-07', '2026-11-09')).toBe(2);  // Sat → Mon
    expect(leaveWorkingDays('2026-11-09', '2026-11-08')).toBe(0);
  });
});
