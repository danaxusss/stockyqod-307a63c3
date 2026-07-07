import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';

export interface LeaveRequest {
  id: string; company_id: string; employee_id: string;
  type: 'paye' | 'maladie' | 'sans_solde' | 'exceptionnel' | 'autre';
  start_date: string; end_date: string; days: number;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null; approved_by: string | null; created_at: string;
  employee?: { full_name: string };
}

export interface EmployeeLoan {
  id: string; company_id: string; employee_id: string;
  label: string; kind: 'avance' | 'pret';
  amount: number; monthly_installment: number; remaining: number;
  start_month: number; start_year: number; active: boolean; created_at: string;
  employee?: { full_name: string };
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
    const { error } = await (supabase as any).from('leave_requests').insert({
      company_id: companyId, employee_id: r.employee_id, type: r.type || 'paye',
      start_date: r.start_date, end_date: r.end_date, days: r.days, reason: r.reason || null,
      status: 'pending', created_by: r.approved_by || null,
    });
    if (error) throw error;
  }

  static async setStatus(id: string, status: 'approved' | 'rejected', by: string | null): Promise<void> {
    const { error } = await (supabase as any).from('leave_requests').update({ status, approved_by: by }).eq('id', id);
    if (error) throw error;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('leave_requests').delete().eq('id', id);
    if (error) throw error;
  }
}

export class LoanService {
  static async list(): Promise<EmployeeLoan[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('employee_loans').select('*, employee:employees(full_name)').order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as EmployeeLoan[];
  }

  /** Active loans for an employee with a remaining balance (for payroll deduction). */
  static async activeForEmployee(employeeId: string): Promise<EmployeeLoan[]> {
    const { data, error } = await (supabase as any).from('employee_loans')
      .select('*').eq('employee_id', employeeId).eq('active', true).gt('remaining', 0);
    if (error) throw error;
    return (data || []) as EmployeeLoan[];
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

  /** Reduce remaining by the paid amount; deactivate when settled. */
  static async applyRepayment(loanId: string, amount: number): Promise<void> {
    const { data } = await (supabase as any).from('employee_loans').select('remaining').eq('id', loanId).single();
    const remaining = Math.max(0, Math.round(((Number(data?.remaining) || 0) - amount) * 100) / 100);
    const { error } = await (supabase as any).from('employee_loans')
      .update({ remaining, active: remaining > 0 }).eq('id', loanId);
    if (error) throw error;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('employee_loans').delete().eq('id', id);
    if (error) throw error;
  }
}
