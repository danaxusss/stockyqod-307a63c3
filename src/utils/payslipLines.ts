import type { Payslip } from '../types';
import type { ExemptionCeiling } from './payrollDefaults';
import { hoursLineAmount, type PayLine } from './payrollCalc';

export type LineBase = 'fixe' | 'pourcentage_base' | 'heures' | 'formule';

/** A payslip line as stored in payslip_variables and edited on the payslip page. */
export interface PayslipLine extends PayLine {
  rubrique_id: string | null;
  code: string | null;
  label: string;
  type: 'gain' | 'retenue';
  amount: number;
  /** How the amount is worked out; 'heures' lines take hours in `quantity`. */
  base: LineBase;
  quantity: number;
  rate: number;
  soumis_cnss: boolean;
  soumis_amo: boolean;
  soumis_ir: boolean;
  soumis_cimr: boolean;
  inclus_anciennete: boolean;
  ir_ceiling: ExemptionCeiling | null;
  cnss_ceiling: ExemptionCeiling | null;
}

/** Payslip line for loan / advance repayments (the AVANCE rubrique). */
export const LOAN_LINE = { code: 'AVANCE', label: 'Retenue avance / prêt' };

const num = (v: unknown, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

function ceilingFrom(type: unknown, value: unknown): ExemptionCeiling | null {
  if ((type !== 'amount' && type !== 'percent') || value == null || !Number.isFinite(Number(value))) return null;
  return { type, value: Number(value) };
}

/** A payslip_variables row (or a rubrique) read back; columns added later may be missing. */
export function lineFromRow(v: Record<string, unknown>): PayslipLine {
  const base = (['fixe', 'pourcentage_base', 'heures', 'formule'] as const).includes(v.base as LineBase) ? v.base as LineBase : 'fixe';
  const soumisCnss = v.soumis_cnss !== false;
  return {
    rubrique_id: (v.rubrique_id as string) ?? null,
    code: (v.code as string) ?? null,
    label: String(v.label ?? ''),
    type: v.type === 'retenue' ? 'retenue' : 'gain',
    amount: num(v.amount),
    base,
    quantity: num(v.quantity, base === 'heures' ? 0 : 1),
    rate: num(v.rate),
    soumis_cnss: soumisCnss,
    // Before the AMO flag existed, AMO followed CNSS.
    soumis_amo: v.soumis_amo == null ? soumisCnss : v.soumis_amo !== false,
    soumis_ir: v.soumis_ir !== false,
    soumis_cimr: v.soumis_cimr === true,
    inclus_anciennete: v.inclus_anciennete === true,
    ir_ceiling: ceilingFrom(v.ir_ceiling_type, v.ir_ceiling_value),
    cnss_ceiling: ceilingFrom(v.cnss_ceiling_type, v.cnss_ceiling_value),
  };
}

/** Columns added by the 2026 payroll migration (dropped on a retry when it has not run). */
export const NEW_VARIABLE_COLUMNS = ['soumis_amo', 'base', 'ir_ceiling_type', 'ir_ceiling_value', 'cnss_ceiling_type', 'cnss_ceiling_value'];

/** Row to store in payslip_variables. */
export function lineToRow(l: PayslipLine, payslipId: string, companyId: string | null, sort: number): Record<string, unknown> {
  return {
    payslip_id: payslipId, company_id: companyId, rubrique_id: l.rubrique_id ?? null, code: l.code ?? null,
    label: l.label, type: l.type, quantity: num(l.quantity, 1), rate: num(l.rate), amount: num(l.amount),
    soumis_cnss: !!l.soumis_cnss, soumis_amo: !!l.soumis_amo, soumis_ir: !!l.soumis_ir, soumis_cimr: !!l.soumis_cimr,
    inclus_anciennete: !!l.inclus_anciennete, sort_order: sort, base: l.base || 'fixe',
    ir_ceiling_type: l.ir_ceiling?.type ?? null, ir_ceiling_value: l.ir_ceiling?.value ?? null,
    cnss_ceiling_type: l.cnss_ceiling?.type ?? null, cnss_ceiling_value: l.cnss_ceiling?.value ?? null,
  };
}

/** A blank line of a type. */
export function blankLine(type: 'gain' | 'retenue'): PayslipLine {
  const gain = type === 'gain';
  return {
    rubrique_id: null, code: null, label: '', type, amount: 0, base: 'fixe', quantity: 1, rate: 0,
    soumis_cnss: gain, soumis_amo: gain, soumis_ir: gain, soumis_cimr: false, inclus_anciennete: false,
    ir_ceiling: null, cnss_ceiling: null,
  };
}

/** The loan / advance repayment line (after tax). */
export function loanLine(amount: number): PayslipLine {
  return { ...blankLine('retenue'), code: LOAN_LINE.code, label: LOAN_LINE.label, amount };
}

/**
 * Lines of a payslip saved before payslip_variables existed: the free-text
 * items. Legacy deductions were always taken after tax: they stay so. Older
 * run payslips held the loan repayment only in other_deductions: it becomes a
 * line so a save does not drop it.
 */
export function legacyLines(p: Pick<Payslip, 'items' | 'other_deductions'>): PayslipLine[] {
  const out: PayslipLine[] = (p.items || []).map(it => {
    const gain = it.item_type === 'earning';
    return { ...blankLine(gain ? 'gain' : 'retenue'), label: it.label, amount: Number(it.amount) || 0, soumis_cnss: gain, soumis_amo: gain, soumis_ir: gain, inclus_anciennete: !!it.included_in_anciennete_base };
  });
  const listed = out.filter(l => l.type === 'retenue').reduce((s, l) => s + l.amount, 0);
  const missing = Math.round(((Number(p.other_deductions) || 0) - listed) * 100) / 100;
  if (missing > 0) out.push(loanLine(missing));
  return out;
}

/** Lines of a payslip: its variables, else its legacy items. */
export function payslipLines(p: Pick<Payslip, 'items' | 'other_deductions'>, variables: Record<string, unknown>[]): PayslipLine[] {
  return variables.length > 0 ? variables.map(lineFromRow) : legacyLines(p);
}

/**
 * Amount a line's own rule gives on a base salary, or null for a line typed
 * by hand: hours × (base / 191) × rate, or a percentage of the base salary.
 */
export function ruleAmount(l: Pick<PayslipLine, 'base' | 'quantity' | 'rate'>, baseSalary: number): number | null {
  if (l.base === 'heures') return hoursLineAmount(baseSalary, l.quantity, l.rate);
  if (l.base === 'pourcentage_base') return Math.round(baseSalary * (Number(l.rate) || 0)) / 100;
  return null;
}
