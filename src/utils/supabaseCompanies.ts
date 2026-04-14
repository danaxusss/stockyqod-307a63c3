import { supabase } from './supabaseClient';
import { Company } from '../types';

export class SupabaseCompaniesService {
  static async getAllCompanies(): Promise<Company[]> {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data || []) as Company[];
  }

  static async getCompanyById(id: string): Promise<Company | null> {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Company) || null;
  }

  static async createCompany(input: Partial<Company>): Promise<Company> {
    const { data, error } = await supabase
      .from('companies')
      .insert({ ...input })
      .select()
      .single();
    if (error) throw error;
    return data as Company;
  }

  static async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    const { data, error } = await supabase
      .from('companies')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Company;
  }

  static async deleteCompany(id: string): Promise<void> {
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
