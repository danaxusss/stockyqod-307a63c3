// Payroll services on the in-memory database: IR regularisation, one payslip
// per month, run totals, validation, CIMR posting, and the app working before
// the 2026 migration has been run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));

import { PayrollRunService, runTotals } from '../utils/supabasePayrollRun';
import { SupabasePayslipsService } from '../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../utils/supabaseEmployees';
import { RubriquesService } from '../utils/supabaseRubriques';
import { buildPayslipEntry } from '../accounting/postingRules';
import { computeIrRegularisation, planRegularisation } from '../utils/payrollRegularisation';
import { officialSettingsFor } from '../utils/payrollDefaults';
import { computeForPayslip } from '../utils/payslipCompute';
import { blankLine, loanLine } from '../utils/payslipLines';
import { generatePayslipPdfBlob } from '../utils/pdfExport';
import type { Employee, Payslip } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const balance = (lines: { debit: number; credit: number }[]) => r2(lines.reduce((s, l) => s + l.debit - l.credit, 0)) + 0;

const employee = (id: string, base: number, extra: Partial<Employee> = {}): Employee => ({
  id, company_id: 'c1', full_name: `Employé ${id}`, dependents_count: 0, contract_type: 'CDI', base_salary: base,
  is_active: true, created_at: '', updated_at: '', ...extra,
});

/** A validated 2026 payslip computed with the 2025 family deduction (500 MAD). */
function lockedWith500(e: Employee, month: number): Record<string, unknown> {
  const s500 = { ...officialSettingsFor(2026), family_ded_per_dep: 500 };
  const res = computeForPayslip({ base_salary: e.base_salary, period_month: month, period_year: 2026 }, e, [], s500);
  return {
    id: `${e.id}-${month}`, company_id: 'c1', employee_id: e.id, period_month: month, period_year: 2026,
    payslip_number: `PAIE-2026-${e.id}${month}`, base_salary: e.base_salary, hours_worked: 191,
    total_gross: res.brut_global, cnss_employee: res.cnss_employee, amo_employee: res.amo_employee, cimr_employee: 0,
    frais_pro: res.frais_pro, ir_amount: res.ir_amount, other_deductions: 0, total_deductions: res.total_deductions,
    net_salary: res.net_salary, cnss_employer: res.cnss_employer, amo_employer: res.amo_employer,
    alloc_familiales: res.alloc_familiales, tfp_employer: res.tfp_employer, is_locked: true, run_id: null, created_at: String(month),
  };
}

// The in-memory database does not make ids: give inserted rows one, like Postgres.
let seq = 0;
const withIds = (extra?: FakeDb['failWrite']): FakeDb['failWrite'] => (table, op, payload) => {
  if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) if (r && r.id == null) r.id = `${table}-${++seq}`;
  return extra?.(table, op, payload);
};

beforeEach(() => {
  state.db = createFakeDb({
    employees: [], payslips: [], payslip_variables: [], payslip_items: [], payroll_settings: [], payroll_runs: [],
    payroll_cumuls: [], employee_loans: [], payroll_rubriques: [],
    accounting_fiscal_years: [], journal_entries: [], journal_entry_lines: [],
  });
  state.db.failWrite = withIds();
});

