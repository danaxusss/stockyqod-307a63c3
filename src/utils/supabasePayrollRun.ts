import { HR_MIGRATION, payrollDb, writeWithFallback } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import { SupabaseEmployeesService } from './supabaseEmployees';
import { PayrollSettingsService } from './supabasePayrollSettings';
import { AccountingService } from './supabaseAccounting';
import { checkNetPay, periodEnd } from './payrollCalc';
import { NEW_PAYSLIP_COLUMNS, SupabasePayslipsService } from './supabasePayslips';
import { HolidayService, HrSettingsService, LeaveService, LoanService, type LeaveRequest } from './supabasePayrollHr';
import { absencePlan, isUnpaidLeave, leaveLineDays, mergeAbsenceLines } from './hrLeave';
import { DEFAULT_ACCOUNTS } from '../accounting/pcmSeed';
import type { PayrollSettings } from './payrollDefaults';
import { FULL_MONTH_CNSS_DAYS, LEGAL_MONTHLY_HOURS } from './payrollDefaults';
import { computeForPayslip, employerCharges, payslipFigures, type PayslipEmployee } from './payslipCompute';
import { LOAN_LINE, loanLine, payslipLines, type PayslipLine } from './payslipLines';
import { computeIrRegularisation, planRegularisation, type IrRegularisation, type RegularisationPlan } from './payrollRegularisation';
import type { Employee, Payslip, PayslipItem } from '../types';

export { LOAN_LINE };

export interface PayrollRun {
  id: string;
  company_id: string;
  period_month: number;
  period_year: number;
  status: 'draft' | 'validated' | 'paid';
  /** Set by "Marquer comme payé" (HR migration). */
  paid_at?: string | null;
  payment_mode?: string | null;
  total_gross: number;
  total_net: number;
  /** Employee social contributions: CNSS + AMO (employee shares). */
  total_cnss: number;
  /** Net IR withheld (after regularisations). */
  total_ir: number;
  employer_cost: number;
  journal_entry_id: string | null;
  created_by: string | null;
  validated_at: string | null;
  created_at: string;
  payslips?: Payslip[];
}

export interface RunTotals { total_gross: number; total_net: number; total_cnss: number; total_ir: number; employer_cost: number }

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Run totals from its payslips: the same figures the rows show. */
export function runTotals(payslips: Pick<Payslip, 'total_gross' | 'net_salary' | 'cnss_employee' | 'amo_employee' | 'ir_amount' | 'cnss_employer' | 'amo_employer' | 'alloc_familiales' | 'tfp_employer' | 'cimr_employer'>[]): RunTotals {
  const sum = (f: (p: typeof payslips[number]) => number) => r2(payslips.reduce((s, p) => s + (Number(f(p)) || 0), 0));
  return {
    total_gross: sum(p => p.total_gross),
    total_net: sum(p => p.net_salary),
    total_cnss: sum(p => (p.cnss_employee || 0) + (p.amo_employee || 0)),
    total_ir: sum(p => p.ir_amount),
    employer_cost: sum(p => (p.total_gross || 0) + employerCharges(p)),
  };
}

/**
 * First month a new advance's repayments can start: this month, or the month
 * after the latest validated (or paid) run when that run is this month or
 * later, so the default never falls in a closed month.
 */
export function firstOpenMonth(runs: Pick<PayrollRun, 'period_month' | 'period_year' | 'status'>[], today = new Date()): { month: number; year: number } {
  const now = today.getFullYear() * 12 + today.getMonth();
  const closed = runs.filter(r => r.status !== 'draft').map(r => r.period_year * 12 + r.period_month - 1);
  const k = Math.max(now, closed.length ? Math.max(...closed) + 1 : now);
  return { month: (k % 12) + 1, year: Math.floor(k / 12) };
}

async function employeeOf(p: Payslip): Promise<Employee | null> {
  if (p.employee && 'hire_date' in p.employee && 'dependents_count' in p.employee) return p.employee;
  return SupabaseEmployeesService.getById(p.employee_id);
}

