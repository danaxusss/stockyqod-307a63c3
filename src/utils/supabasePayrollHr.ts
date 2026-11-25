import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { HR_MIGRATION, isCheckViolation, isMissingTableError, payrollDb, runMigrationHint, writeWithFallback } from './payrollDb';
import { fixedCivilHolidays, type Holiday, type OpeningBalance } from './hrLeave';

export interface LeaveRequest {
  id: string; company_id: string; employee_id: string;
  /** absence: unjustified absence (unpaid). */
  type: 'paye' | 'maladie' | 'sans_solde' | 'exceptionnel' | 'absence' | 'autre';
  start_date: string; end_date: string; days: number;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null; approved_by: string | null; created_at: string;
  /** Sick leave paid by the employer anyway (no absence line). */
  pay_maintained?: boolean | null;
  employee?: { full_name: string };
}

export interface EmployeeLoan {
  id: string; company_id: string; employee_id: string;
  label: string; kind: 'avance' | 'pret';
  amount: number; monthly_installment: number; remaining: number;
  start_month: number; start_year: number; active: boolean; created_at: string;
  employee?: { full_name: string };
}

/** Thrown when the HR migration has not been run and the data cannot be stored. */
export class MigrationMissingError extends Error {
  constructor(what: string) {
    super(`${what} ${runMigrationHint(HR_MIGRATION)}`);
    this.name = 'MigrationMissingError';
  }
}

export class LeaveService {
  static async list(): Promise<LeaveRequest[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('leave_requests').select('*, employee:employees(full_name)').order('start_date', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as LeaveRequest[];
  }

  static async create(r: Partial<LeaveRequest> & { employee_id: string; start_date: string; end_date: string; days: number }): Promise<void> {
    const { companyId } = getCompanyContext();
    const row: Record<string, unknown> = {
      company_id: companyId, employee_id: r.employee_id, type: r.type || 'paye',
      start_date: r.start_date, end_date: r.end_date, days: r.days, reason: r.reason || null,
      status: 'pending', created_by: r.approved_by || null, pay_maintained: !!r.pay_maintained,
    };
    // Without the migration the "maintained" flag cannot be kept: refuse
    // rather than turn a paid sick leave into an unpaid one.
    const { error } = await writeWithFallback(p => payrollDb().from('leave_requests').insert(p), row, ['pay_maintained'],
      p => (p.pay_maintained ? 'Le maintien du salaire pendant la maladie ne peut pas être enregistré tant que la base n\'est pas à jour.' : null), HR_MIGRATION);
    if (error && isCheckViolation(error) && r.type === 'absence') throw new MigrationMissingError('Le type « Absence non justifiée » n\'est pas encore accepté par la base.');
    if (error) throw error;
  }

  static async setStatus(id: string, status: 'approved' | 'rejected', by: string | null): Promise<LeaveRequest | null> {
    const { data, error } = await payrollDb().from('leave_requests').update({ status, approved_by: by }).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return (data as LeaveRequest) || null;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('leave_requests').delete().eq('id', id);
    if (error) throw error;
  }
}

export class LoanService {
  static async list(): Promise<EmployeeLoan[]> {
    const { companyId } = getCompanyContext();
    let q = (supabase as any).from('employee_loans').select('*, employee:employees(full_name)').order('created_at', { ascending: false });
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as EmployeeLoan[];
  }

  /**
   * Active loans for an employee with a remaining balance (for payroll
   * deduction). With a period, only loans whose repayments have started by then.
   */
  static async activeForEmployee(employeeId: string, period?: { month: number; year: number }): Promise<EmployeeLoan[]> {
    const { data, error } = await (supabase as any).from('employee_loans')
      .select('*').eq('employee_id', employeeId).eq('active', true).gt('remaining', 0);
    if (error) throw error;
    const loans = ((data || []) as EmployeeLoan[]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!period) return loans;
    const at = period.year * 12 + period.month;
    return loans.filter(l => !l.start_year || !l.start_month || l.start_year * 12 + l.start_month <= at);
  }

