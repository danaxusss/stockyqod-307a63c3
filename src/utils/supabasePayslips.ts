import { payrollDb, writeWithFallback } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Payslip, PayslipItem } from '../types';
import { lineToRow, NEW_VARIABLE_COLUMNS, type PayslipLine } from './payslipLines';

/** Payslip columns added by the 2026 payroll migration. */
export const NEW_PAYSLIP_COLUMNS = [
  'cimr_employer', 'ir_taxable_gross', 'net_taxable', 'cnss_base', 'amo_base', 'cnss_days',
  'dependents_count', 'ir_regularisation', 'ir_regularisation_ids',
];

const numOrNull = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Dropping the new columns would lose an IR regularisation: refuse instead. */
const regularisationLost = (row: Record<string, unknown>) =>
  (Number(row.ir_regularisation) || 0) !== 0 ? 'La régularisation IR ne peut pas être enregistrée tant que la base n\'est pas à jour.' : null;


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
    tfp_employer: Number(row.tfp_employer ?? 0),
    cimr_employer: Number(row.cimr_employer ?? 0),
    ir_taxable_gross: numOrNull(row.ir_taxable_gross),
    net_taxable: numOrNull(row.net_taxable),
    cnss_base: numOrNull(row.cnss_base),
    amo_base: numOrNull(row.amo_base),
    cnss_days: numOrNull(row.cnss_days) ?? 26,
    dependents_count: numOrNull(row.dependents_count),
    ir_regularisation: Number(row.ir_regularisation ?? 0),
    ir_regularisation_ids: Array.isArray(row.ir_regularisation_ids) ? (row.ir_regularisation_ids as string[]) : [],
    is_locked: row.is_locked === true,
    run_id: (row.run_id as string) || null,
    loan_repayments: Array.isArray(row.loan_repayments) ? (row.loan_repayments as { loan_id: string; amount: number }[]) : null,
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

    let query = payrollDb().from('payslips')
      .select('*, employee:employees(full_name, position, cnss_number, hire_date)')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false });

    // Payroll is per company, for every role.
    if (companyId) query = query.eq('company_id', companyId);

    if (filters?.employeeId) query = query.eq('employee_id', filters.employeeId);
    if (filters?.year) query = query.eq('period_year', filters.year);
    if (filters?.month) query = query.eq('period_month', filters.month);

    const { data, error } = await query;
    if (error) throw error;
    return ((data || []) as Record<string, unknown>[]).map(row => mapRow(row));
  }

  static async getById(id: string): Promise<Payslip | null> {
    const { data: payslipRow, error: e1 } = await payrollDb().from('payslips')
      .select('*, employee:employees(*)')
      .eq('id', id)
      .maybeSingle();
    if (e1) throw e1;
    if (!payslipRow) return null;

    const { data: itemsData, error: e2 } = await payrollDb().from('payslip_items')
      .select('*')
      .eq('payslip_id', id)
      .order('sort_order');
    if (e2) throw e2;

    return mapRow(payslipRow as Record<string, unknown>, (itemsData || []) as PayslipItem[]);
  }

  /** The payslip of an employee for a month, if there is one (from a run or made by hand). */
  static async findForPeriod(employeeId: string, month: number, year: number): Promise<Payslip | null> {
    const { data, error } = await payrollDb().from('payslips').select('*')
      .eq('employee_id', employeeId).eq('period_month', month).eq('period_year', year).limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  static async create(input: {
    company_id: string;
    employee_id: string;
    period_month: number;
    period_year: number;
    [key: string]: unknown;
  }): Promise<Payslip> {
    // One payslip per employee and month, whether from a run or by hand.
    const existing = await this.findForPeriod(input.employee_id, input.period_month, input.period_year);
    if (existing) throw new Error(`Un bulletin existe déjà pour cet employé et ce mois (${existing.payslip_number}).`);
    // Generate payslip number: PAIE-YYYY-NNN
    const seq = String(await this.nextNumberSeq(input.company_id, input.period_year)).padStart(3, '0');
    const payslip_number = `PAIE-${input.period_year}-${seq}`;

    const { data, error } = await writeWithFallback(
      p => payrollDb().from('payslips').insert(p).select().single(),
      { ...input, payslip_number }, NEW_PAYSLIP_COLUMNS, regularisationLost,
    );
    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  }

  /**
   * Next PAIE-YYYY-NNN sequence for a company and year: one past the highest
   * number used. Counting payslips repeated a number once one was deleted.
   */
  static async nextNumberSeq(companyId: string | null, year: number): Promise<number> {
    type NumberQuery = {
      eq(column: string, value: unknown): NumberQuery;
      order(column: string): NumberQuery;
      range(from: number, to: number): PromiseLike<{ data: { payslip_number: string | null }[] | null; error: unknown }>;
    };
    const payslips = () => (payrollDb() as unknown as { from(table: string): { select(columns: string): NumberQuery } }).from('payslips');
    let highest = 0;
    // Page by page: the server returns at most 1,000 rows per request.
    for (let from = 0; ; from += 1000) {
      let q = payslips().select('id, payslip_number').eq('period_year', year);
      if (companyId) q = q.eq('company_id', companyId);
      const { data, error } = await q.order('id').range(from, from + 999);
      if (error) throw error;
      for (const r of data || []) {
        highest = Math.max(highest, Number(/-(\d+)$/.exec(r.payslip_number || '')?.[1]) || 0);
      }
      if (!data || data.length < 1000) return highest + 1;
    }
  }

  static async update(id: string, updates: Partial<Omit<Payslip, 'employee' | 'items'>>): Promise<Payslip> {
    const { data, error } = await writeWithFallback(
      p => payrollDb().from('payslips').update(p).eq('id', id).select().single(),
      { ...updates, updated_at: new Date().toISOString() } as Record<string, unknown>, NEW_PAYSLIP_COLUMNS, regularisationLost,
    );
    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  }

  static async delete(id: string): Promise<void> {
    const { error } = await payrollDb().from('payslips').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Loan / advance repayments withheld on each payslip (AVANCE lines). Run
   * payslips from before those lines existed put only loans in other_deductions.
   */
  static async loanDeductions(payslips: Pick<Payslip, 'id' | 'run_id' | 'other_deductions'>[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (payslips.length === 0) return out;
    const withLines = new Set<string>();
    for (let i = 0; i < payslips.length; i += 300) {
      const ids = payslips.slice(i, i + 300).map(p => p.id);
      const { data, error } = await payrollDb().from('payslip_variables')
        .select('payslip_id, code, type, amount').in('payslip_id', ids);
      if (error) throw error;
      for (const v of (data || []) as { payslip_id: string; code: string | null; type: string; amount: number }[]) {
        withLines.add(v.payslip_id);
        if (v.type === 'retenue' && v.code === 'AVANCE') out.set(v.payslip_id, (out.get(v.payslip_id) || 0) + (Number(v.amount) || 0));
      }
    }
    for (const p of payslips) {
      if (!withLines.has(p.id) && p.run_id && p.other_deductions > 0) out.set(p.id, p.other_deductions);
    }
    return out;
  }

  static async getVariables(payslipId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await payrollDb().from('payslip_variables').select('*').eq('payslip_id', payslipId).order('sort_order');
    if (error) throw error;
    return (data || []) as Record<string, unknown>[];
  }

  /** Variables of several payslips, by payslip id (in line order). */
  static async getVariablesFor(payslipIds: string[]): Promise<Map<string, Record<string, unknown>[]>> {
    const out = new Map<string, Record<string, unknown>[]>();
    for (let i = 0; i < payslipIds.length; i += 300) {
      const { data, error } = await payrollDb().from('payslip_variables').select('*')
        .in('payslip_id', payslipIds.slice(i, i + 300)).order('sort_order');
      if (error) throw error;
      for (const v of (data || []) as Record<string, unknown>[]) {
        const id = v.payslip_id as string;
        out.set(id, [...(out.get(id) || []), v]);
      }
    }
    return out;
  }

  /** Items (legacy free-text lines) of several payslips, by payslip id. */
  static async getItemsFor(payslipIds: string[]): Promise<Map<string, PayslipItem[]>> {
    const out = new Map<string, PayslipItem[]>();
    for (let i = 0; i < payslipIds.length; i += 300) {
      const { data, error } = await payrollDb().from('payslip_items').select('*')
        .in('payslip_id', payslipIds.slice(i, i + 300)).order('sort_order');
      if (error) throw error;
      for (const it of (data || []) as PayslipItem[]) {
        const id = it.payslip_id as string;
        out.set(id, [...(out.get(id) || []), it]);
      }
    }
    return out;
  }

  static async replaceVariables(payslipId: string, companyId: string | null, lines: PayslipLine[]): Promise<void> {
    await payrollDb().from('payslip_variables').delete().eq('payslip_id', payslipId);
    if (lines.length === 0) return;
    const rows = lines.map((l, i) => lineToRow(l, payslipId, companyId, i));
    // Without the migration the AMO flag, the hours base and the ceilings
    // cannot be kept: the line amounts and the other flags still are.
    const { error } = await writeWithFallback(p => payrollDb().from('payslip_variables').insert(p), rows, NEW_VARIABLE_COLUMNS);
    if (error) throw error;
  }

  static async upsertItems(payslipId: string, items: Omit<PayslipItem, 'id' | 'payslip_id'>[]): Promise<PayslipItem[]> {
    // Delete existing then insert fresh
    await payrollDb().from('payslip_items').delete().eq('payslip_id', payslipId);

    if (items.length === 0) return [];

    const rows = items.map((item, idx) => ({
      ...item,
      payslip_id: payslipId,
      sort_order: idx,
    }));

    const { data, error } = await payrollDb().from('payslip_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return (data || []) as PayslipItem[];
  }
}