/** Loan / advance repayments due by an employee for a month. */
async function loanDue(employeeId: string, month: number, year: number): Promise<number> {
  const loans = await LoanService.activeForEmployee(employeeId, { month, year });
  return r2(loans.reduce((s, l) => s + Math.min(Number(l.monthly_installment) || 0, Number(l.remaining) || 0), 0));
}

/** What the run needs to put approved unpaid leave on payslips. */
interface LeaveContext { leaves: LeaveRequest[]; restDay: number; holidays: string[] }

/** Approved unpaid leaves, rest day and holidays of a year (empty when the leave data cannot be read). */
async function leaveContext(year: number): Promise<LeaveContext> {
  const [leaves, hr, holidays] = await Promise.all([
    LeaveService.list().catch(() => [] as LeaveRequest[]),
    HrSettingsService.get().catch(() => ({ weekly_rest_day: 0, migrationMissing: true })),
    HolidayService.forYear(year).then(h => h.holidays.map(x => x.date)).catch(() => [] as string[]),
  ]);
  return { leaves: leaves.filter(l => l.status === 'approved' && isUnpaidLeave(l)), restDay: hr.weekly_rest_day, holidays };
}

/** Repayments applied on a payslip at validation, kept so they can be undone. */
type LoanRepayment = { loan_id: string; amount: number };

const itemsOf = (lines: PayslipLine[]) => lines.map((l, i) => ({
  label: l.label, item_type: l.type === 'gain' ? 'earning' : 'deduction', amount: l.amount,
  included_in_anciennete_base: l.inclus_anciennete, sort_order: i,
} as Omit<PayslipItem, 'id' | 'payslip_id'>));

