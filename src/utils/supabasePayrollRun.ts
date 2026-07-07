import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { SupabaseEmployeesService } from './supabaseEmployees';
import { PayrollSettingsService } from './supabasePayrollSettings';
import { AccountingService } from './supabaseAccounting';
import { computeAnciennete, computePayroll } from './payrollCalc';
import { LoanService } from './supabasePayrollHr';
import { DEFAULT_ACCOUNTS } from '../accounting/pcmSeed';
import type { Payslip } from '../types';

export interface PayrollRun {
  id: string;
  company_id: string;
  period_month: number;
  period_year: number;
  status: 'draft' | 'validated' | 'paid';
  total_gross: number;
  total_net: number;
  total_cnss: number;
  total_ir: number;
  employer_cost: number;
  journal_entry_id: string | null;
  created_by: string | null;
  validated_at: string | null;
  created_at: string;
  payslips?: Payslip[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export class PayrollRunService {
  static async list(): Promise<PayrollRun[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('payroll_runs').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as PayrollRun[];
  }

  static async getRun(id: string): Promise<PayrollRun | null> {
    const { data, error } = await (supabase as any).from('payroll_runs').select('*').eq('id', id).single();
    if (error) throw error;
    if (!data) return null;
    const { data: ps } = await (supabase as any).from('payslips')
      .select('*, employee:employees(full_name, matricule)').eq('run_id', id).order('created_at');
    (data as PayrollRun).payslips = (ps || []) as Payslip[];
    return data as PayrollRun;
  }

  /** Generate payslips for all active employees for a month (idempotent per month). */
  static async generate(month: number, year: number, createdBy: string | null): Promise<PayrollRun> {
    const { companyId } = getCompanyContext();
    const existing = await this.list();
    if (existing.some(r => r.period_month === month && r.period_year === year)) {
      throw new Error('Un lot existe déjà pour cette période.');
    }
    const [employees, settings] = await Promise.all([
      SupabaseEmployeesService.list(),
      PayrollSettingsService.get(year),
    ]);
    const active = employees.filter(e => e.is_active);
    if (active.length === 0) throw new Error('Aucun employé actif.');

    // Create the run first (to link payslips)
    const { data: run, error: runErr } = await (supabase as any).from('payroll_runs').insert({
      company_id: companyId, period_month: month, period_year: year, status: 'draft', created_by: createdBy,
    }).select().single();
    if (runErr) throw runErr;

    let tGross = 0, tNet = 0, tCnss = 0, tIr = 0, tEmployerCost = 0;
    const { count } = await (supabase as any).from('payslips').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('period_year', year);
    let seq = count ?? 0;

    for (const e of active) {
      const anc = computeAnciennete(e.hire_date, e.base_salary);
      const loans = await LoanService.activeForEmployee(e.id).catch(() => []);
      const loanDeduction = r2(loans.reduce((s, l) => s + Math.min(Number(l.monthly_installment) || 0, Number(l.remaining) || 0), 0));
      const res = computePayroll({ base_salary: e.base_salary, anciennete_amount: anc.amount, cimr_rate: e.cimr_rate ?? 0, dependents_count: e.dependents_count ?? 0, autres_retenues: loanDeduction, settings });
      seq += 1;
      const payslip_number = `PAIE-${year}-${String(seq).padStart(3, '0')}`;
      await (supabase as any).from('payslips').insert({
        company_id: e.company_id || companyId, employee_id: e.id, period_month: month, period_year: year, payslip_number,
        hours_worked: 191, base_salary: e.base_salary, anciennete_rate: anc.rate, anciennete_amount: anc.amount,
        other_earnings: 0, total_gross: res.brut_global,
        cnss_employee: res.cnss_employee, amo_employee: res.amo_employee, cimr_employee: res.cimr_employee,
        frais_pro: res.frais_pro, ir_amount: res.ir_amount, other_deductions: loanDeduction,
        total_deductions: res.total_deductions, net_salary: res.net_salary,
        cnss_employer: res.cnss_employer, amo_employer: res.amo_employer, alloc_familiales: res.alloc_familiales,
        tfp_employer: res.tfp_employer, run_id: run.id,
      });
      tGross += res.brut_global; tNet += res.net_salary; tCnss += res.cnss_employee; tIr += res.ir_amount; tEmployerCost += res.employer_cost;
    }

    const { data: updated, error: upErr } = await (supabase as any).from('payroll_runs').update({
      total_gross: r2(tGross), total_net: r2(tNet), total_cnss: r2(tCnss), total_ir: r2(tIr), employer_cost: r2(tEmployerCost),
    }).eq('id', run.id).select().single();
    if (upErr) throw upErr;
    return updated as PayrollRun;
  }

  static async validate(runId: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Lot introuvable');
    const { companyId } = getCompanyContext();
    // Lock payslips + write cumuls + apply loan repayments
    for (const p of (run.payslips || [])) {
      await (supabase as any).from('payslips').update({ is_locked: true }).eq('id', p.id);
      if ((p.other_deductions || 0) > 0) {
        let toRepay = p.other_deductions;
        const loans = await LoanService.activeForEmployee(p.employee_id).catch(() => []);
        for (const l of loans) {
          if (toRepay <= 0) break;
          const pay = Math.min(Number(l.monthly_installment) || 0, Number(l.remaining) || 0, toRepay);
          if (pay > 0) { await LoanService.applyRepayment(l.id, pay); toRepay = r2(toRepay - pay); }
        }
      }
      await (supabase as any).from('payroll_cumuls').upsert({
        company_id: companyId, employee_id: p.employee_id, year: run.period_year, month: run.period_month,
        gross: p.total_gross, taxable: r2(p.total_gross - p.frais_pro), ir: p.ir_amount,
        cnss_emp: p.cnss_employee, amo_emp: p.amo_employee, cimr: p.cimr_employee, net: p.net_salary,
      }, { onConflict: 'employee_id,year,month' });
    }
    await (supabase as any).from('payroll_runs').update({ status: 'validated', validated_at: new Date().toISOString() }).eq('id', runId);
  }

  /** Post a single consolidated payroll entry for the run to the accounting ledger. */
  static async postToAccounting(runId: string, createdBy: string | null): Promise<void> {
    const run = await this.getRun(runId);
    if (!run || !run.payslips) throw new Error('Lot introuvable');
    if (run.journal_entry_id) throw new Error('Lot déjà comptabilisé');

    const sum = (f: (p: Payslip) => number) => r2(run.payslips!.reduce((s, p) => s + f(p), 0));
    const gross = sum(p => p.total_gross);
    const employer = sum(p => (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + ((p as any).tfp_employer || 0));
    const net = sum(p => p.net_salary);
    const cnssTotal = sum(p => (p.cnss_employee || 0) + (p.amo_employee || 0) + (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + ((p as any).tfp_employer || 0));
    const cimr = sum(p => p.cimr_employee || 0);
    const ir = sum(p => p.ir_amount || 0);
    const other = sum(p => p.other_deductions || 0);

    const lines: any[] = [
      { account_code: DEFAULT_ACCOUNTS.chargesPersonnel, label: 'Salaires bruts', debit: gross, credit: 0 },
    ];
    if (employer > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.chargesSociales, label: 'Charges patronales', debit: employer, credit: 0 });
    lines.push({ account_code: DEFAULT_ACCOUNTS.remunerationsDues, label: 'Net à payer', debit: 0, credit: net });
    if (cnssTotal > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.cnss, label: 'CNSS/AMO', debit: 0, credit: cnssTotal });
    if (cimr > 0) lines.push({ account_code: '4443', label: 'CIMR', debit: 0, credit: cimr });
    if (ir > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.irRetenue, label: 'IR retenue', debit: 0, credit: ir });
    if (other > 0) lines.push({ account_code: '4488', label: 'Autres retenues', debit: 0, credit: other });

    const fy = await AccountingService.ensureCurrentFiscalYear();
    const journals = await AccountingService.listJournals();
    const period = `${String(run.period_month).padStart(2, '0')}/${run.period_year}`;
    const entry = await AccountingService.createFromDraft(
      { journalType: 'paie', date: `${run.period_year}-${String(run.period_month).padStart(2, '0')}-28`, reference: `PAIE ${period}`, label: `Paie ${period}`, sourceType: 'payslip', sourceId: `run:${run.id}`, lines },
      fy.id, journals, { post: false, createdBy },
    );
    await (supabase as any).from('payroll_runs').update({ journal_entry_id: entry.id }).eq('id', runId);
  }
}
