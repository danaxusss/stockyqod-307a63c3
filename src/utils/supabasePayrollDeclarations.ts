// Data of the declaration files: the company's return settings, the IR
// payments, and the year's payslips with their bases (older payslips have
// their bases worked out from their own lines). The two tables come from
// 20261126140000_payroll_declarations.sql; before it has run, reads answer
// "not available" and writes are refused with a message.

import { payrollDb } from './payrollDb';
import { getCompanyContext } from './supabaseCompanyFilter';
import { SupabasePayslipsService } from './supabasePayslips';
import { computeForPayslip } from './payslipCompute';
import { lineFromRow } from './payslipLines';
import type { PayrollSettings } from './payrollDefaults';
import type { Employee, Payslip } from '../types';
import type { IrPaymentMode, RebuiltBases } from './dts9421';

export const DECLARATIONS_MIGRATION = '20261126140000_payroll_declarations.sql';
const NOT_RUN = `Exécutez d'abord la migration ${DECLARATIONS_MIGRATION} dans Supabase.`;

/** A table the database does not have (yet). */
export function isMissingTableError(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|relation .+ does not exist/i.test(e.message || '');
}

export interface DeclarationSettings {
  commune_code: string;
  fax: string;
  taxpayer_last_name: string;
  taxpayer_first_name: string;
  taxpayer_cin: string;
  family_field_as_amount: boolean;
}

export const EMPTY_DECLARATION_SETTINGS: DeclarationSettings = {
  commune_code: '', fax: '', taxpayer_last_name: '', taxpayer_first_name: '', taxpayer_cin: '', family_field_as_amount: false,
};

export interface IrPayment {
  id: string;
  year: number;
  month: number;
  reference: string;
  receipt_number: string;
  payment_date: string;
  principal: number;
  penalty: number;
  surcharge: number;
  payment_mode: IrPaymentMode;
}

const companyId = () => getCompanyContext().companyId;
const str = (v: unknown) => (v == null ? '' : String(v));

export class PayrollDeclarationsService {
  /** The company's settings; `available` is false before the migration has run. */
  static async getSettings(): Promise<{ available: boolean; settings: DeclarationSettings }> {
    const id = companyId();
    let q = payrollDb().from('payroll_declaration_settings').select('*');
    if (id) q = q.eq('company_id', id);
    const { data, error } = await q.limit(1);
    if (error) {
      if (isMissingTableError(error)) return { available: false, settings: { ...EMPTY_DECLARATION_SETTINGS } };
      throw error;
    }
    const row = ((data || []) as Record<string, unknown>[])[0];
    if (!row) return { available: true, settings: { ...EMPTY_DECLARATION_SETTINGS } };
    return {
      available: true,
      settings: {
        commune_code: str(row.commune_code), fax: str(row.fax),
        taxpayer_last_name: str(row.taxpayer_last_name), taxpayer_first_name: str(row.taxpayer_first_name),
        taxpayer_cin: str(row.taxpayer_cin), family_field_as_amount: row.family_field_as_amount === true,
      },
    };
  }

  static async saveSettings(s: DeclarationSettings): Promise<void> {
    const id = companyId();
    if (!id) throw new Error('Aucune société sélectionnée.');
    const row = {
      company_id: id,
      commune_code: s.commune_code.trim() || null, fax: s.fax.trim() || null,
      taxpayer_last_name: s.taxpayer_last_name.trim() || null, taxpayer_first_name: s.taxpayer_first_name.trim() || null,
      taxpayer_cin: s.taxpayer_cin.trim() || null, family_field_as_amount: !!s.family_field_as_amount,
    };
    const { error } = await payrollDb().from('payroll_declaration_settings').upsert(row, { onConflict: 'company_id' });
    if (error) throw isMissingTableError(error) ? new Error(`Paramètres non enregistrés. ${NOT_RUN}`) : error;
  }

  /** IR payments of a year; `available` is false before the migration has run. */
  static async listPayments(year: number): Promise<{ available: boolean; payments: IrPayment[] }> {
    const id = companyId();
    let q = payrollDb().from('payroll_ir_payments').select('*').eq('year', year);
    if (id) q = q.eq('company_id', id);
    const { data, error } = await q.order('month').order('payment_date');
    if (error) {
      if (isMissingTableError(error)) return { available: false, payments: [] };
      throw error;
    }
    return {
      available: true,
      payments: ((data || []) as Record<string, unknown>[]).map(r => ({
        id: str(r.id), year: Number(r.year), month: Number(r.month), reference: str(r.reference), receipt_number: str(r.receipt_number),
        payment_date: str(r.payment_date).slice(0, 10), principal: Number(r.principal) || 0, penalty: Number(r.penalty) || 0,
        surcharge: Number(r.surcharge) || 0, payment_mode: (['ES', 'CH', 'SIR'].includes(str(r.payment_mode)) ? r.payment_mode : 'SIR') as IrPaymentMode,
      })),
    };
  }

  static async addPayment(p: Omit<IrPayment, 'id'>): Promise<void> {
    const id = companyId();
    if (!id) throw new Error('Aucune société sélectionnée.');
    if (!p.payment_date) throw new Error('Date du versement obligatoire.');
    if (!(p.month >= 1 && p.month <= 12)) throw new Error('Mois invalide.');
    if ([p.principal, p.penalty, p.surcharge].some(v => !(Number(v) >= 0))) throw new Error('Montants positifs uniquement.');
    const { error } = await payrollDb().from('payroll_ir_payments').insert({ ...p, company_id: id, reference: p.reference.trim() || null, receipt_number: p.receipt_number.trim() || null });
    if (error) throw isMissingTableError(error) ? new Error(`Versement non enregistré. ${NOT_RUN}`) : error;
  }

  static async deletePayment(paymentId: string): Promise<void> {
    const { error } = await payrollDb().from('payroll_ir_payments').delete().eq('id', paymentId);
    if (error) throw error;
  }

  /**
   * The year's payslips, and for every payslip without stored taxable bases
   * (saved before 2026) the bases worked out from its own lines with the
   * year's settings.
   */
  static async yearPayslips(year: number, employees: Map<string, Employee>, settings: PayrollSettings): Promise<{ payslips: Payslip[]; rebuilt: Map<string, RebuiltBases> }> {
    const payslips = await SupabasePayslipsService.list({ year });
    const older = payslips.filter(p => p.ir_taxable_gross == null || p.net_taxable == null || p.cnss_base == null);
    const rebuilt = new Map<string, RebuiltBases>();
    if (older.length) {
      const vars = await SupabasePayslipsService.getVariablesFor(older.map(p => p.id));
      for (const p of older) {
        const res = computeForPayslip(p, employees.get(p.employee_id), (vars.get(p.id) || []).map(lineFromRow), settings);
        rebuilt.set(p.id, { brut_imposable: res.brut_imposable, net_imposable: res.net_imposable, cnss_base: res.cnss_base });
      }
    }
    return { payslips, rebuilt };
  }
}
