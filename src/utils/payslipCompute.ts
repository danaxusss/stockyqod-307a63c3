// One computation for a stored payslip, used by the run, "Nouveau bulletin",
// the payslip page and the IR regularisation, so they can never disagree.

import type { Employee, Payslip } from '../types';
import type { PayrollSettings } from './payrollDefaults';
import { FULL_MONTH_CNSS_DAYS } from './payrollDefaults';
import { computePayslip, type PayslipResult } from './payrollCalc';
import type { PayslipLine } from './payslipLines';

export type PayslipEmployee = Pick<Employee, 'hire_date' | 'cimr_rate' | 'cimr_employer_rate' | 'dependents_count'>;

export type PayslipBasis = Pick<Payslip, 'base_salary' | 'period_month' | 'period_year'> &
  Partial<Pick<Payslip, 'dependents_count' | 'ir_regularisation'>>;

/**
 * Computes a payslip from its OWN base salary (not the employee's current
 * one, so a later raise does not change an older payslip) and its lines.
 */
export function computeForPayslip(p: PayslipBasis, employee: PayslipEmployee | null | undefined, lines: PayslipLine[], settings: PayrollSettings): PayslipResult {
  return computePayslip({
    base_salary: p.base_salary,
    hire_date: employee?.hire_date,
    period_month: p.period_month, period_year: p.period_year,
    lines,
    cimr_rate: Number(employee?.cimr_rate) || 0,
    cimr_employer_rate: employee?.cimr_employer_rate ?? null,
    dependents_count: p.dependents_count ?? employee?.dependents_count ?? 0,
    settings,
    ir_regularisation: p.ir_regularisation ?? 0,
  });
}

/** The stored figures of a payslip for a computation result. */
export function payslipFigures(res: PayslipResult, extra: { base_salary: number; dependents_count: number; cnss_days?: number }): Record<string, number> {
  return {
    base_salary: extra.base_salary,
    anciennete_rate: res.anciennete_rate, anciennete_amount: res.anciennete_amount,
    other_earnings: res.other_earnings, total_gross: res.brut_global,
    cnss_employee: res.cnss_employee, amo_employee: res.amo_employee, cimr_employee: res.cimr_employee,
    frais_pro: res.frais_pro, ir_amount: res.ir_amount, ir_regularisation: res.ir_regularisation,
    other_deductions: res.autres_retenues, total_deductions: res.total_deductions, net_salary: res.net_salary,
    cnss_employer: res.cnss_employer, amo_employer: res.amo_employer, alloc_familiales: res.alloc_familiales,
    tfp_employer: res.tfp_employer, cimr_employer: res.cimr_employer,
    ir_taxable_gross: res.brut_imposable, net_taxable: res.net_imposable,
    cnss_base: res.cnss_base, amo_base: res.amo_base,
    cnss_days: extra.cnss_days ?? FULL_MONTH_CNSS_DAYS,
    dependents_count: extra.dependents_count,
  };
}

/** Employer charges of a stored payslip (CIMR employer share and training tax included). */
export function employerCharges(p: Pick<Payslip, 'cnss_employer' | 'amo_employer' | 'alloc_familiales' | 'tfp_employer' | 'cimr_employer'>): number {
  return Math.round(((p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + (p.tfp_employer || 0) + (p.cimr_employer || 0)) * 100) / 100;
}

/**
 * The figures of a validated payslip as they were paid: its stored amounts,
 * never a recomputation with today's parameters. Bases that older payslips
 * did not store come from `computed`.
 */
export function storedResult(p: Payslip, computed: PayslipResult): PayslipResult {
  const reg = Number(p.ir_regularisation) || 0;
  const charges = employerCharges(p);
  return {
    ...computed,
    anciennete_rate: p.anciennete_rate, anciennete_amount: p.anciennete_amount, other_earnings: p.other_earnings,
    brut_global: p.total_gross,
    brut_imposable: p.ir_taxable_gross ?? computed.brut_imposable,
    net_imposable: p.net_taxable ?? computed.net_imposable,
    cnss_base: p.cnss_base ?? computed.cnss_base,
    amo_base: p.amo_base ?? computed.amo_base,
    cnss_employee: p.cnss_employee, amo_employee: p.amo_employee, cimr_employee: p.cimr_employee,
    frais_pro: p.frais_pro, ir_brut: Math.round((p.ir_amount + reg) * 100) / 100, ir_regularisation: reg, ir_amount: p.ir_amount,
    autres_retenues: p.other_deductions, total_deductions: p.total_deductions, net_salary: p.net_salary,
    cnss_employer: p.cnss_employer, amo_employer: p.amo_employer, alloc_familiales: p.alloc_familiales,
    tfp_employer: p.tfp_employer || 0, cimr_employer: p.cimr_employer || 0,
    charges_patronales: charges, employer_cost: Math.round((p.total_gross + charges) * 100) / 100,
  };
}