  static async create(l: Partial<EmployeeLoan> & { employee_id: string; amount: number; monthly_installment: number }): Promise<void> {
    const { companyId } = getCompanyContext();
    const { error } = await (supabase as any).from('employee_loans').insert({
      company_id: companyId, employee_id: l.employee_id, label: l.label || 'Avance', kind: l.kind || 'avance',
      amount: l.amount, monthly_installment: l.monthly_installment, remaining: l.amount,
      start_month: l.start_month || (new Date().getMonth() + 1), start_year: l.start_year || new Date().getFullYear(),
      active: true, created_by: (l as any).created_by || null,
    });
    if (error) throw error;
  }

  /** A loan nothing was repaid on yet (remaining = amount) can still be changed. */
  static canEdit(l: Pick<EmployeeLoan, 'amount' | 'remaining'>): boolean {
    return Math.abs((Number(l.amount) || 0) - (Number(l.remaining) || 0)) < 0.005;
  }

  /** Changes a loan with no repayment yet; the remaining balance follows the amount. */
  static async update(id: string, patch: Pick<EmployeeLoan, 'label' | 'kind' | 'amount' | 'monthly_installment' | 'start_month' | 'start_year'>): Promise<void> {
    const { data, error: readErr } = await payrollDb().from('employee_loans').select('*').eq('id', id).maybeSingle();
    if (readErr) throw readErr;
    if (!data) throw new Error('Avance introuvable.');
    if (!this.canEdit(data as EmployeeLoan)) throw new Error('Un remboursement a déjà été retenu : cette avance ne peut plus être modifiée.');
    const { error } = await payrollDb().from('employee_loans').update({ ...patch, remaining: patch.amount, active: patch.amount > 0 }).eq('id', id);
    if (error) throw error;
  }

  /** Reduce remaining by the paid amount; deactivate when settled. */
  static async applyRepayment(loanId: string, amount: number): Promise<void> {
    const { data } = await (supabase as any).from('employee_loans').select('remaining').eq('id', loanId).single();
    const remaining = Math.max(0, Math.round(((Number(data?.remaining) || 0) - amount) * 100) / 100);
    const { error } = await (supabase as any).from('employee_loans')
      .update({ remaining, active: remaining > 0 }).eq('id', loanId);
    if (error) throw error;
  }

  /** Gives back a repayment (a validation undone). */
  static async reverseRepayment(loanId: string, amount: number): Promise<void> {
    const { data, error: readErr } = await payrollDb().from('employee_loans').select('remaining, amount').eq('id', loanId).maybeSingle();
    if (readErr) throw readErr;
    if (!data) return;
    const row = data as { remaining: number; amount: number };
    const remaining = Math.min(Number(row.amount) || Infinity, Math.round(((Number(row.remaining) || 0) + amount) * 100) / 100);
    const { error } = await payrollDb().from('employee_loans').update({ remaining, active: remaining > 0 }).eq('id', loanId);
    if (error) throw error;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('employee_loans').delete().eq('id', id);
    if (error) throw error;
  }
}

// ── Public holidays ─────────────────────────────────────────────────────────

export interface HolidayYear {
  holidays: Holiday[];
  /** False: the fixed civil holidays shown by default, nothing saved yet. */
  saved: boolean;
  /** The table does not exist yet (HR migration not run). */
  migrationMissing: boolean;
}

export class HolidayService {
  /** The company's holidays of a year; the fixed civil ones when none were saved. */
  static async forYear(year: number): Promise<HolidayYear> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('public_holidays').select('*').eq('year', year).order('holiday_date');
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { holidays: fixedCivilHolidays(year), saved: false, migrationMissing: true };
      throw error;
    }
    const rows = (data || []) as { holiday_date: string; label: string; kind: string }[];
    if (rows.length === 0) return { holidays: fixedCivilHolidays(year), saved: false, migrationMissing: false };
    return {
      holidays: rows.map(r => ({ date: String(r.holiday_date).slice(0, 10), label: r.label, kind: r.kind === 'religieux' ? 'religieux' : 'civil' })),
      saved: true, migrationMissing: false,
    };
  }

  /** Dates (YYYY-MM-DD) of the holidays of every year a period touches. */
  static async datesBetween(start: string, end: string): Promise<string[]> {
    const out: string[] = [];
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
      out.push(...(await this.forYear(y)).holidays.map(h => h.date));
    }
    return out;
  }

  /** Replaces the year's list. */
  static async saveYear(year: number, holidays: Holiday[]): Promise<void> {
    const { companyId } = getCompanyContext();
    let del = payrollDb().from('public_holidays').delete().eq('year', year);
    if (companyId) del = del.eq('company_id', companyId);
    const { error: delErr } = await del;
    if (delErr) {
      if (isMissingTableError(delErr)) throw new MigrationMissingError('Les jours fériés ne peuvent pas être enregistrés tant que la base n\'est pas à jour.');
      throw delErr;
    }
    const rows = holidays.filter(h => h.date && h.date.startsWith(String(year))).map(h => ({ company_id: companyId, year, holiday_date: h.date, label: h.label, kind: h.kind }));
    if (!rows.length) return;
    const { error } = await payrollDb().from('public_holidays').insert(rows);
    if (error) throw error;
  }
}