export class PayrollRunService {
  static async list(): Promise<PayrollRun[]> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_runs').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false });
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as PayrollRun[];
  }

  static async getRun(id: string): Promise<PayrollRun | null> {
    const { data, error } = await payrollDb().from('payroll_runs').select('*').eq('id', id).single();
    if (error) throw error;
    if (!data) return null;
    const { data: ps } = await payrollDb().from('payslips')
      .select('*, employee:employees(*)').eq('run_id', id).order('created_at');
    (data as PayrollRun).payslips = ((ps || []) as Payslip[]).map(p => ({
      ...p,
      cimr_employer: Number(p.cimr_employer ?? 0),
      ir_regularisation: Number(p.ir_regularisation ?? 0),
      cnss_days: p.cnss_days ?? 26,
    }));
    return data as PayrollRun;
  }

  /** Writes a run's totals from its payslips (after any payslip of the run is saved). */
  static async recomputeTotals(runId: string): Promise<RunTotals> {
    const { data, error } = await payrollDb().from('payslips').select('*').eq('run_id', runId);
    if (error) throw error;
    const totals = runTotals((data || []) as Payslip[]);
    const { error: upErr } = await payrollDb().from('payroll_runs').update(totals).eq('id', runId);
    if (upErr) throw upErr;
    return totals;
  }

  /** Employees among `employees` who already have a payslip for the month. */
  private static async alreadyPaid(employees: Employee[], month: number, year: number): Promise<Employee[]> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payslips').select('id, employee_id').eq('period_month', month).eq('period_year', year);
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    const have = new Set(((data || []) as { employee_id: string }[]).map(r => r.employee_id));
    return employees.filter(e => have.has(e.id));
  }

  /**
   * Inserts an employee's computed payslip for a month: loan repayments as a
   * line, and one absence line per approved unpaid leave of the month (the
   * CNSS days go down by the same days). `override` is the final settlement's
   * payslip (its own base salary and lines).
   */
  private static async insertPayslip(
    e: Employee, month: number, year: number, settings: PayrollSettings, payslip_number: string, runId: string | null,
    ctx?: LeaveContext, override?: { base_salary: number; hours_worked: number; lines: PayslipLine[] },
  ): Promise<Payslip> {
    const { companyId } = getCompanyContext();
    const company = e.company_id || companyId;
    const leave = ctx || await leaveContext(year);
    const absences = absencePlan(leave.leaves, e.id, month, year, e.base_salary, { restDay: leave.restDay, holidays: leave.holidays });
    let lines: PayslipLine[];
    if (override) lines = mergeAbsenceLines(override.lines, absences);
    else {
      const loans = await loanDue(e.id, month, year);
      // The repayment is a visible line, so editing the payslip keeps it.
      lines = [...absences.lines, ...(loans > 0 ? [loanLine(loans)] : [])];
    }
    const base = override ? override.base_salary : e.base_salary;
    const basis = { base_salary: base, period_month: month, period_year: year, dependents_count: e.dependents_count ?? 0 };
    const res = computeForPayslip(basis, e, lines, settings);
    const { data: slip, error } = await writeWithFallback(
      p => payrollDb().from('payslips').insert(p).select().single(),
      {
        company_id: company, employee_id: e.id, period_month: month, period_year: year, payslip_number,
        hours_worked: override ? override.hours_worked : LEGAL_MONTHLY_HOURS, run_id: runId,
        ...payslipFigures(res, { base_salary: base, dependents_count: e.dependents_count ?? 0, cnss_days: Math.max(0, FULL_MONTH_CNSS_DAYS - leaveLineDays(lines)) }),
        ir_regularisation_ids: [],
      } as Record<string, unknown>,
      NEW_PAYSLIP_COLUMNS,
    );
    if (error) throw new Error(`Bulletin de ${e.full_name} : ${error.message}`);
    const created = slip as Payslip;
    if (lines.length) {
      await SupabasePayslipsService.replaceVariables(created.id, company, lines);
      await SupabasePayslipsService.upsertItems(created.id, itemsOf(lines));
    }
    return created;
  }

  /**
   * A payslip made by hand ("Nouveau bulletin"), computed like the run does.
   * Refused when the employee already has one for the month.
   */
  static async createPayslip(e: Employee, month: number, year: number): Promise<Payslip> {
    const [dup] = await this.alreadyPaid([e], month, year);
    if (dup) throw new Error(`${e.full_name} a déjà un bulletin pour ${MONTHS[month - 1]} ${year}. Ouvrez-le depuis la liste au lieu d'en créer un second.`);
    const { companyId } = getCompanyContext();
    const settings = await PayrollSettingsService.get(year);
    const seq = await SupabasePayslipsService.nextNumberSeq(e.company_id || companyId, year);
    return this.insertPayslip(e, month, year, settings, `PAIE-${year}-${String(seq).padStart(3, '0')}`, null);
  }

  /**
   * The final settlement's payslip, made outside a run: its own (prorated)
   * base salary and the settlement lines; the month's unpaid leave is added.
   */
  static async createFinalPayslip(e: Employee, month: number, year: number, base_salary: number, hours_worked: number, lines: PayslipLine[]): Promise<Payslip> {
    const [dup] = await this.alreadyPaid([e], month, year);
    if (dup) throw new Error(`${e.full_name} a déjà un bulletin pour ${MONTHS[month - 1]} ${year}.`);
    const { companyId } = getCompanyContext();
    const settings = await PayrollSettingsService.get(year);
    const seq = await SupabasePayslipsService.nextNumberSeq(e.company_id || companyId, year);
    return this.insertPayslip(e, month, year, settings, `PAIE-${year}-${String(seq).padStart(3, '0')}`, null, undefined, { base_salary, hours_worked, lines });
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
    const dups = await this.alreadyPaid(active, month, year);
    if (dups.length) {
      throw new Error(`Bulletin déjà existant pour ${MONTHS[month - 1]} ${year} : ${dups.map(e => e.full_name).join(', ')}. Supprimez ces bulletins faits à la main ou désactivez ces employés avant de générer le lot.`);
    }

    // Create the run first (to link payslips)
    const { data: runRow, error: runErr } = await payrollDb().from('payroll_runs').insert({
      company_id: companyId, period_month: month, period_year: year, status: 'draft', created_by: createdBy,
    }).select().single();
    if (runErr) throw runErr;
    const run = runRow as PayrollRun;

    let seq = (await SupabasePayslipsService.nextNumberSeq(companyId, year)) - 1;
    const ctx = await leaveContext(year);
    try {
      for (const e of active) {
        seq += 1;
        await this.insertPayslip(e, month, year, settings, `PAIE-${year}-${String(seq).padStart(3, '0')}`, run.id, ctx);
      }
    } catch (e) {
      // All or nothing: a run missing payslips would understate every total.
      await payrollDb().from('payslips').delete().eq('run_id', run.id);
      await payrollDb().from('payroll_runs').delete().eq('id', run.id);
      throw e;
    }

    await this.recomputeTotals(run.id);
    const { data: updated, error: upErr } = await payrollDb().from('payroll_runs').select('*').eq('id', run.id).single();
    if (upErr) throw upErr;
    return updated as PayrollRun;
  }

  /**
   * Saves an open payslip: recomputed from its own base salary and lines,
   * with its lines, then its run's totals.
   */
  static async savePayslip(
    payslip: Payslip,
    lines: PayslipLine[],
    opts: { settings?: PayrollSettings; employee?: PayslipEmployee | null; companyId?: string | null } = {},
  ): Promise<Payslip> {
    if (payslip.is_locked) throw new Error('Bulletin validé : il ne peut plus être modifié.');
    const settings = opts.settings || await PayrollSettingsService.get(payslip.period_year);
    const employee = opts.employee !== undefined ? opts.employee : await employeeOf(payslip);
    const res = computeForPayslip(payslip, employee, lines, settings);
    const dependents = payslip.dependents_count ?? employee?.dependents_count ?? 0;
    const companyId = payslip.company_id || opts.companyId || getCompanyContext().companyId || null;
    const saved = await SupabasePayslipsService.update(payslip.id, {
      hours_worked: payslip.hours_worked, period_month: payslip.period_month, period_year: payslip.period_year, notes: payslip.notes,
      ...payslipFigures(res, { base_salary: payslip.base_salary, dependents_count: dependents, cnss_days: payslip.cnss_days }),
      ir_regularisation_ids: res.ir_regularisation !== 0 ? (payslip.ir_regularisation_ids || []) : [],
    } as Partial<Omit<Payslip, 'employee' | 'items'>>);
    await SupabasePayslipsService.replaceVariables(payslip.id, companyId, lines);
    // payslip_items stay in step for the readers of the old free-text lines.
    await SupabasePayslipsService.upsertItems(payslip.id, itemsOf(lines));
    if (payslip.run_id) await this.recomputeTotals(payslip.run_id);
    return saved;
  }

  /** Lines of a stored payslip (its variables, else its legacy items). */
  static async linesOf(p: Payslip): Promise<PayslipLine[]> {
    const vars = await SupabasePayslipsService.getVariables(p.id);
    if (vars.length) return payslipLines(p, vars);
    const items = p.items?.length ? p.items : (await SupabasePayslipsService.getItemsFor([p.id])).get(p.id) || [];
    return payslipLines({ ...p, items }, []);
  }

  /**
   * Lock a payslip: cumuls for the annual return and loan repayments. The
   * withheld amount pays each started loan's instalment first; anything above
   * (a final settlement repaying the whole balance) pays the remaining
   * balances in order, loans not yet started included. What each loan
   * received is stored on the payslip so "dévalider" can give it back.
   */
  private static async lockPayslip(p: Payslip, repaid: number, month: number, year: number): Promise<void> {
    const { companyId } = getCompanyContext();
    await payrollDb().from('payslips').update({ is_locked: true }).eq('id', p.id);
    const applied: LoanRepayment[] = [];
    if (repaid > 0) {
      let toRepay = r2(repaid);
      const left = new Map<string, number>();
      const add = (loanId: string, pay: number) => {
        const prev = applied.find(a => a.loan_id === loanId);
        if (prev) prev.amount = r2(prev.amount + pay); else applied.push({ loan_id: loanId, amount: pay });
      };
      for (const l of await LoanService.activeForEmployee(p.employee_id, { month, year })) {
        left.set(l.id, Number(l.remaining) || 0);
        const pay = r2(Math.min(Number(l.monthly_installment) || 0, left.get(l.id) || 0, toRepay));
        if (pay > 0) { add(l.id, pay); left.set(l.id, r2((left.get(l.id) || 0) - pay)); toRepay = r2(toRepay - pay); }
      }
      if (toRepay > 0) {
        for (const l of await LoanService.activeForEmployee(p.employee_id)) {
          const rest = left.has(l.id) ? left.get(l.id) || 0 : Number(l.remaining) || 0;
          const pay = r2(Math.min(rest, toRepay));
          if (pay > 0) { add(l.id, pay); left.set(l.id, r2(rest - pay)); toRepay = r2(toRepay - pay); }
        }
      }
      for (const a of applied) await LoanService.applyRepayment(a.loan_id, a.amount);
    }
    // Without the HR migration the detail cannot be kept (un-validating then warns).
    await writeWithFallback(row => payrollDb().from('payslips').update(row).eq('id', p.id), { loan_repayments: applied } as Record<string, unknown>, ['loan_repayments']);
    // Taxable figures as stored; payslips saved before they were stored are
    // recomputed from their lines.
    let taxableGross = p.ir_taxable_gross;
    let netTaxable = p.net_taxable;
    if (taxableGross == null || netTaxable == null) {
      const settings = await PayrollSettingsService.get(year);
      const res = computeForPayslip(p, await employeeOf(p), await this.linesOf(p), settings);
      taxableGross = res.brut_imposable; netTaxable = res.net_imposable;
    }
    const { error } = await writeWithFallback(
      row => payrollDb().from('payroll_cumuls').upsert(row, { onConflict: 'employee_id,year,month' }),
      {
        company_id: p.company_id || companyId, employee_id: p.employee_id, year, month,
        gross: p.total_gross, taxable_gross: taxableGross, taxable: netTaxable, ir: p.ir_amount,
        cnss_emp: p.cnss_employee, amo_emp: p.amo_employee, cimr: p.cimr_employee, net: p.net_salary,
      } as Record<string, unknown>,
      ['taxable_gross'],
    );
    if (error) throw error;
  }

  /** Net-pay check of a payslip before validation (negative net blocks). */
  private static async checkBeforeValidation(payslips: Payslip[]): Promise<Map<string, number>> {
    const loanAmounts = await SupabasePayslipsService.loanDeductions(payslips);
    const blocked = payslips.filter(p => checkNetPay(p.net_salary, loanAmounts.get(p.id) || 0).error);
    if (blocked.length) {
      throw new Error(`Net à payer négatif pour ${blocked.map(p => (p.employee as Employee | undefined)?.full_name || p.payslip_number).join(', ')} : corrigez ces bulletins avant de valider.`);
    }
    return loanAmounts;
  }

  static async validate(runId: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Lot introuvable');
    if (run.status !== 'draft') throw new Error('Lot déjà validé');
    const payslips = run.payslips || [];
    const loanAmounts = await this.checkBeforeValidation(payslips);
    // Lock payslips + write cumuls + apply loan repayments (only the AVANCE
    // line repays loans; other deductions are not loan money).
    for (const p of payslips) await this.lockPayslip(p, loanAmounts.get(p.id) || 0, run.period_month, run.period_year);
    await this.recomputeTotals(runId);
    await payrollDb().from('payroll_runs').update({ status: 'validated', validated_at: new Date().toISOString() }).eq('id', runId);
  }

  /** Validates a payslip made outside a run. */
  static async validatePayslip(payslipId: string): Promise<void> {
    const p = await SupabasePayslipsService.getById(payslipId);
    if (!p) throw new Error('Bulletin introuvable');
    if (p.is_locked) throw new Error('Bulletin déjà validé');
    if (p.run_id) throw new Error('Ce bulletin fait partie d\'un lot : validez le lot.');
    const loanAmounts = await this.checkBeforeValidation([p]);
    await this.lockPayslip(p, loanAmounts.get(p.id) || 0, p.period_month, p.period_year);
  }

  // ── Undoing a validation, paying a run ───────────────────────────────────

  /** Sources with a journal entry that is not reversed. */
  private static async bookedSources(sourceIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < sourceIds.length; i += 300) {
      const { data, error } = await payrollDb().from('journal_entries').select('source_id, status').in('source_id', sourceIds.slice(i, i + 300));
      if (error) throw error;
      for (const r of (data || []) as { source_id: string; status?: string }[]) if (r.status !== 'reversed') out.add(r.source_id);
    }
    return out;
  }

  /**
   * Unlocks a validated payslip: gives back its loan repayments, removes its
   * cumul, opens it for editing. Returns a warning when the repayments were
   * not recorded in detail (validated before the HR migration).
   */
  static async unlockPayslip(p: Payslip): Promise<string | null> {
    let warning: string | null = null;
    const repaid = Array.isArray(p.loan_repayments) ? p.loan_repayments : null;
    if (repaid) {
      for (const r of repaid) await LoanService.reverseRepayment(r.loan_id, Number(r.amount) || 0);
    } else {
      const withheld = (await SupabasePayslipsService.loanDeductions([p])).get(p.id) || 0;
      if (withheld > 0) {
        const who = (p.employee as Employee | undefined)?.full_name || p.payslip_number;
        warning = `${who} : ${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(withheld)} MAD d'avances retenus sans détail par prêt (validé avant la mise à jour de la base) : rétablissez le solde du prêt à la main dans Avances & prêts.`;
      }
    }
    const { error: cErr } = await payrollDb().from('payroll_cumuls').delete().eq('employee_id', p.employee_id).eq('year', p.period_year).eq('month', p.period_month);
    if (cErr) throw cErr;
    const { error } = await writeWithFallback(row => payrollDb().from('payslips').update(row).eq('id', p.id), { is_locked: false, loan_repayments: null } as Record<string, unknown>, ['loan_repayments']);
    if (error) throw error;
    return warning;
  }

  /**
   * Un-validates a validated run that is neither paid nor booked: unlocks its
   * payslips and undoes what validation did (cumuls, loan balances).
   */
  static async unvalidate(runId: string): Promise<{ warnings: string[] }> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Lot introuvable');
    if (run.status === 'draft') throw new Error('Ce lot n\'est pas validé.');
    if (run.status === 'paid') throw new Error('Lot déjà payé : il ne peut plus être dévalidé.');
    const posted = 'Lot comptabilisé : contre-passez d\'abord l\'écriture de paie dans la Compta.';
    if (run.journal_entry_id) throw new Error(posted);
    const payslips = run.payslips || [];
    const booked = await this.bookedSources([`run:${run.id}`, ...payslips.map(p => p.id)]);
    if (booked.has(`run:${run.id}`)) throw new Error(posted);
    const bookedSlips = payslips.filter(p => booked.has(p.id));
    if (bookedSlips.length) throw new Error(`${bookedSlips.length} bulletin(s) de ce lot sont comptabilisés : contre-passez leurs écritures avant de dévalider.`);
    const warnings: string[] = [];
    for (const p of payslips) {
      if (!p.is_locked) continue;
      const w = await this.unlockPayslip(p);
      if (w) warnings.push(w);
    }
    const { error } = await payrollDb().from('payroll_runs').update({ status: 'draft', validated_at: null }).eq('id', runId);
    if (error) throw error;
    return { warnings };
  }

  /** Un-validates a payslip made outside a run (refused once booked). */
  static async unvalidatePayslip(payslipId: string): Promise<{ warnings: string[] }> {
    const p = await SupabasePayslipsService.getById(payslipId);
    if (!p) throw new Error('Bulletin introuvable');
    if (!p.is_locked) return { warnings: [] };
    if (p.run_id) throw new Error('Ce bulletin fait partie d\'un lot : dévalidez le lot.');
    if ((await this.bookedSources([p.id])).has(p.id)) throw new Error('Bulletin comptabilisé : contre-passez d\'abord son écriture dans la Compta.');
    const w = await this.unlockPayslip(p);
    return { warnings: w ? [w] : [] };
  }

  /** Records that a validated run was paid (date and mode). */
  static async markPaid(runId: string, paidAt: string, mode: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Lot introuvable');
    if (run.status !== 'validated') throw new Error(run.status === 'paid' ? 'Lot déjà payé.' : 'Validez le lot avant de le marquer payé.');
    if (!paidAt) throw new Error('Date de paiement requise.');
    // Before the HR migration the date and mode cannot be kept: the status still is.
    const { error } = await writeWithFallback(row => payrollDb().from('payroll_runs').update(row).eq('id', runId),
      { status: 'paid', paid_at: paidAt, payment_mode: mode } as Record<string, unknown>, ['paid_at', 'payment_mode'], undefined, HR_MIGRATION);
    if (error) throw error;
  }

  // ── Leave on open payslips ───────────────────────────────────────────────

  /**
   * Brings the absence lines of an employee's open payslips in line with the
   * approved unpaid leave, for every month a period touches (after a leave
   * is approved, refused or deleted). Validated payslips are not changed:
   * they are returned so the screen can say so.
   */
  static async syncLeaveAbsences(employeeId: string, start: string, end: string): Promise<{ updated: Payslip[]; locked: Payslip[] }> {
    const updated: Payslip[] = [];
    const locked: Payslip[] = [];
    const [sy, sm] = start.slice(0, 10).split('-').map(Number);
    const [ey, em] = end.slice(0, 10).split('-').map(Number);
    for (let k = sy * 12 + sm - 1; k <= ey * 12 + em - 1; k++) {
      const year = Math.floor(k / 12);
      const month = (k % 12) + 1;
      const found = await SupabasePayslipsService.findForPeriod(employeeId, month, year);
      const full = found && await SupabasePayslipsService.getById(found.id);
      if (!full) continue;
      const employee = await employeeOf(full);
      const current = await this.linesOf(full);
      const ctx = await leaveContext(year);
      const plan = absencePlan(ctx.leaves, employeeId, month, year, employee?.base_salary ?? full.base_salary, { restDay: ctx.restDay, holidays: ctx.holidays });
      const next = mergeAbsenceLines(current, plan);
      if (next.length === current.length && next.every((l, i) => l.code === current[i].code)) continue;
      if (full.is_locked) { locked.push(full); continue; }
      updated.push(await this.savePayslip({ ...full, cnss_days: Math.max(0, FULL_MONTH_CNSS_DAYS - leaveLineDays(next)) }, next, { employee }));
    }
    return { updated, locked };
  }

  // ── IR regularisation ────────────────────────────────────────────────────

  /** What an open payslip should regularise for its year (nothing is written). */
  static async regularisationFor(p: Payslip, employee?: PayslipEmployee | null, settings?: PayrollSettings): Promise<IrRegularisation> {
    const s = settings || await PayrollSettingsService.get(p.period_year);
    const emp = employee !== undefined ? employee : await employeeOf(p);
    const yearSlips = (await SupabasePayslipsService.list({ employeeId: p.employee_id, year: p.period_year }))
      .filter(x => x.id !== p.id);
    const locked = yearSlips.filter(x => x.is_locked).map(x => x.id);
    const [vars, items] = await Promise.all([
      SupabasePayslipsService.getVariablesFor(locked),
      SupabasePayslipsService.getItemsFor(locked),
    ]);
    const sources = yearSlips.map(x => ({
      id: x.id, period_month: x.period_month, period_year: x.period_year, is_locked: x.is_locked,
      ir_amount: x.ir_amount, ir_regularisation: x.ir_regularisation || 0, base_salary: x.base_salary,
      dependents_count: x.dependents_count,
      lines: x.is_locked ? payslipLines({ ...x, items: items.get(x.id) || [] }, vars.get(x.id) || []) : [],
    }));
    return computeIrRegularisation(p.id, sources, emp || {}, s, p.period_year);
  }

  /**
   * Applies the regularisation on an open payslip: gives back what is owed
   * (never taking the month's IR below 0); under-withheld IR only when
   * `collect` is true. Re-applying replaces, it never adds.
   */
  static async applyRegularisation(payslipId: string, opts: { collect?: boolean } = {}): Promise<{ regularisation: IrRegularisation; plan: RegularisationPlan; payslip: Payslip }> {
    const p = await SupabasePayslipsService.getById(payslipId);
    if (!p) throw new Error('Bulletin introuvable');
    if (p.is_locked) throw new Error('Bulletin validé : la régularisation se fait sur un bulletin d\'un mois ouvert.');
    const [settings, employee, lines] = await Promise.all([
      PayrollSettingsService.get(p.period_year), employeeOf(p), this.linesOf(p),
    ]);
    const regularisation = await this.regularisationFor(p, employee, settings);
    const irBrut = computeForPayslip({ ...p, ir_regularisation: 0 }, employee, lines, settings).ir_brut;
    const plan = planRegularisation(regularisation.owed, irBrut, opts.collect);
    const payslip = await this.savePayslip(
      { ...p, ir_regularisation: plan.apply, ir_regularisation_ids: plan.apply !== 0 ? regularisation.coveredIds : [] },
      lines, { settings, employee },
    );
    return { regularisation, plan, payslip };
  }

  /** Post a single consolidated payroll entry for the run to the accounting ledger. */
  static async postToAccounting(runId: string, createdBy: string | null): Promise<void> {
    const run = await this.getRun(runId);
    if (!run || !run.payslips) throw new Error('Lot introuvable');
    if (run.journal_entry_id) throw new Error('Lot déjà comptabilisé');
    if (run.status === 'draft') throw new Error('Validez le lot avant de le comptabiliser.');
    // Payslips already posted one by one (À comptabiliser) must not be booked again.
    const posted = await AccountingService.postedSourceIds();
    const alone = run.payslips.filter(p => posted.has(p.id));
    if (alone.length) throw new Error(`${alone.length} bulletin(s) de ce lot sont déjà comptabilisés individuellement : contre-passez-les ou comptabilisez le reste un par un.`);
    if (posted.has(`run:${run.id}`)) throw new Error('Lot déjà comptabilisé');
    const loanAmounts = await SupabasePayslipsService.loanDeductions(run.payslips);

    const sum = (f: (p: Payslip) => number) => r2(run.payslips!.reduce((s, p) => s + (Number(f(p)) || 0), 0));
    const gross = sum(p => p.total_gross);
    const employer = sum(p => employerCharges(p));
    const net = sum(p => p.net_salary);
    const cnssTotal = sum(p => (p.cnss_employee || 0) + (p.amo_employee || 0) + (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + (p.tfp_employer || 0));
    // CIMR: employee and employer shares are both owed to the fund (4443).
    const cimr = sum(p => (p.cimr_employee || 0) + (p.cimr_employer || 0));
    // ir_amount is the IR actually withheld, net of any regularisation.
    const ir = sum(p => p.ir_amount || 0);
    const loans = sum(p => Math.min(loanAmounts.get(p.id) || 0, p.other_deductions || 0));
    const other = r2(sum(p => p.other_deductions || 0) - loans);

    const lines: { account_code: string; label: string; debit: number; credit: number }[] = [
      { account_code: DEFAULT_ACCOUNTS.chargesPersonnel, label: 'Salaires bruts', debit: gross, credit: 0 },
    ];
    if (employer > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.chargesSociales, label: 'Charges patronales', debit: employer, credit: 0 });
    lines.push({ account_code: DEFAULT_ACCOUNTS.remunerationsDues, label: 'Net à payer', debit: 0, credit: net });
    if (cnssTotal > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.cnss, label: 'CNSS/AMO', debit: 0, credit: cnssTotal });
    if (cimr > 0) lines.push({ account_code: '4443', label: 'CIMR', debit: 0, credit: cimr });
    if (ir > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.irRetenue, label: 'IR retenue', debit: 0, credit: ir });
    // Repaid advances clear the receivable they were booked to (3488).
    if (loans > 0) lines.push({ account_code: '3488', label: 'Remboursement avances / prêts', debit: 0, credit: loans });
    if (other > 0) lines.push({ account_code: '4488', label: 'Autres retenues', debit: 0, credit: other });

    const journals = await AccountingService.listJournals();
    const period = `${String(run.period_month).padStart(2, '0')}/${run.period_year}`;
    const entry = await AccountingService.createFromDraft(
      { journalType: 'paie', date: day(periodEnd(run.period_month, run.period_year)), reference: `PAIE ${period}`, label: `Paie ${period}`, sourceType: 'payslip', sourceId: `run:${run.id}`, lines },
      journals, { post: false, createdBy },
    );
    await payrollDb().from('payroll_runs').update({ journal_entry_id: entry.id }).eq('id', runId);
  }
}
