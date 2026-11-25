// HR services on the in-memory database: leave on payslips and CNSS days,
// un-validating and paying a run, the final settlement from draft to payslip
// and back, advances, and everything before the HR migration has been run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { PayrollRunService, firstOpenMonth } from '../utils/supabasePayrollRun';
import { SupabasePayslipsService } from '../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../utils/supabaseEmployees';
import { HolidayService, HrDocumentService, HrSettingsService, LeaveOpeningService, LeaveService, LoanService } from '../utils/supabasePayrollHr';
import { StcService, type StcInputs, type StcResults } from '../utils/supabaseStc';
import { computeStc, formatServiceLength } from '../utils/stcCalc';
import { hrLimitsFor, officialSettingsFor } from '../utils/payrollDefaults';
import type { Employee } from '../types';

let seq = 0;
const withIds = (extra?: FakeDb['failWrite']): FakeDb['failWrite'] => (table, op, payload) => {
  if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) if (r && r.id == null) { r.id = `${table}-${++seq}`; r.created_at ??= new Date(1700000000000 + seq).toISOString(); }
  return extra?.(table, op, payload);
};
const missingTable = (tables: string[]) => (table: string) => (tables.includes(table) ? `Could not find the table 'public.${table}' in the schema cache` : undefined);

const employee = (id: string, base: number, extra: Partial<Employee> = {}): Employee => ({
  id, company_id: 'c1', full_name: `Employé ${id}`, dependents_count: 0, contract_type: 'CDI', base_salary: base,
  is_active: true, created_at: '', updated_at: '', ...extra,
});

beforeEach(() => {
  state.db = createFakeDb({
    employees: [], payslips: [], payslip_variables: [], payslip_items: [], payroll_settings: [], payroll_runs: [],
    payroll_cumuls: [], employee_loans: [], payroll_rubriques: [], leave_requests: [], public_holidays: [],
    payroll_hr_settings: [], leave_opening_balances: [], payroll_stc: [], hr_documents: [], journal_entries: [],
  });
  state.db.failWrite = withIds();
});

describe('approved unpaid leave on the payslip', () => {
  const leave = (extra: Record<string, unknown>) => ({ id: 'lv1', company_id: 'c1', employee_id: 'a', type: 'sans_solde', status: 'approved', start_date: '2026-11-02', end_date: '2026-11-04', days: 3, ...extra });

  it('the run puts an absence line on the month: 3 × 9,100 / 26 = 1,050, 23 CNSS days', async () => {
    state.db.tables.employees.push(employee('a', 9100), employee('b', 6000));
    state.db.tables.leave_requests.push(leave({}), leave({ id: 'lv2', type: 'paye', employee_id: 'b' }));
    const run = await PayrollRunService.generate(11, 2026, 'u');
    const slips = (await PayrollRunService.getRun(run.id))!.payslips!;
    const a = slips.find(p => p.employee_id === 'a')!;
    // Gross 9,100 − 1,050 = 8,050 ; IR 284.02 ; net 7,315.25 (hrEngine2026)
    expect(a).toMatchObject({ total_gross: 8050, cnss_days: 23, ir_amount: 284.02, net_salary: 7315.25 });
    expect(state.db.tables.payslip_variables.filter(v => v.payslip_id === a.id).map(v => [v.code, v.amount, v.quantity])).toEqual([['CONGE:lv1', 1050, 3]]);
    // Paid leave changes nothing.
    expect(slips.find(p => p.employee_id === 'b')).toMatchObject({ total_gross: 6000, cnss_days: 26 });
  });

  it('a leave approved after the run lands on the open payslip; validated ones are reported, not changed', async () => {
    state.db.tables.employees.push(employee('a', 9100));
    const run = await PayrollRunService.generate(11, 2026, 'u');
    state.db.tables.leave_requests.push(leave({ status: 'pending' }));
    await LeaveService.setStatus('lv1', 'approved', 'rh');
    const { updated, locked } = await PayrollRunService.syncLeaveAbsences('a', '2026-11-02', '2026-11-04');
    expect(locked).toHaveLength(0);
    expect(updated[0]).toMatchObject({ total_gross: 8050, cnss_days: 23 });
    // Syncing again changes nothing; refusing the leave removes the line.
    expect((await PayrollRunService.syncLeaveAbsences('a', '2026-11-02', '2026-11-04')).updated).toHaveLength(0);
    await LeaveService.setStatus('lv1', 'rejected', 'rh');
    expect((await PayrollRunService.syncLeaveAbsences('a', '2026-11-02', '2026-11-04')).updated[0]).toMatchObject({ total_gross: 9100, cnss_days: 26 });
    // Once the run is validated, the payslip is left alone.
    await LeaveService.setStatus('lv1', 'approved', 'rh');
    await PayrollRunService.validate(run.id);
    const after = await PayrollRunService.syncLeaveAbsences('a', '2026-11-02', '2026-11-04');
    expect(after.updated).toHaveLength(0);
    expect(after.locked).toHaveLength(1);
  });

  it('counts the company\'s holidays and rest day', async () => {
    state.db.tables.employees.push(employee('a', 9100));
    // 2 → 7 Nov with Friday 6 a holiday and Saturday the rest day: Mon–Thu = 4 days → 4 × 350 = 1,400
    state.db.tables.payroll_hr_settings.push({ company_id: 'c1', weekly_rest_day: 6 });
    state.db.tables.public_holidays.push({ company_id: 'c1', year: 2026, holiday_date: '2026-11-06', label: 'Marche Verte', kind: 'civil' });
    state.db.tables.leave_requests.push(leave({ end_date: '2026-11-07' }));
    const p = await PayrollRunService.createPayslip(employee('a', 9100), 11, 2026);
    expect(p).toMatchObject({ total_gross: 7700, cnss_days: 22 });
  });
});