// ── Company HR settings (weekly rest day) ───────────────────────────────────

export interface HrSettings { weekly_rest_day: number; migrationMissing: boolean }

export class HrSettingsService {
  static async get(): Promise<HrSettings> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_hr_settings').select('*');
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return { weekly_rest_day: 0, migrationMissing: true };
      throw error;
    }
    const day = Number((data as { weekly_rest_day?: number } | null)?.weekly_rest_day);
    return { weekly_rest_day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0, migrationMissing: false };
  }

  static async setRestDay(day: number): Promise<void> {
    const { companyId } = getCompanyContext();
    const { error } = await payrollDb().from('payroll_hr_settings').upsert({ company_id: companyId, weekly_rest_day: day }, { onConflict: 'company_id' });
    if (error) {
      if (isMissingTableError(error)) throw new MigrationMissingError('Le jour de repos ne peut pas être enregistré tant que la base n\'est pas à jour.');
      throw error;
    }
  }
}

// ── Opening leave balances ──────────────────────────────────────────────────

export class LeaveOpeningService {
  /** Opening balances typed by the user ([] before the migration). */
  static async list(): Promise<OpeningBalance[]> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('leave_opening_balances').select('*');
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    return ((data || []) as { employee_id: string; year: number; days: number }[]).map(r => ({ employee_id: r.employee_id, year: Number(r.year), days: Number(r.days) || 0 }));
  }

  /** Sets (or, with null, removes) an employee's opening balance for a year. */
  static async set(employeeId: string, year: number, days: number | null): Promise<void> {
    const { companyId } = getCompanyContext();
    const { error } = days == null
      ? await payrollDb().from('leave_opening_balances').delete().eq('employee_id', employeeId).eq('year', year)
      : await payrollDb().from('leave_opening_balances').upsert({ company_id: companyId, employee_id: employeeId, year, days }, { onConflict: 'employee_id,year' });
    if (error) {
      if (isMissingTableError(error)) throw new MigrationMissingError('Le solde d\'ouverture ne peut pas être enregistré tant que la base n\'est pas à jour.');
      throw error;
    }
  }
}

// ── Numbered HR documents (certificates) ────────────────────────────────────

export type HrDocumentKind = 'attestation_travail' | 'attestation_salaire' | 'certificat_travail';
const DOC_PREFIX: Record<HrDocumentKind, string> = { attestation_travail: 'ATT', attestation_salaire: 'ATS', certificat_travail: 'CT' };

export class HrDocumentService {
  /**
   * Registers an issued certificate and returns its number (ATT-2026-001…).
   * Before the migration nothing can be registered: a provisional number from
   * the date and time is returned, marked as such.
   */
  static async issue(kind: HrDocumentKind, employeeId: string, issuedOn: string, details: Record<string, unknown> = {}): Promise<{ number: string; registered: boolean }> {
    const { companyId } = getCompanyContext();
    const year = Number(issuedOn.slice(0, 4));
    const prefix = `${DOC_PREFIX[kind]}-${year}-`;
    let q = payrollDb().from('hr_documents').select('number').eq('kind', kind).eq('year', year);
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) {
        const now = new Date();
        return { number: `${prefix}P${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`, registered: false };
      }
      throw error;
    }
    const highest = ((data || []) as { number: string }[]).reduce((m, r) => Math.max(m, Number(/-(\d+)$/.exec(r.number || '')?.[1]) || 0), 0);
    const number = `${prefix}${String(highest + 1).padStart(3, '0')}`;
    const { error: insErr } = await payrollDb().from('hr_documents').insert({ company_id: companyId, kind, year, number, employee_id: employeeId, issued_on: issuedOn, details });
    if (insErr) throw insErr;
    return { number, registered: true };
  }
}