describe('IR regularisation 2026 (600 MAD a dependant instead of 500)', () => {
  // 10,000 MAD, 3 dependants: annual IR before family deduction 7,218.72
  // withheld with 500: (7,218.72 − 1,500) / 12 = 476.56 ; due with 600: (7,218.72 − 1,800) / 12 = 451.56
  // → 25.00 too much each month; 11 validated months → 275.00 owed on December.
  const ali = employee('ali', 10000, { dependents_count: 3 });

  const seed = (e: Employee, months: number[]) => {
    state.db.tables.employees.push(e);
    for (const m of months) state.db.tables.payslips.push(lockedWith500(e, m));
  };

  it('gives back 11 × 25 = 275 MAD on December, once', async () => {
    seed(ali, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const dec = await PayrollRunService.createPayslip(ali, 12, 2026);
    // December itself is computed with 600: 451.56
    expect(dec.ir_amount).toBe(451.56);

    const preview = await PayrollRunService.regularisationFor(dec);
    expect(preview.months).toHaveLength(11);
    expect(preview.months[0]).toMatchObject({ month: 1, withheld: 476.56, recomputed: 451.56, diff: 25 });
    expect(preview.owed).toBe(275);
    // Nothing is written by the preview.
    expect((await SupabasePayslipsService.getById(dec.id))!.ir_regularisation).toBe(0);

    const { plan, payslip } = await PayrollRunService.applyRegularisation(dec.id);
    expect(plan).toEqual({ apply: 275, remainder: 0, toCollect: 0 });
    // Net IR withheld 451.56 − 275 = 176.56; net pay up by 275.
    expect(payslip).toMatchObject({ ir_regularisation: 275, ir_amount: 176.56 });
    expect(payslip.net_salary).toBe(r2(dec.net_salary + 275));
    expect(payslip.ir_regularisation_ids).toHaveLength(11);

    // Applying twice changes nothing.
    const again = await PayrollRunService.applyRegularisation(dec.id);
    expect(again.payslip).toMatchObject({ ir_regularisation: 275, ir_amount: 176.56, net_salary: payslip.net_salary });

    // The accounting entry books the IR actually withheld (4452).
    const entry = buildPayslipEntry(again.payslip, 'Ali');
    expect(entry.lines.find(l => l.account_code === '4452')?.credit).toBe(176.56);
    expect(balance(entry.lines)).toBe(0);
  });

  it('is 0 for an employee who paid no IR', async () => {
    const smig = employee('smig', 3422.72, { dependents_count: 3 });
    seed(smig, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const dec = await PayrollRunService.createPayslip(smig, 12, 2026);
    expect((await PayrollRunService.regularisationFor(dec)).owed).toBe(0);
    const { payslip } = await PayrollRunService.applyRegularisation(dec.id);
    expect(payslip).toMatchObject({ ir_regularisation: 0, ir_amount: 0 });
  });

  it('never takes the month below 0 and carries the rest to the next month', async () => {
    // 7,200 MAD, 3 dependants: AMO 162.72, frais 25 % = 1,800, net taxable 4,968.48 → 59,621.76 a year
    // Annual IR 59,621.76 × 10 % − 4,000 = 1,962.18
    // withheld with 500: (1,962.176 − 1,500) / 12 = 38.51 ; due with 600: (1,962.176 − 1,800) / 12 = 13.51
    const sara = employee('sara', 7200, { dependents_count: 3 });
    seed(sara, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const nov = await PayrollRunService.createPayslip(sara, 11, 2026);
    expect(nov.ir_amount).toBe(13.51);
    // 10 months × 25 = 250 owed; November's IR is only 13.51.
    const first = await PayrollRunService.applyRegularisation(nov.id);
    expect(first.regularisation.owed).toBe(250);
    expect(first.plan).toEqual({ apply: 13.51, remainder: 236.49, toCollect: 0 });
    expect(first.payslip).toMatchObject({ ir_amount: 0, ir_regularisation: 13.51 });

    // November is validated; December takes the rest (again limited by its IR).
    await PayrollRunService.validatePayslip(nov.id);
    const dec = await PayrollRunService.createPayslip(sara, 12, 2026);
    const second = await PayrollRunService.applyRegularisation(dec.id);
    expect(second.regularisation.owed).toBe(236.49);
    expect(second.plan).toEqual({ apply: 13.51, remainder: 222.98, toCollect: 0 });
  });

  it('shows IR under-withheld but collects it only when asked', () => {
    const s = officialSettingsFor(2026);
    // A month withheld 0 although 16.23 was due (6,000 MAD, no dependant).
    const r = computeIrRegularisation('open', [{ id: 'jan', period_month: 1, period_year: 2026, is_locked: true, ir_amount: 0, base_salary: 6000, lines: [] }], {}, s, 2026);
    expect(r.owed).toBe(-16.23);
    expect(planRegularisation(r.owed, 16.23)).toEqual({ apply: 0, remainder: 0, toCollect: 16.23 });
    expect(planRegularisation(r.owed, 16.23, true).apply).toBe(-16.23);
  });

  it('cannot be stored before the migration: refused rather than lost', async () => {
    seed(ali, [1, 2]);
    const dec = await PayrollRunService.createPayslip(ali, 12, 2026);
    state.db.failWrite = withIds((table, op, payload) => (
      table === 'payslips' && op === 'update' && payload && typeof payload === 'object' && 'ir_regularisation' in payload
        ? "Could not find the 'ir_regularisation' column of 'payslips' in the schema cache" : undefined));
    await expect(PayrollRunService.applyRegularisation(dec.id)).rejects.toThrow(/migration/);
  });
});

describe('one computation everywhere', () => {
  it('"Nouveau bulletin" is computed like the run, and a second payslip for the month is refused', async () => {
    const e = employee('e1', 10000, { dependents_count: 2, hire_date: '2019-05-10' });
    state.db.tables.employees.push(e);
    state.db.tables.employee_loans.push({ id: 'l1', company_id: 'c1', employee_id: 'e1', active: true, remaining: 3000, monthly_installment: 500, start_month: 1, start_year: 2026 });
    const p = await PayrollRunService.createPayslip(e, 11, 2026);
    // 7 years at 30 Nov 2026 → 10 % seniority on 10,000 = 1,000
    expect(p).toMatchObject({ anciennete_amount: 1000, total_gross: 11000, other_deductions: 500, cnss_employee: 268.8 });
    expect(p.ir_amount).toBeGreaterThan(0);
    expect(state.db.tables.payslip_variables.filter(v => v.payslip_id === p.id).map(v => v.code)).toEqual(['AVANCE']);
    await expect(PayrollRunService.createPayslip(e, 11, 2026)).rejects.toThrow(/déjà un bulletin/);
    // A run for that month is refused too, naming the employee.
    await expect(PayrollRunService.generate(11, 2026, 'u')).rejects.toThrow(/Employé e1/);
  });

  it('the run and the payslip page apply the same seniority base (base + flagged gains)', async () => {
    const e = employee('e2', 8000, { hire_date: '2020-01-01' });
    state.db.tables.employees.push(e);
    const run = await PayrollRunService.generate(11, 2026, 'u');
    const [p] = (await PayrollRunService.getRun(run.id))!.payslips!;
    expect(p.anciennete_amount).toBe(800); // 6 years → 10 % × 8,000
    const prime = { ...blankLine('gain'), label: 'Prime de responsabilité', amount: 1000, inclus_anciennete: true };
    const saved = await PayrollRunService.savePayslip(p, [prime]);
    expect(saved.anciennete_amount).toBe(900); // 10 % × (8,000 + 1,000)
  });

  it('a payslip keeps its own base salary after a raise, until asked', async () => {
    const e = employee('e3', 8000);
    state.db.tables.employees.push(e);
    const p = await PayrollRunService.createPayslip(e, 10, 2026);
    await SupabaseEmployeesService.update('e3', { base_salary: 9000 });
    const full = (await SupabasePayslipsService.getById(p.id))!;
    const saved = await PayrollRunService.savePayslip(full, []);
    expect(saved).toMatchObject({ base_salary: 8000, total_gross: 8000 });
    // "Reprendre le salaire actuel": the page sets the payslip's base and saves.
    const raised = await PayrollRunService.savePayslip({ ...full, base_salary: 9000 }, []);
    expect(raised).toMatchObject({ base_salary: 9000, total_gross: 9000 });
  });

  it('stores the taxable figures and CNSS days, and writes the right cumuls at validation', async () => {
    const e = employee('e4', 6000);
    state.db.tables.employees.push(e);
    const p = await PayrollRunService.createPayslip(e, 3, 2026);
    expect(p).toMatchObject({ ir_taxable_gross: 6000, net_taxable: 3495.6, cnss_base: 6000, cnss_days: 26 });
    await PayrollRunService.validatePayslip(p.id);
    expect(state.db.tables.payroll_cumuls[0]).toMatchObject({ gross: 6000, taxable_gross: 6000, taxable: 3495.6, ir: 16.23 });
    expect(state.db.tables.payslips.find(x => x.id === p.id)?.is_locked).toBe(true);
    await expect(PayrollRunService.savePayslip({ ...p, is_locked: true }, [])).rejects.toThrow(/validé/);
  });
});

describe('payroll runs', () => {
  it('keep their totals in step with their payslips, CNSS + AMO as the rows show', async () => {
    state.db.tables.employees.push(employee('a', 6000), employee('b', 10000));
    const run = await PayrollRunService.generate(2, 2026, 'u');
    const full = (await PayrollRunService.getRun(run.id))!;
    // CNSS + AMO: (268.80 + 135.60) + (268.80 + 226.00) = 899.20
    expect(state.db.tables.payroll_runs[0]).toMatchObject({ total_gross: 16000, total_cnss: 899.2 });
    const b = full.payslips!.find(p => p.employee_id === 'b')!;
    await PayrollRunService.savePayslip(b, [{ ...blankLine('gain'), label: 'Prime', amount: 1000 }]);
    const after = (await PayrollRunService.getRun(run.id))!;
    expect(after.total_gross).toBe(17000);
    expect(runTotals(after.payslips!)).toMatchObject({ total_gross: after.total_gross, total_cnss: after.total_cnss, total_net: after.total_net, total_ir: after.total_ir, employer_cost: after.employer_cost });
  });

  it('refuse validation while a net pay is negative', async () => {
    state.db.tables.employees.push(employee('n', 3500));
    const run = await PayrollRunService.generate(4, 2026, 'u');
    const [p] = (await PayrollRunService.getRun(run.id))!.payslips!;
    await PayrollRunService.savePayslip(p, [{ ...loanLine(5000) }]);
    await expect(PayrollRunService.validate(run.id)).rejects.toThrow(/négatif/);
    expect(state.db.tables.payslips[0].is_locked).not.toBe(true);
  });

  it('post the employer CIMR share with the social charges and to 4443 with the employee share', async () => {
    state.db.tables.accounting_fiscal_years.push({ id: 'fy26', company_id: 'c1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' });
    state.db.tables.journals = [{ id: 'j-paie', company_id: 'c1', code: 'PAIE', type: 'paie' }];
    state.db.tables.employees.push(employee('c', 10000, { cimr_rate: 6, cimr_employer_rate: 8 }));
    const run = await PayrollRunService.generate(5, 2026, 'u');
    await PayrollRunService.validate(run.id);
    await PayrollRunService.postToAccounting(run.id, 'u');
    const lines = state.db.tables.journal_entry_lines;
    // CIMR 600 (6 %) + 800 (8 %) = 1,400 on 4443; employer charges 1,749.80 + 800 = 2,549.80
    expect(lines.find(l => l.account_code === '4443')?.credit).toBe(1400);
    expect(lines.find(l => l.label === 'Charges patronales')?.debit).toBe(2549.8);
    expect(balance(lines as { debit: number; credit: number }[])).toBe(0);
  });
});

describe('before the 2026 migration', () => {
  // Columns the 2026 migration adds, by table.
  const missing = (cols: Record<string, string[]>) => withIds((table, _op, payload) => {
    const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
    const col = (cols[table] || []).find(c => rows.some(r => r && c in r));
    return col ? `Could not find the '${col}' column of '${table}' in the schema cache` : undefined;
  });

  it('payslips, lines, rubriques and employees are saved without the new columns', async () => {
    state.db.failWrite = missing({
      payslips: ['cnss_base', 'ir_regularisation'], payslip_variables: ['soumis_amo'], payroll_rubriques: ['ir_ceiling_type'],
      employees: ['cimr_employer_rate'], payroll_cumuls: ['taxable_gross'],
    });
    const e = await SupabaseEmployeesService.create({ ...employee('m', 7000), cimr_employer_rate: null });
    expect(state.db.tables.employees[0]).not.toHaveProperty('cimr_employer_rate');
    const p = await PayrollRunService.createPayslip(e, 6, 2026);
    expect(p.total_gross).toBe(7000);
    await PayrollRunService.savePayslip(p, [{ ...blankLine('gain'), label: 'Prime', amount: 100 }]);
    expect(state.db.tables.payslip_variables[0]).not.toHaveProperty('soumis_amo');
    expect(await RubriquesService.initDefaults()).toBe(10);
    expect(state.db.tables.payroll_rubriques[0]).not.toHaveProperty('ir_ceiling_type');
    await PayrollRunService.validatePayslip(p.id);
    expect(state.db.tables.payroll_cumuls[0]).not.toHaveProperty('taxable_gross');
    // Reading back: missing columns are defaults.
    const read = (await SupabasePayslipsService.getById(p.id))!;
    expect(read).toMatchObject({ ir_regularisation: 0, cnss_days: 26, cnss_base: null });
  });

  it('an employer CIMR rate that cannot be stored is refused, not dropped', async () => {
    state.db.failWrite = missing({ employees: ['cimr_employer_rate'] });
    await expect(SupabaseEmployeesService.create({ ...employee('x', 7000), cimr_employer_rate: 8 })).rejects.toThrow(/migration/);
  });
});

describe('payslip PDF', () => {
  it('shows the rates used, the regularisation line, the training tax and seniority at the period end', async () => {
    const s = { ...officialSettingsFor(2026), cnss_rate_emp: 0.05 };
    const p = {
      id: 'p', payslip_number: 'PAIE-2026-099', period_month: 12, period_year: 2026, hours_worked: 191, base_salary: 10000,
      anciennete_rate: 0.05, anciennete_amount: 500, total_gross: 10250, cnss_employee: 300, amo_employee: 231.65, cimr_employee: 0,
      frais_pro: 2562.5, ir_amount: 176.56, ir_regularisation: 275, other_deductions: 0, total_deductions: 708.21, net_salary: 9541.79,
      cnss_employer: 538.8, amo_employer: 421.28, alloc_familiales: 656, tfp_employer: 164, cimr_employer: 0,
      ir_taxable_gross: 10250, net_taxable: 7155.85, cnss_base: 10250, amo_base: 10250, cnss_days: 24,
      // Hired 15 Dec 2023: 3 years at 31 Dec 2026 (whatever today is).
      employee: { full_name: 'Ali', hire_date: '2023-12-15', contract_type: 'CDI' },
      lines: [{ ...blankLine('retenue'), label: 'Absence', amount: 250, soumis_cnss: true, soumis_amo: true, soumis_ir: true }],
      rates: s, items: [],
    };
    const { blob } = await generatePayslipPdfBlob(p, null);
    const text = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsText(blob, 'iso-8859-1'); });
    expect(text).toContain('CNSS \\(5 % plafonn');
    expect(text).toContain('(Régularisation IR 2026) Tj');
    expect(text).toMatch(/-275,00/);
    expect(text).toMatch(/-250,00/);
    expect(text).toContain('Formation pro. 1,6 %');
    expect(text).toContain('3 ans \\(5%\\)');
    expect(text).toContain('Jours déclarés CNSS : 24');
  });
});
