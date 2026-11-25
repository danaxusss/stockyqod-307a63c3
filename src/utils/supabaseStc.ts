// Final settlements (solde de tout compte): stored, numbered, validated into
// the employee's final payslip, reversible.

import { getCompanyContext } from './supabaseCompanyFilter';
import { isMissingTableError, payrollDb } from './payrollDb';
import { SupabaseEmployeesService } from './supabaseEmployees';
import { SupabasePayslipsService } from './supabasePayslips';
import { PayrollRunService } from './supabasePayrollRun';
import { LeaveOpeningService, LeaveService, LoanService, MigrationMissingError } from './supabasePayrollHr';
import { LEGAL_MONTHLY_HOURS } from './payrollDefaults';
import { payslipLines, LOAN_LINE, type PayslipLine } from './payslipLines';
import { leaveYear, type LeaveYear } from './hrLeave';
import type { RefPayslip, StcElement, StcMotif } from './stcCalc';
import type { Employee, Payslip } from '../types';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** What the user chose (stored so the settlement can be reopened as it was). */
export interface StcInputs {
  motif: StcMotif;
  exit_date: string;
  /** Reference salary typed over the computed one (null: computed). */
  reference_override: number | null;
  /** Reference salary used. */
  reference: number;
  month_salary: number;
  notice_months: number;
  leave_days: number;
  negotiated: number;
  damages: number;
  retirement: number;
  loans: number;
}

/** What was computed (stored as it was shown and printed). */
export interface StcResults {
  elements: StcElement[];
  /** Lines of the final payslip made by the settlement (loan settlement included). */
  lines: PayslipLine[];
  service: string;
  gross: number;
  cnss: number;
  amo: number;
  cimr: number;
  ir: number;
  loans: number;
  net_to_pay: number;
  exempt_ir: number;
  taxed_excess: number;
}

export type StcStatus = 'draft' | 'validated' | 'cancelled' | 'reversed';

export interface StcRecord {
  id: string;
  company_id: string | null;
  employee_id: string;
  number: string;
  motif: StcMotif;
  exit_date: string;
  status: StcStatus;
  inputs: StcInputs;
  results: StcResults;
  payslip_id: string | null;
  payslip_created: boolean;
  /** State before validation, put back by "Annuler la validation". */
  previous: {
    employee?: { is_active: boolean; date_sortie: string | null };
    payslip?: { base_salary: number; hours_worked: number; lines: PayslipLine[] };
  } | null;
  created_by: string | null;
  validated_at: string | null;
  reversed_at: string | null;
  created_at: string;
  employee?: { full_name: string };
}

const missing = () => new MigrationMissingError('Le solde de tout compte ne peut pas être enregistré tant que la base n\'est pas à jour.');
const isStcLine = (l: PayslipLine) => !!l.code && l.code.startsWith('STC_');

