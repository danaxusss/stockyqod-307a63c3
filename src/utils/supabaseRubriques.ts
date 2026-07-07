import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { DEFAULT_RUBRIQUES } from './payrollDefaults';

export interface Rubrique {
  id: string;
  company_id: string;
  code: string;
  label: string;
  type: 'gain' | 'retenue';
  base: 'fixe' | 'pourcentage_base' | 'heures' | 'formule';
  rate: number;
  soumis_cnss: boolean;
  soumis_amo: boolean;
  soumis_ir: boolean;
  soumis_cimr: boolean;
  inclus_anciennete: boolean;
  compte_comptable: string | null;
  active: boolean;
  sort_order: number;
}

export class RubriquesService {
  static async list(): Promise<Rubrique[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('payroll_rubriques').select('*').order('sort_order').order('code');
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as Rubrique[];
  }

  static async initDefaults(): Promise<number> {
    const { companyId } = getCompanyContext();
    const existing = await this.list();
    const have = new Set(existing.map(r => r.code));
    const rows = DEFAULT_RUBRIQUES.filter(r => !have.has(r.code)).map((r, i) => ({
      company_id: companyId, code: r.code, label: r.label, type: r.type, base: r.base, rate: r.rate ?? 0,
      soumis_cnss: r.soumis_cnss, soumis_amo: r.soumis_amo, soumis_ir: r.soumis_ir, soumis_cimr: r.soumis_cimr,
      inclus_anciennete: r.inclus_anciennete, compte_comptable: r.compte_comptable ?? null, sort_order: i,
    }));
    if (rows.length > 0) {
      const { error } = await (supabase as any).from('payroll_rubriques').insert(rows);
      if (error) throw error;
    }
    return rows.length;
  }

  static async upsert(r: Partial<Rubrique> & { code: string; label: string; type: string }): Promise<Rubrique> {
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).from('payroll_rubriques')
      .upsert({ ...r, company_id: r.company_id ?? companyId }, { onConflict: 'company_id,code' }).select().single();
    if (error) throw error;
    return data as Rubrique;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await (supabase as any).from('payroll_rubriques').delete().eq('id', id);
    if (error) throw error;
  }
}