describe('un-validating and paying a run', () => {
  const setup = async () => {
    state.db.tables.employees.push(employee('a', 6000), employee('b', 10000));
    state.db.tables.employee_loans.push({ id: 'l1', company_id: 'c1', employee_id: 'a', amount: 3000, active: true, remaining: 3000, monthly_installment: 500, start_month: 1, start_year: 2026, created_at: '1' });
    const run = await PayrollRunService.generate(5, 2026, 'u');
    await PayrollRunService.validate(run.id);
    return run;
  };

  it('undoes what validation did: payslips open, cumuls gone, loan balance back', async () => {
    const run = await setup();
    expect(state.db.tables.employee_loans[0].remaining).toBe(2500);
    expect(state.db.tables.payroll_cumuls).toHaveLength(2);
    expect(state.db.tables.payslips.find(p => p.employee_id === 'a')!.loan_repayments).toEqual([{ loan_id: 'l1', amount: 500 }]);

    const { warnings } = await PayrollRunService.unvalidate(run.id);
    expect(warnings).toEqual([]);
    expect(state.db.tables.payroll_runs[0]).toMatchObject({ status: 'draft', validated_at: null });
    expect(state.db.tables.payslips.every(p => p.is_locked === false)).toBe(true);
    expect(state.db.tables.payroll_cumuls).toHaveLength(0);
    expect(state.db.tables.employee_loans[0]).toMatchObject({ remaining: 3000, active: true });
    // Validating again repays once, not twice.
    await PayrollRunService.validate(run.id);
    expect(state.db.tables.employee_loans[0].remaining).toBe(2500);
  });

  it('is refused once the run is booked or paid', async () => {
    const run = await setup();
    state.db.tables.journal_entries.push({ id: 'je1', company_id: 'c1', source_id: `run:${run.id}`, status: 'draft' });
    await expect(PayrollRunService.unvalidate(run.id)).rejects.toThrow(/comptabilisé/);
    // A reversed entry no longer blocks.
    state.db.tables.journal_entries[0].status = 'reversed';
    await PayrollRunService.markPaid(run.id, '2026-06-02', 'virement');
    expect(state.db.tables.payroll_runs[0]).toMatchObject({ status: 'paid', paid_at: '2026-06-02', payment_mode: 'virement' });
    await expect(PayrollRunService.unvalidate(run.id)).rejects.toThrow(/payé/);
    await expect(PayrollRunService.markPaid(run.id, '2026-06-02', 'virement')).rejects.toThrow(/déjà payé/);
  });

  it('cannot be paid before validation; a payslip validated before the migration warns instead of guessing', async () => {
    state.db.tables.employees.push(employee('a', 6000));
    const run = await PayrollRunService.generate(6, 2026, 'u');
    await expect(PayrollRunService.markPaid(run.id, '2026-07-01', 'virement')).rejects.toThrow(/Validez/);
    await PayrollRunService.validate(run.id);
    // As if validated by the old version: an AVANCE line but no repayment detail.
    const p = state.db.tables.payslips[0];
    delete p.loan_repayments;
    state.db.tables.payslip_variables.push({ id: 'v', payslip_id: p.id, code: 'AVANCE', type: 'retenue', amount: 400 });
    const { warnings } = await PayrollRunService.unvalidate(run.id);
    expect(warnings[0]).toMatch(/400,00 MAD d'avances.*à la main/);
  });

  it('paid without the migration: the status is kept, the date and mode cannot be', async () => {
    const run = await setup();
    state.db.failWrite = withIds((table, op, payload) => (table === 'payroll_runs' && op === 'update' && payload && typeof payload === 'object' && 'paid_at' in payload
      ? "Could not find the 'paid_at' column of 'payroll_runs' in the schema cache" : undefined));
    await PayrollRunService.markPaid(run.id, '2026-06-02', 'cheque');
    expect(state.db.tables.payroll_runs[0].status).toBe('paid');
    expect(state.db.tables.payroll_runs[0]).not.toHaveProperty('paid_at');
  });
});

describe('advances', () => {
  it('default to the month after the latest validated run, never a closed month', () => {
    const today = new Date(2026, 10, 25); // November 2026
    expect(firstOpenMonth([], today)).toEqual({ month: 11, year: 2026 });
    expect(firstOpenMonth([{ period_month: 11, period_year: 2026, status: 'validated' }], today)).toEqual({ month: 12, year: 2026 });
    expect(firstOpenMonth([{ period_month: 12, period_year: 2026, status: 'paid' }], today)).toEqual({ month: 1, year: 2027 });
    expect(firstOpenMonth([{ period_month: 11, period_year: 2026, status: 'draft' }], today)).toEqual({ month: 11, year: 2026 });
  });

  it('can be edited until a repayment is withheld', async () => {
    state.db.tables.employee_loans.push({ id: 'l1', company_id: 'c1', employee_id: 'a', label: 'Avance', kind: 'avance', amount: 2000, remaining: 2000, monthly_installment: 500, start_month: 12, start_year: 2026, active: true });
    await LoanService.update('l1', { label: 'Avance Aïd', kind: 'avance', amount: 2400, monthly_installment: 600, start_month: 1, start_year: 2027 });
    expect(state.db.tables.employee_loans[0]).toMatchObject({ amount: 2400, remaining: 2400, monthly_installment: 600, start_month: 1, start_year: 2027 });
    await LoanService.applyRepayment('l1', 600);
    await expect(LoanService.update('l1', { label: 'x', kind: 'avance', amount: 3000, monthly_installment: 600, start_month: 1, start_year: 2027 })).rejects.toThrow(/déjà été retenu/);
  });
});

describe('the final settlement, from draft to payslip and back', () => {
  // Hired 1 Sep 2019, base 8,500, 2 dependants. Exit 30 Nov 2026: the reference is
  // the 12 validated months Nov 2025 – Oct 2026, each 8,500 + 850 seniority + 200 bonus = 9,550.
  const ali = employee('ali', 8500, { hire_date: '2019-09-01', dependents_count: 2 });
  const seed = () => {
    state.db.tables.employees.push({ ...ali });
    for (let k = 0; k < 12; k++) {
      const year = k < 2 ? 2025 : 2026;
      const month = k < 2 ? 11 + k : k - 1;
      const id = `ref-${k}`;
      state.db.tables.payslips.push({ id, company_id: 'c1', employee_id: 'ali', period_month: month, period_year: year, payslip_number: `P${k}`, base_salary: 8500, anciennete_amount: 850, total_gross: 9550, net_salary: 8000, is_locked: true, run_id: null, created_at: String(k) });
      state.db.tables.payslip_variables.push({ id: `v-${k}`, payslip_id: id, code: 'PRIME_REND', label: 'Prime', type: 'gain', amount: 200, soumis_cnss: true, soumis_amo: true, soumis_ir: true, sort_order: 0 });
    }
    state.db.tables.employee_loans.push({ id: 'l1', company_id: 'c1', employee_id: 'ali', amount: 1500, remaining: 1000, monthly_installment: 250, start_month: 1, start_year: 2026, active: true, created_at: '1' });
  };

  const draft = async (exit = '2026-11-30') => {
    const refs = await StcService.referencePayslips('ali');
    const { referenceSalary } = await import('../utils/stcCalc');
    const ref = referenceSalary(refs, exit, 3422.72, 0);
    const loans = await StcService.loansRemaining('ali');
    const r = computeStc({
      motif: 'licenciement', hire_date: ali.hire_date, exit_date: exit, reference: ref.value, monthSalary: 8500,
      noticeMonths: 2, leaveDays: 12, loans, employee: ali, settings: officialSettingsFor(2026), limits: hrLimitsFor(2026),
    });
    const inputs: StcInputs = { motif: 'licenciement', exit_date: exit, reference_override: null, reference: ref.value, month_salary: 8500, notice_months: 2, leave_days: 12, negotiated: 0, damages: 0, retirement: 0, loans };
    const results: StcResults = {
      elements: r.elements, lines: r.lines, service: formatServiceLength(r.length), gross: r.payslip.brut_global, cnss: r.payslip.cnss_employee,
      amo: r.payslip.amo_employee, cimr: r.payslip.cimr_employee, ir: r.payslip.ir_amount, loans, net_to_pay: r.payslip.net_salary, exempt_ir: r.exemptIr, taxed_excess: r.taxedExcess,
    };
    return { ref, loans, rec: await StcService.saveDraft({ employee_id: 'ali', inputs, results, created_by: 'rh' }) };
  };

  it('uses the 12 validated months as reference (9,550) and the 1,000 MAD left on the loan', async () => {
    seed();
    const { ref, loans, rec } = await draft();
    expect(ref).toMatchObject({ average: 9550, source: 'payslips' });
    expect(loans).toBe(1000);
    expect(rec).toMatchObject({ number: 'STC-2026-001', status: 'draft' });
    // A second open settlement for the same employee is refused.
    await expect(draft()).rejects.toThrow(/existe déjà/);
  });

  it('validation makes a validated final payslip, settles the loan in full and lets the employee go', async () => {
    seed();
    const { rec } = await draft();
    const v = await StcService.validate(rec.id, 'rh');
    expect(v).toMatchObject({ status: 'validated', payslip_created: true });
    const slip = state.db.tables.payslips.find(p => p.id === v.payslip_id)!;
    // The hand-computed settlement of hrEngine2026: gross 73,057.69, IR 8,320.63, net 62,725.68
    expect(slip).toMatchObject({ period_month: 11, period_year: 2026, is_locked: true, total_gross: 73057.69, ir_amount: 8320.63, net_salary: 62725.68, other_deductions: 1000 });
    // The whole balance is repaid although the instalment is 250.
    expect(state.db.tables.employee_loans[0]).toMatchObject({ remaining: 0, active: false });
    expect(slip.loan_repayments).toEqual([{ loan_id: 'l1', amount: 1000 }]);
    expect(state.db.tables.payroll_cumuls.find(c => c.month === 11)).toMatchObject({ gross: 73057.69, ir: 8320.63 });
    expect(state.db.tables.employees[0]).toMatchObject({ is_active: false, date_sortie: '2026-11-30' });
    // The next run leaves the employee out.
    await expect(PayrollRunService.generate(12, 2026, 'u')).rejects.toThrow(/Aucun employé actif/);

    // Reversal: payslip gone, loan back, employee back.
    await StcService.reverse(v.id);
    expect(state.db.tables.payslips.find(p => p.id === v.payslip_id)).toBeUndefined();
    expect(state.db.tables.payslip_variables.filter(x => x.payslip_id === v.payslip_id)).toHaveLength(0);
    expect(state.db.tables.employee_loans[0]).toMatchObject({ remaining: 1000, active: true });
    expect(state.db.tables.payroll_cumuls.find(c => c.month === 11)).toBeUndefined();
    expect(state.db.tables.employees[0]).toMatchObject({ is_active: true, date_sortie: null });
    expect(state.db.tables.payroll_stc[0].status).toBe('reversed');
  });

  it('joins the open payslip of the month in its run, validated with the run', async () => {
    seed();
    const run = await PayrollRunService.generate(11, 2026, 'u');
    const { rec } = await draft();
    const v = await StcService.validate(rec.id, 'rh');
    const slip = state.db.tables.payslips.find(p => p.id === v.payslip_id)!;
    expect(slip).toMatchObject({ run_id: run.id, total_gross: 73057.69, other_deductions: 1000 });
    expect(slip.is_locked).not.toBe(true);
    // The month's 250 instalment line was replaced by the 1,000 settlement.
    expect(state.db.tables.payslip_variables.filter(x => x.payslip_id === slip.id).map(x => x.code)).toEqual(['STC_LICENCIEMENT', 'STC_PREAVIS', 'STC_CONGES', 'AVANCE']);
    await PayrollRunService.validate(run.id);
    expect(state.db.tables.employee_loans[0]).toMatchObject({ remaining: 0, active: false });
    // Reversal needs the run open again.
    await expect(StcService.reverse(v.id)).rejects.toThrow(/dévalidez d'abord le lot/);
    await PayrollRunService.unvalidate(run.id);
    await StcService.reverse(v.id);
    const back = state.db.tables.payslips.find(p => p.id === slip.id)!;
    expect(back).toMatchObject({ base_salary: 8500, total_gross: 9350, other_deductions: 250 });
    expect(state.db.tables.employee_loans[0]).toMatchObject({ remaining: 1000 });
  });

  it('is refused on a validated month, and cancelled while a draft', async () => {
    seed();
    const run = await PayrollRunService.generate(11, 2026, 'u');
    await PayrollRunService.validate(run.id);
    const { rec } = await draft();
    await expect(StcService.validate(rec.id, 'rh')).rejects.toThrow(/déjà validé/);
    await StcService.cancel(rec.id);
    expect(state.db.tables.payroll_stc[0].status).toBe('cancelled');
    await expect(StcService.validate(rec.id, 'rh')).rejects.toThrow(/brouillon/);
  });
});

describe('before the HR migration', () => {
  it('leave, holidays and settlements still read; what cannot be stored says which migration to run', async () => {
    state.db.failRead = missingTable(['public_holidays', 'payroll_hr_settings', 'leave_opening_balances', 'payroll_stc', 'hr_documents']);
    state.db.failWrite = withIds(missingTable(['public_holidays', 'payroll_hr_settings', 'leave_opening_balances', 'payroll_stc', 'hr_documents']));
    expect(await HolidayService.forYear(2026)).toMatchObject({ saved: false, migrationMissing: true });
    expect((await HolidayService.forYear(2026)).holidays).toHaveLength(11);
    expect(await HrSettingsService.get()).toEqual({ weekly_rest_day: 0, migrationMissing: true });
    expect(await LeaveOpeningService.list()).toEqual([]);
    expect(await StcService.list()).toEqual({ records: [], migrationMissing: true });
    await expect(HolidayService.saveYear(2026, [])).rejects.toThrow(/20261126150000_hr\.sql/);
    await expect(HrSettingsService.setRestDay(5)).rejects.toThrow(/20261126150000_hr\.sql/);
    expect(await HrDocumentService.issue('attestation_travail', 'a', '2026-11-25')).toMatchObject({ registered: false, number: expect.stringMatching(/^ATT-2026-P/) });
    // A run still generates (the leave context falls back to Sunday and the civil holidays).
    state.db.tables.employees.push(employee('a', 6000));
    expect((await PayrollRunService.generate(11, 2026, 'u')).total_gross).toBe(6000);
  });

  it('a trainee or a maintained sick leave is refused with the migration to run; others are saved', async () => {
    state.db.failWrite = withIds((table, _op, payload) => {
      const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
      if (table === 'employees' && rows.some(r => r && ('stage_start_date' in r || 'stage_cnss_exempt' in r))) return "Could not find the 'stage_start_date' column of 'employees' in the schema cache";
      if (table === 'employees' && rows.some(r => r?.contract_type === 'Stage')) return 'new row for relation "employees" violates check constraint "employees_contract_type_check"';
      if (table === 'leave_requests' && rows.some(r => r && 'pay_maintained' in r)) return "Could not find the 'pay_maintained' column of 'leave_requests' in the schema cache";
      return undefined;
    });
    const saved = await SupabaseEmployeesService.create({ ...employee('x', 7000), stage_start_date: null, stage_cnss_exempt: null });
    expect(saved).not.toHaveProperty('stage_cnss_exempt');
    await expect(SupabaseEmployeesService.create({ ...employee('t', 4000), contract_type: 'Stage', stage_start_date: '2026-03-01' })).rejects.toMatchObject({ message: expect.stringMatching(/20261126150000_hr\.sql/) });
    await LeaveService.create({ employee_id: 'x', start_date: '2026-11-02', end_date: '2026-11-02', days: 1, type: 'maladie' });
    expect(state.db.tables.leave_requests[0]).not.toHaveProperty('pay_maintained');
    await expect(LeaveService.create({ employee_id: 'x', start_date: '2026-11-02', end_date: '2026-11-02', days: 1, type: 'maladie', pay_maintained: true })).rejects.toMatchObject({ message: expect.stringMatching(/20261126150000_hr\.sql/) });
  });

  it('numbers certificates once the table exists', async () => {
    expect(await HrDocumentService.issue('certificat_travail', 'a', '2026-11-25')).toEqual({ number: 'CT-2026-001', registered: true });
    expect(await HrDocumentService.issue('certificat_travail', 'a', '2026-11-26')).toEqual({ number: 'CT-2026-002', registered: true });
    expect((await HrDocumentService.issue('attestation_salaire', 'a', '2026-11-26')).number).toBe('ATS-2026-001');
    expect(await SupabasePayslipsService.list()).toEqual([]);
  });
});