export class StcService {
  static async list(): Promise<{ records: StcRecord[]; migrationMissing: boolean }> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_stc').select('*, employee:employees(full_name)').order('created_at', { ascending: false });
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { records: [], migrationMissing: true };
      throw error;
    }
    return { records: (data || []) as StcRecord[], migrationMissing: false };
  }

  static async get(id: string): Promise<StcRecord> {
    const { data, error } = await payrollDb().from('payroll_stc').select('*').eq('id', id).maybeSingle();
    if (error) { if (isMissingTableError(error)) throw missing(); throw error; }
    if (!data) throw new Error('Solde de tout compte introuvable.');
    return data as StcRecord;
  }

  /** Next STC-YYYY-NNN of the company for the exit year. */
  private static async nextNumber(year: number): Promise<string> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_stc').select('number');
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) { if (isMissingTableError(error)) throw missing(); throw error; }
    const prefix = `STC-${year}-`;
    const highest = ((data || []) as { number: string }[]).filter(r => (r.number || '').startsWith(prefix))
      .reduce((m, r) => Math.max(m, Number(/-(\d+)$/.exec(r.number)?.[1]) || 0), 0);
    return `${prefix}${String(highest + 1).padStart(3, '0')}`;
  }

  /** Saves a draft: a new one gets its number; a draft can be saved again until validated. */
  static async saveDraft(d: { id?: string | null; employee_id: string; inputs: StcInputs; results: StcResults; created_by?: string | null }): Promise<StcRecord> {
    const { companyId } = getCompanyContext();
    const row = { employee_id: d.employee_id, motif: d.inputs.motif, exit_date: d.inputs.exit_date, inputs: d.inputs, results: d.results };
    if (d.id) {
      const cur = await this.get(d.id);
      if (cur.status !== 'draft') throw new Error('Seul un brouillon peut être modifié.');
      const { data, error } = await payrollDb().from('payroll_stc').update(row).eq('id', d.id).select().single();
      if (error) throw error;
      return data as StcRecord;
    }
    // One open settlement per employee at a time.
    const { data: open, error: openErr } = await payrollDb().from('payroll_stc').select('id, number, status').eq('employee_id', d.employee_id).in('status', ['draft', 'validated']);
    if (openErr) { if (isMissingTableError(openErr)) throw missing(); throw openErr; }
    const other = ((open || []) as { number: string; status: string }[])[0];
    if (other) throw new Error(`Un solde de tout compte existe déjà pour cet employé (${other.number}, ${other.status === 'draft' ? 'brouillon' : 'validé'}).`);
    const number = await this.nextNumber(Number(d.inputs.exit_date.slice(0, 4)));
    const { data, error } = await payrollDb().from('payroll_stc').insert({
      ...row, company_id: companyId, number, status: 'draft', payslip_created: false, created_by: d.created_by ?? null,
    }).select().single();
    if (error) { if (isMissingTableError(error)) throw missing(); throw error; }
    return data as StcRecord;
  }

  /** A draft is cancelled (kept, numbered, marked "annulé"). */
  static async cancel(id: string): Promise<void> {
    const cur = await this.get(id);
    if (cur.status !== 'draft') throw new Error('Un solde validé ne s\'annule pas : utilisez « Annuler la validation ».');
    const { error } = await payrollDb().from('payroll_stc').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  }

  /**
   * Validates a draft: the settlement becomes the employee's final payslip of
   * the exit month (added to the open payslip of the month, in its run, or a
   * new payslip validated at once), the loans are settled through its AVANCE
   * line, and the employee leaves (exit date, inactive).
   */
  static async validate(id: string, by: string | null): Promise<StcRecord> {
    const rec = await this.get(id);
    if (rec.status !== 'draft') throw new Error('Ce solde n\'est pas un brouillon.');
    if (rec.results.net_to_pay < 0) throw new Error('Net à payer négatif : réduisez la retenue des prêts avant de valider.');
    const e = await SupabaseEmployeesService.getById(rec.employee_id);
    if (!e) throw new Error('Employé introuvable.');
    const [y, m] = rec.exit_date.slice(0, 10).split('-').map(Number);
    const found = await SupabasePayslipsService.findForPeriod(e.id, m, y);
    const existing = found ? await SupabasePayslipsService.getById(found.id) : null;
    if (existing?.is_locked) {
      throw new Error(`Le bulletin de ${MONTHS[m - 1]} ${y} est déjà validé : dévalidez-le (ou son lot) avant de valider le solde.`);
    }
    const base = r2(rec.inputs.month_salary);
    const hours = e.base_salary > 0 ? r2(LEGAL_MONTHLY_HOURS * Math.min(1, base / e.base_salary)) : LEGAL_MONTHLY_HOURS;
    const stcLines = rec.results.lines;
    let payslip: Payslip;
    let created = false;
    let previousSlip: { base_salary: number; hours_worked: number; lines: PayslipLine[] } | undefined;
    if (existing) {
      const current = await PayrollRunService.linesOf(existing);
      previousSlip = { base_salary: existing.base_salary, hours_worked: existing.hours_worked, lines: current };
      // The month's instalment line is replaced by the settlement's own.
      const others = current.filter(l => !isStcLine(l) && l.code !== LOAN_LINE.code);
      payslip = await PayrollRunService.savePayslip({ ...existing, base_salary: base, hours_worked: hours }, [...others, ...stcLines], { employee: e });
      if (!existing.run_id) await PayrollRunService.validatePayslip(existing.id);
    } else {
      payslip = await PayrollRunService.createFinalPayslip(e, m, y, base, hours, stcLines);
      created = true;
      try { await PayrollRunService.validatePayslip(payslip.id); }
      catch (err) { await SupabasePayslipsService.delete(payslip.id); throw err; }
    }
    await SupabaseEmployeesService.update(e.id, { date_sortie: rec.exit_date, is_active: false });
    const { data, error } = await payrollDb().from('payroll_stc').update({
      status: 'validated', payslip_id: payslip.id, payslip_created: created, validated_at: new Date().toISOString(), validated_by: by,
      previous: { employee: { is_active: e.is_active, date_sortie: e.date_sortie ?? null }, payslip: previousSlip },
    }).eq('id', id).select().single();
    if (error) throw error;
    return data as StcRecord;
  }

  /**
   * Undoes a validated settlement: the final payslip goes back to what it was
   * (or is deleted when the settlement made it), loan repayments are given
   * back, the employee is active again. Refused once the payslip is booked or
   * its run validated (un-validate the run first).
   */
  static async reverse(id: string): Promise<{ warnings: string[] }> {
    const rec = await this.get(id);
    if (rec.status !== 'validated') throw new Error('Ce solde n\'est pas validé.');
    const warnings: string[] = [];
    const p = rec.payslip_id ? await SupabasePayslipsService.getById(rec.payslip_id) : null;
    if (p) {
      if (p.is_locked && p.run_id) {
        throw new Error(`Le bulletin de ${MONTHS[p.period_month - 1]} ${p.period_year} est validé avec son lot : dévalidez d'abord le lot (Journée de paie).`);
      }
      if (p.is_locked) warnings.push(...(await PayrollRunService.unvalidatePayslip(p.id)).warnings);
      if (rec.payslip_created) {
        await payrollDb().from('payslip_variables').delete().eq('payslip_id', p.id);
        await payrollDb().from('payslip_items').delete().eq('payslip_id', p.id);
        await SupabasePayslipsService.delete(p.id);
      } else if (rec.previous?.payslip) {
        const fresh = await SupabasePayslipsService.getById(p.id);
        if (fresh) {
          await PayrollRunService.savePayslip({ ...fresh, base_salary: rec.previous.payslip.base_salary, hours_worked: rec.previous.payslip.hours_worked }, rec.previous.payslip.lines);
        }
      }
    }
    const prevEmp = rec.previous?.employee;
    await SupabaseEmployeesService.update(rec.employee_id, { is_active: prevEmp ? prevEmp.is_active : true, date_sortie: prevEmp ? prevEmp.date_sortie : null });
    const { error } = await payrollDb().from('payroll_stc').update({ status: 'reversed', reversed_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return { warnings };
  }

  // ── What the screen needs ────────────────────────────────────────────────

  /** Validated payslips of an employee with their lines (reference salary). */
  static async referencePayslips(employeeId: string): Promise<RefPayslip[]> {
    const slips = (await SupabasePayslipsService.list({ employeeId })).filter(p => p.is_locked);
    const ids = slips.map(p => p.id);
    const [vars, items] = await Promise.all([SupabasePayslipsService.getVariablesFor(ids), SupabasePayslipsService.getItemsFor(ids)]);
    return slips.map(p => ({
      id: p.id, period_month: p.period_month, period_year: p.period_year, base_salary: p.base_salary,
      anciennete_amount: p.anciennete_amount, lines: payslipLines({ ...p, items: items.get(p.id) || [] }, vars.get(p.id) || []),
    }));
  }

  /** Remaining balance of the employee's active loans and advances. */
  static async loansRemaining(employeeId: string): Promise<number> {
    const loans = await LoanService.activeForEmployee(employeeId);
    return r2(loans.reduce((s, l) => s + (Number(l.remaining) || 0), 0));
  }

  /** The open payslip of the exit month (its lines join the settlement), or a reason it cannot. */
  static async exitMonthPayslip(employeeId: string, exitDate: string): Promise<{ payslip: Payslip | null; lines: PayslipLine[] }> {
    const [y, m] = exitDate.slice(0, 10).split('-').map(Number);
    const found = await SupabasePayslipsService.findForPeriod(employeeId, m, y);
    if (!found) return { payslip: null, lines: [] };
    const full = await SupabasePayslipsService.getById(found.id);
    return { payslip: full, lines: full ? await PayrollRunService.linesOf(full) : [] };
  }

  /** Paid-leave balance at the exit date, from the leave module. */
  static async leaveAtExit(e: Employee, exitDate: string, daysPerMonth: number): Promise<LeaveYear> {
    const [requests, openings] = await Promise.all([LeaveService.list(), LeaveOpeningService.list()]);
    const [y, m, d] = exitDate.slice(0, 10).split('-').map(Number);
    return leaveYear(e, y, new Date(y, m - 1, d), { requests, openings, daysPerMonth });
  }
}
