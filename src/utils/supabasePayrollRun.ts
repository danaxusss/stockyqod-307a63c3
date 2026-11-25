import { payrollDb, writeWithFallback } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import { SupabaseEmployeesService } from './supabaseEmployees';
import { PayrollSettingsService } from './supabasePayrollSettings';
import { AccountingService } from './supabaseAccounting';
import { checkNetPay, periodEnd } from './payrollCalc';
import { NEW_PAYSLIP_COLUMNS, SupabasePayslipsService } from './supabasePayslips';
import { LoanService } from './supabasePayrollHr';
import { DEFAULT_ACCOUNTS } from '../accounting/pcmSeed';
import type { PayrollSettings } from './payrollDefaults';
import { LEGAL_MONTHLY_HOURS } from './payrollDefaults';
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

async function employeeOf(p: Payslip): Promise<Employee | null> {
  if (p.employee && 'hire_date' in p.employee && 'dependents_count' in p.employee) return p.employee;
  return SupabaseEmployeesService.getById(p.employee_id);
}

/** Loan / advance repayments due by an employee for a month. */
async function loanDue(employeeId: string, month: number, year: number): Promise<number> {
  const loans = await LoanService.activeForEmployee(employeeId, { month, year });
  return r2(loans.reduce((s, l) => s + Math.min(Number(l.monthly_installment) || 0, Number(l.remaining) || 0), 0));
}

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

  /** Inserts an employee's computed payslip for a month (loan repayments as a line). */
  private static async insertPayslip(e: Employee, month: number, year: number, settings: PayrollSettings, payslip_number: string, runId: string | null): Promise<Payslip> {
    const { companyId } = getCompanyContext();
    const company = e.company_id || companyId;
    const loans = await loanDue(e.id, month, year);
    // The repayment is a visible line, so editing the payslip keeps it.
    const lines: PayslipLine[] = loans > 0 ? [loanLine(loans)] : [];
    const basis = { base_salary: e.base_salary, period_month: month, period_year: year, dependents_count: e.dependents_count ?? 0 };
    const res = computeForPayslip(basis, e, lines, settings);
    const { data: slip, error } = await writeWithFallback(
      p => payrollDb().from('payslips').insert(p).select().single(),
      {
        company_id: company, employee_id: e.id, period_month: month, period_year: year, payslip_number,
        hours_worked: LEGAL_MONTHLY_HOURS, run_id: runId,
        ...payslipFigures(res, { base_salary: e.base_salary, dependents_count: e.dependents_count ?? 0 }),
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
    try {
      for (const e of active) {
        seq += 1;
        await this.insertPayslip(e, month, year, settings, `PAIE-${year}-${String(seq).padStart(3, '0')}`, run.id);
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

  /** Lock a payslip: cumuls for the annual return and loan repayments. */
  private static async lockPayslip(p: Payslip, repaid: number, month: number, year: number): Promise<void> {
    const { companyId } = getCompanyContext();
    await payrollDb().from('payslips').update({ is_locked: true }).eq('id', p.id);
    if (repaid > 0) {
      let toRepay = repaid;
      const loans = await LoanService.activeForEmployee(p.employee_id, { month, year });
      for (const l of loans) {
        if (toRepay <= 0) break;
        const pay = Math.min(Number(l.monthly_installment) || 0, Number(l.remaining) || 0, toRepay);
        if (pay > 0) { await LoanService.applyRepayment(l.id, pay); toRepay = r2(toRepay - pay); }
      }
    }
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
