import type { Employee, PayslipItem } from '../types';

// 2026 Moroccan statutory rates
const CNSS_RATE_EMPLOYEE = 0.0448;
const CNSS_EMPLOYEE_MONTHLY_CAP = 268.80;   // 4.48% × 6,000 MAD ceiling
const AMO_RATE_EMPLOYEE = 0.0226;
const CIMR_RATE_DEFAULT = 0;
const FRAIS_PRO_RATE = 0.20;
const FRAIS_PRO_MONTHLY_CAP = 2500;         // 30,000 / 12
const FAMILY_DEDUCTION_MONTHLY_PER_DEP = 50; // 600/year ÷ 12, max 6 deps

const CNSS_RATE_EMPLOYER = 0.0898;
const CNSS_EMPLOYER_MONTHLY_CAP = 538.80;   // 8.98% × 6,000
const AMO_RATE_EMPLOYER = 0.0411;
const ALLOC_FAM_RATE = 0.0640;

// IR brackets (annual MAD) → [lower, upper, rate, fixed deduction from lower]
const IR_BRACKETS_ANNUAL: [number, number, number, number][] = [
  [0,       40000,   0.00, 0],
  [40000,   60000,   0.10, 4000],
  [60000,   80000,   0.20, 10000],
  [80000,   100000,  0.30, 18000],
  [100000,  180000,  0.34, 22000],
  [180000,  Infinity, 0.37, 27400],
];

export interface AncienneteResult {
  rate: number;
  amount: number;
}

export function computeAnciennete(hireDateStr: string | undefined, basePlusRegularPrimes: number): AncienneteResult {
  if (!hireDateStr) return { rate: 0, amount: 0 };
  const hire = new Date(hireDateStr);
  const now = new Date();
  const years = (now.getTime() - hire.getTime()) / (365.25 * 24 * 3600 * 1000);

  let rate = 0;
  if (years >= 25) rate = 0.25;
  else if (years >= 20) rate = 0.20;
  else if (years >= 12) rate = 0.15;
  else if (years >= 5) rate = 0.10;
  else if (years >= 2) rate = 0.05;

  return { rate, amount: Math.round(basePlusRegularPrimes * rate * 100) / 100 };
}

export interface StatutoryDeductions {
  cnss_employee: number;
  amo_employee: number;
  cimr_employee: number;
  frais_pro: number;
  ir_amount: number;
  cnss_employer: number;
  amo_employer: number;
  alloc_familiales: number;
}

function applyIRBrackets(annualTaxableBase: number): number {
  for (const [lo, hi, rate, fixedDed] of IR_BRACKETS_ANNUAL) {
    if (annualTaxableBase <= hi) {
      return Math.max(0, annualTaxableBase * rate - fixedDed);
    }
  }
  return 0;
}

export function computeStatutoryDeductions(params: {
  grossSalary: number;
  cimrRate?: number;
  dependentsCount?: number;
}): StatutoryDeductions {
  const { grossSalary, cimrRate = 0, dependentsCount = 0 } = params;

  // Employee CNSS (capped at 268.80)
  const cnss_employee = Math.min(grossSalary * CNSS_RATE_EMPLOYEE, CNSS_EMPLOYEE_MONTHLY_CAP);

  // Employee AMO (no cap)
  const amo_employee = grossSalary * AMO_RATE_EMPLOYEE;

  // CIMR (optional)
  const cimr_employee = grossSalary * (cimrRate / 100);

  // Salaire imposable = gross - CNSS - AMO - CIMR
  const salaire_imposable = grossSalary - cnss_employee - amo_employee - cimr_employee;

  // Frais professionnels: 20% of salaire_imposable, capped at 2,500/month
  const frais_pro = Math.min(salaire_imposable * FRAIS_PRO_RATE, FRAIS_PRO_MONTHLY_CAP);

  // Family deductions: 50 MAD/month per dependent, max 6 deps → max 300 MAD/month
  const family_deduction = Math.min(dependentsCount, 6) * FAMILY_DEDUCTION_MONTHLY_PER_DEP;

  // Annual taxable base for IR brackets
  const annual_taxable = (salaire_imposable - frais_pro) * 12;
  const annual_family_ded = family_deduction * 12;
  const annual_ir = applyIRBrackets(annual_taxable);
  // Apply family deduction after brackets
  const ir_amount = Math.max(0, (annual_ir - annual_family_ded) / 12);

  // Employer contributions
  const cnss_employer = Math.min(grossSalary * CNSS_RATE_EMPLOYER, CNSS_EMPLOYER_MONTHLY_CAP);
  const amo_employer = grossSalary * AMO_RATE_EMPLOYER;
  const alloc_familiales = grossSalary * ALLOC_FAM_RATE;

  return {
    cnss_employee: Math.round(cnss_employee * 100) / 100,
    amo_employee: Math.round(amo_employee * 100) / 100,
    cimr_employee: Math.round(cimr_employee * 100) / 100,
    frais_pro: Math.round(frais_pro * 100) / 100,
    ir_amount: Math.round(ir_amount * 100) / 100,
    cnss_employer: Math.round(cnss_employer * 100) / 100,
    amo_employer: Math.round(amo_employer * 100) / 100,
    alloc_familiales: Math.round(alloc_familiales * 100) / 100,
  };
}

export interface PayslipTotals {
  anciennete_rate: number;
  anciennete_amount: number;
  other_earnings: number;
  total_gross: number;
  cnss_employee: number;
  amo_employee: number;
  cimr_employee: number;
  frais_pro: number;
  ir_amount: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  cnss_employer: number;
  amo_employer: number;
  alloc_familiales: number;
}

export function buildPayslipTotals(
  employee: Employee,
  manualItems: PayslipItem[],
): PayslipTotals {
  const earningItems = manualItems.filter(i => i.item_type === 'earning');
  const deductionItems = manualItems.filter(i => i.item_type === 'deduction');

  // Base for ancienneté = base_salary + manual earnings flagged as included
  const ancienneteBase = employee.base_salary +
    earningItems.filter(i => i.included_in_anciennete_base).reduce((s, i) => s + i.amount, 0);

  const { rate: anciennete_rate, amount: anciennete_amount } =
    computeAnciennete(employee.hire_date, ancienneteBase);

  const other_earnings = earningItems.reduce((s, i) => s + i.amount, 0);
  const total_gross = employee.base_salary + anciennete_amount + other_earnings;

  const statutory = computeStatutoryDeductions({
    grossSalary: total_gross,
    cimrRate: employee.cimr_rate ?? 0,
    dependentsCount: employee.dependents_count,
  });

  const other_deductions = deductionItems.reduce((s, i) => s + i.amount, 0);

  const total_deductions =
    statutory.cnss_employee +
    statutory.amo_employee +
    statutory.cimr_employee +
    statutory.ir_amount +
    other_deductions;

  const net_salary = Math.max(0, total_gross - total_deductions);

  return {
    anciennete_rate,
    anciennete_amount,
    other_earnings,
    total_gross: Math.round(total_gross * 100) / 100,
    cnss_employee: statutory.cnss_employee,
    amo_employee: statutory.amo_employee,
    cimr_employee: statutory.cimr_employee,
    frais_pro: statutory.frais_pro,
    ir_amount: statutory.ir_amount,
    other_deductions: Math.round(other_deductions * 100) / 100,
    total_deductions: Math.round(total_deductions * 100) / 100,
    net_salary: Math.round(net_salary * 100) / 100,
    cnss_employer: statutory.cnss_employer,
    amo_employer: statutory.amo_employer,
    alloc_familiales: statutory.alloc_familiales,
  };
}
