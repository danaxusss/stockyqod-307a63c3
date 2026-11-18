import { supabase } from './supabaseClient';
import { Company } from '../types';

// Company rows change rarely but were read by every component that knows the
// user (useAuth loads the company name on mount), several times per page
// change. Reads share one request and its answer for a minute; any write to
// companies clears the cache (invalidateCompaniesCache).
const COMPANY_CACHE_MS = 60 * 1000;
const companyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = companyCache.get(key);
  if (hit && Date.now() - hit.at < COMPANY_CACHE_MS) return hit.promise as Promise<T>;
  const promise = load();
  companyCache.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (companyCache.get(key)?.promise === promise) companyCache.delete(key); });
  return promise;
}

/** Drop cached company reads (after a company is created, edited or deleted). */
export function invalidateCompaniesCache(): void {
  companyCache.clear();
}

export class SupabaseCompaniesService {
  static async getAllCompanies(): Promise<Company[]> {
    return cached('all', async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as Company[];
    });
  }

  static async getCompanyById(id: string): Promise<Company | null> {
    return cached(`id:${id}`, async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as Company) || null;
    });
  }

  static async createCompany(input: Partial<Company>): Promise<Company> {
    invalidateCompaniesCache();
    const { data, error } = await supabase
      .from('companies')
      .insert({ ...input })
      .select()
      .single();
    if (error) throw error;
    return data as Company;
  }

  static async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    invalidateCompaniesCache();
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
    invalidateCompaniesCache();
    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
