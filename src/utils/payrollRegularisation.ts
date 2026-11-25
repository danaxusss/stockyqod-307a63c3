// Year-end style IR regularisation. Payslips of January–November 2026 were
// computed with the 2025 family deduction (500 MAD instead of 600), so IR was
// over-withheld. Each validated payslip of the year is recomputed with the
// year's current parameters, from its own saved lines, and the difference
// with the IR actually withheld is given back (or, on request, collected) on
// an open payslip. Pure functions: the service layer loads the payslips.

import type { PayrollSettings } from './payrollDefaults';
import { computePayslip, type PayLine } from './payrollCalc';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface RegularisationPayslip {
  id: string;
  period_month: number;
  period_year: number;
  is_locked?: boolean;
  /** Net IR withheld (after any regularisation applied on it). */
  ir_amount: number;
  /** Regularisation applied on this payslip (positive: given back). */
  ir_regularisation?: number;
  base_salary: number;
  /** Dependants used on that payslip; falls back to the employee's. */
  dependents_count?: number | null;
  lines: PayLine[];
}

export interface RegularisationEmployee {
  hire_date?: string | null;
  cimr_rate?: number | null;
  cimr_employer_rate?: number | null;
  dependents_count?: number | null;
}

export interface RegularisationMonth {
  id: string;
  month: number;
  /** IR computed on that payslip, before its own regularisation. */
  withheld: number;
  recomputed: number;
  /** withheld − recomputed: positive when too much was withheld. */
  diff: number;
}

export interface IrRegularisation {
  year: number;
  months: RegularisationMonth[];
  /** Regularisations already applied on other payslips of the year. */
  alreadyApplied: number;
  /** Positive: owed to the employee; negative: IR still to collect. */
  owed: number;
  /** Validated payslips the amount covers. */
  coveredIds: string[];
}

/** IR a payslip should have withheld with these parameters (before regularisation). */
export function recomputeIr(p: RegularisationPayslip, employee: RegularisationEmployee, settings: PayrollSettings): number {
  return computePayslip({
    base_salary: p.base_salary, hire_date: employee.hire_date, period_month: p.period_month, period_year: p.period_year,
    lines: p.lines, cimr_rate: Number(employee.cimr_rate) || 0, cimr_employer_rate: employee.cimr_employer_rate ?? null,
    dependents_count: p.dependents_count ?? employee.dependents_count ?? 0, settings,
  }).ir_brut;
}

/**
 * What the open payslip `targetId` should regularise. Every validated payslip
 * of the year (other than the target) is recomputed; regularisations already
 * applied on any other payslip of the year are taken off, so the same amount
 * is never given back twice and a remainder carries to the next month.
 * Re-running it on the same open payslip gives the same amount (it replaces,
 * it does not add).
 */
export function computeIrRegularisation(
  targetId: string,
  yearPayslips: RegularisationPayslip[],
  employee: RegularisationEmployee,
  settings: PayrollSettings,
  year: number,
): IrRegularisation {
  const others = yearPayslips.filter(p => p.id !== targetId && p.period_year === year);
  const months: RegularisationMonth[] = others
    .filter(p => p.is_locked)
    .sort((a, b) => a.period_month - b.period_month)
    .map(p => {
      const withheld = r2((Number(p.ir_amount) || 0) + (Number(p.ir_regularisation) || 0));
      const recomputed = recomputeIr(p, employee, settings);
      return { id: p.id, month: p.period_month, withheld, recomputed, diff: r2(withheld - recomputed) };
    });
  const alreadyApplied = r2(others.reduce((s, p) => s + (Number(p.ir_regularisation) || 0), 0));
  const owed = r2(months.reduce((s, m) => s + m.diff, 0) - alreadyApplied);
  return { year, months, alreadyApplied, owed, coveredIds: months.filter(m => m.diff !== 0).map(m => m.id) };
}

export interface RegularisationPlan {
  /** Amount to put on the open payslip (positive gives back, negative collects). */
  apply: number;
  /** Part of a refund that does not fit in this month's IR (stays owed). */
  remainder: number;
  /** Under-withheld IR found, collected only when `collect` is true. */
  toCollect: number;
}

/**
 * How much of a regularisation fits on a payslip whose IR before
 * regularisation is `irBrut`: a refund never takes the month's IR below 0;
 * under-withheld IR is only collected when asked.
 */
export function planRegularisation(owed: number, irBrut: number, collect = false): RegularisationPlan {
  if (owed > 0) {
    const apply = r2(Math.min(owed, Math.max(0, irBrut)));
    return { apply, remainder: r2(owed - apply), toCollect: 0 };
  }
  if (owed < 0) return { apply: collect ? owed : 0, remainder: 0, toCollect: r2(-owed) };
  return { apply: 0, remainder: 0, toCollect: 0 };
}
