import { payrollDb } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import { officialSettingsFor, type IrBracket, type PayrollSettings } from './payrollDefaults';

// The database stores the open-ended last IR band as this number.
const OPEN_END = 999999999;

type SettingsRow = Partial<Record<keyof PayrollSettings, unknown>> & { year?: number; ir_brackets?: unknown };

/** A saved row, or the official values of the year when there is none (or a value is missing). */
export function mapSettingsRow(row: SettingsRow | null | undefined, year: number): PayrollSettings {
  const official = officialSettingsFor(year);
  if (!row) return official;
  const n = (k: keyof PayrollSettings) => (row[k] == null || !Number.isFinite(Number(row[k])) ? official[k] as number : Number(row[k]));
  const brackets = Array.isArray(row.ir_brackets) && row.ir_brackets.length > 0
    ? (row.ir_brackets as unknown[][]).map(b => [Number(b[0]), Number(b[1]) >= OPEN_END ? Infinity : Number(b[1]), Number(b[2]), Number(b[3])] as IrBracket)
    : official.ir_brackets;
  return {
    year: row.year ?? year,
    cnss_rate_emp: n('cnss_rate_emp'), cnss_cap: n('cnss_cap'), amo_rate_emp: n('amo_rate_emp'),
    cnss_rate_er: n('cnss_rate_er'), af_rate: n('af_rate'), amo_rate_er: n('amo_rate_er'), tfp_rate: n('tfp_rate'),
    frais_pro_low: n('frais_pro_low'), frais_pro_high: n('frais_pro_high'),
    frais_pro_threshold: n('frais_pro_threshold'), frais_pro_cap: n('frais_pro_cap'),
    family_ded_per_dep: n('family_ded_per_dep'), family_ded_max: n('family_ded_max'),
    smig_hourly: n('smig_hourly'), conges_days_per_month: n('conges_days_per_month'),
    ir_brackets: brackets,
  };
}

export class PayrollSettingsService {
  /** Settings for a year: the company's saved ones, else the official values of that year. */
  static async get(year: number): Promise<PayrollSettings> {
    // Payroll is per company for every role: a super admin reads the
    // signed-in company's settings, not whichever company saved some.
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_settings').select('*').eq('year', year);
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return mapSettingsRow(data as SettingsRow | null, year);
  }

  /** Whether the company saved settings for that year (else it uses the official ones). */
  static async isSaved(year: number): Promise<boolean> {
    const { companyId } = getCompanyContext();
    let q = payrollDb().from('payroll_settings').select('id').eq('year', year);
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return !!data;
  }

  static async upsert(year: number, s: PayrollSettings): Promise<void> {
    const { companyId } = getCompanyContext();
    const brackets = s.ir_brackets.map(b => [b[0], b[1] === Infinity ? OPEN_END : b[1], b[2], b[3]]);
    const { error } = await payrollDb().from('payroll_settings').upsert({
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
