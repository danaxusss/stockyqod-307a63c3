import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Employee } from '../types';

export class SupabaseEmployeesService {
  static async list(companyId?: string): Promise<Employee[]> {
    const ctx = getCompanyContext();
    const scopedCompanyId = companyId || ctx.companyId;

    let query = supabase
      .from('employees')
      .select('*')
      .order('full_name');

    if (scopedCompanyId && !ctx.bypassFilter) {
      query = query.eq('company_id', scopedCompanyId);
    } else if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as Employee[];
  }

  static async getById(id: string): Promise<Employee | null> {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Employee) || null;
  }

  static async create(input: Omit<Employee, 'id' | 'created_at' | 'updated_at'>): Promise<Employee> {
    const { data, error } = await supabase
      .from('employees')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data as Employee;
  }

  static async update(id: string, updates: Partial<Omit<Employee, 'id' | 'created_at'>>): Promise<Employee> {
    const { data, error } = await supabase
      .from('employees')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Employee;
  }

  static async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('employees')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }
}
