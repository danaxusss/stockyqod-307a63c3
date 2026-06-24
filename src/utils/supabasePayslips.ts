import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Payslip, PayslipItem } from '../types';

type PayslipRow = Omit<Payslip, 'employee' | 'items'> & { items?: never; employee?: never };

function mapRow(row: Record<string, unknown>, items: PayslipItem[] = []): Payslip {
  return {
    id: row.id as string,
    company_id: row.company_id as string,
    employee_id: row.employee_id as string,
    employee: (row.employee as Payslip['employee']) || undefined,
    period_month: row.period_month as number,
    period_year: row.period_year as number,
    payslip_number: row.payslip_number as string,
    hours_worked: Number(row.hours_worked ?? 191),
    base_salary: Number(row.base_salary ?? 0),
    anciennete_rate: Number(row.anciennete_rate ?? 0),
    anciennete_amount: Number(row.anciennete_amount ?? 0),
    other_earnings: Number(row.other_earnings ?? 0),
    total_gross: Number(row.total_gross ?? 0),
    cnss_employee: Number(row.cnss_employee ?? 0),
    amo_employee: Number(row.amo_employee ?? 0),
    cimr_employee: Number(row.cimr_employee ?? 0),
    frais_pro: Number(row.frais_pro ?? 0),
    ir_amount: Number(row.ir_amount ?? 0),
    other_deductions: Number(row.other_deductions ?? 0),
    total_deductions: Number(row.total_deductions ?? 0),
    net_salary: Number(row.net_salary ?? 0),
    cnss_employer: Number(row.cnss_employer ?? 0),
    amo_employer: Number(row.amo_employer ?? 0),
    alloc_familiales: Number(row.alloc_familiales ?? 0),
    notes: (row.notes as string) || undefined,
    items,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export class SupabasePayslipsService {
  static async list(filters?: {
    companyId?: string;
    employeeId?: string;
    year?: number;
    month?: number;
  }): Promise<Payslip[]> {
    const ctx = getCompanyContext();
    const companyId = filters?.companyId || ctx.companyId;

    let query = supabase
      .from('payslips')
      .select('*, employee:employees(full_name, position, cnss_number, hire_date)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });

    if (companyId && !ctx.bypassFilter) {
      query = query.eq('company_id', companyId);
    } else if (filters?.companyId) {
      query = query.eq('company_id', filters.companyId);
    }

    if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
    if (filters?.year) query = query.eq('period_year', filters.year);
    if (filters?.month) query = query.eq('period_month', filters.month);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(row => mapRow(row as Record<string, unknown>));
  }

  static async getById(id: string): Promise<Payslip | null> {
    const { data: payslipRow, error: e1 } = await supabase
      .from('payslips')
      .select('*, employee:employees(*)')
      .eq('id', id)
      .maybeSingle();
    if (e1) throw e1;
    if (!payslipRow) return null;

    const { data: itemsData, error: e2 } = await supabase
      .from('payslip_items')
      .select('*')
      .eq('payslip_id', id)
      .order('sort_order');
    if (e2) throw e2;

    return mapRow(payslipRow as Record<string, unknown>, (itemsData || []) as PayslipItem[]);
  }

  static async create(input: {
    company_id: string;
    employee_id: string;
    period_month: number;
    period_year: number;
    [key: string]: unknown;
  }): Promise<Payslip> {
    // Generate payslip number: PAIE-YYYY-NNN
    const { count } = await supabase
      .from('payslips')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', input.company_id)
      .eq('period_year', input.period_year);

    const seq = String((count ?? 0) + 1).padStart(3, '0');
    const payslip_number = `PAIE-${input.period_year}-${seq}`;

    const { data, error } = await supabase
      .from('payslips')
      .insert({ ...input, payslip_number })
      .select()
      .single();
    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  }

  static async update(id: string, updates: Partial<PayslipRow>): Promise<Payslip> {
    const { data, error } = await supabase
      .from('payslips')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  }

  static async delete(id: string): Promise<void> {
    const { error } = await supabase.from('payslips').delete().eq('id', id);
    if (error) throw error;
  }

  static async upsertItems(payslipId: string, items: Omit<PayslipItem, 'id' | 'payslip_id'>[]): Promise<PayslipItem[]> {
    // Delete existing then insert fresh
    await supabase.from('payslip_items').delete().eq('payslip_id', payslipId);

    if (items.length === 0) return [];

    const rows = items.map((item, idx) => ({
      ...item,
      payslip_id: payslipId,
      sort_order: idx,
    }));

    const { data, error } = await supabase
      .from('payslip_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return (data || []) as PayslipItem[];
  }
}
