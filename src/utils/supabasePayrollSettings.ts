import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from './payrollDefaults';

function mapRow(row: any): PayrollSettings {
  if (!row) return { ...DEFAULT_PAYROLL_SETTINGS };
  return {
    year: row.year,
    cnss_rate_emp: Number(row.cnss_rate_emp), cnss_cap: Number(row.cnss_cap), amo_rate_emp: Number(row.amo_rate_emp),
    cnss_rate_er: Number(row.cnss_rate_er), af_rate: Number(row.af_rate), amo_rate_er: Number(row.amo_rate_er),
    tfp_rate: Number(row.tfp_rate),
    frais_pro_low: Number(row.frais_pro_low), frais_pro_high: Number(row.frais_pro_high),
    frais_pro_threshold: Number(row.frais_pro_threshold), frais_pro_cap: Number(row.frais_pro_cap),
    family_ded_per_dep: Number(row.family_ded_per_dep), family_ded_max: Number(row.family_ded_max),
    smig_hourly: Number(row.smig_hourly), conges_days_per_month: Number(row.conges_days_per_month),
    ir_brackets: (row.ir_brackets || DEFAULT_PAYROLL_SETTINGS.ir_brackets).map((b: any[]) => [Number(b[0]), b[1] >= 999999999 ? Infinity : Number(b[1]), Number(b[2]), Number(b[3])]),
  };
}

export class PayrollSettingsService {
  /** Settings for a year, falling back to statutory defaults if none saved. */
  static async get(year: number): Promise<PayrollSettings> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('payroll_settings').select('*').eq('year', year);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return mapRow(data);
  }

  static async upsert(year: number, s: PayrollSettings): Promise<void> {
    const { companyId } = getCompanyContext();
    const brackets = s.ir_brackets.map(b => [b[0], b[1] === Infinity ? 999999999 : b[1], b[2], b[3]]);
    const { error } = await (supabase as any).from('payroll_settings').upsert({
      company_id: companyId, year,
      cnss_rate_emp: s.cnss_rate_emp, cnss_cap: s.cnss_cap, amo_rate_emp: s.amo_rate_emp,
      cnss_rate_er: s.cnss_rate_er, af_rate: s.af_rate, amo_rate_er: s.amo_rate_er, tfp_rate: s.tfp_rate,
      frais_pro_low: s.frais_pro_low, frais_pro_high: s.frais_pro_high,
      frais_pro_threshold: s.frais_pro_threshold, frais_pro_cap: s.frais_pro_cap,
      family_ded_per_dep: s.family_ded_per_dep, family_ded_max: s.family_ded_max,
      smig_hourly: s.smig_hourly, conges_days_per_month: s.conges_days_per_month, ir_brackets: brackets,
    }, { onConflict: 'company_id,year' });
    if (error) throw error;
  }
}
