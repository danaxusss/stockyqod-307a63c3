import { HR_MIGRATION, isCheckViolation, payrollDb, runMigrationHint, writeWithFallback } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Employee } from '../types';

/** Employee columns added by the 2026 payroll migration and the HR migration. */
const NEW_EMPLOYEE_COLUMNS = ['cimr_employer_rate', 'stage_start_date', 'stage_cnss_exempt'];
/** Data that would be dropped without the migrations: say so instead. */
const employerRateLost = (row: Record<string, unknown>) => {
  if (row.contract_type === 'Stage') return `Le contrat de stage ne peut pas être enregistré tant que la base n'est pas à jour. ${runMigrationHint(HR_MIGRATION)}`;
  if (row.stage_start_date) return `La date de début de stage ne peut pas être enregistrée tant que la base n'est pas à jour. ${runMigrationHint(HR_MIGRATION)}`;
  return row.cimr_employer_rate != null ? 'Le taux CIMR patronal ne peut pas être enregistré tant que la base n\'est pas à jour.' : null;
};

/** The old CHECK on contract_type refuses 'Stage' until the HR migration has run. */
function explain(error: { message?: string; code?: string } | null, row: Record<string, unknown>) {
  if (error && isCheckViolation(error) && row.contract_type === 'Stage') {
    return { message: `Le type de contrat « Stage » n'est pas encore accepté par la base. ${runMigrationHint(HR_MIGRATION)}` };
  }
  return error;
}

export class SupabaseEmployeesService {
  static async list(companyId?: string): Promise<Employee[]> {
    const ctx = getCompanyContext();
    const scopedCompanyId = companyId || ctx.companyId;

    let query = payrollDb().from('employees')
      .select('*')
      .order('full_name');

    // Payroll is per company, for every role (a super admin included).
    if (scopedCompanyId) query = query.eq('company_id', scopedCompanyId);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Employee[];
  }

  static async getById(id: string): Promise<Employee | null> {
    const { data, error } = await payrollDb().from('employees')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Employee) || null;
  }

  static async create(input: Omit<Employee, 'id' | 'created_at' | 'updated_at'>): Promise<Employee> {
    const { data, error } = await writeWithFallback(
      p => payrollDb().from('employees').insert(p).select().single(),
      input as unknown as Record<string, unknown>, NEW_EMPLOYEE_COLUMNS, employerRateLost,
    );
    if (error) throw explain(error, input as unknown as Record<string, unknown>);
    return data as Employee;
  }

  static async update(id: string, updates: Partial<Omit<Employee, 'id' | 'created_at'>>): Promise<Employee> {
    const { data, error } = await writeWithFallback(
      p => payrollDb().from('employees').update(p).eq('id', id).select().single(),
      { ...updates, updated_at: new Date().toISOString() } as Record<string, unknown>, NEW_EMPLOYEE_COLUMNS, employerRateLost,
    );
    if (error) throw explain(error, updates as Record<string, unknown>);
    return data as Employee;
  }

  static async deactivate(id: string): Promise<void> {
    const { error } = await payrollDb().from('employees')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }
}
