import type { Employee, PayslipItem } from '../types';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from './payrollDefaults';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Moroccan statutory rates (LF 2023 frais pro reform + LF 2025 IR scale).
const CNSS_RATE_EMPLOYEE = 0.0448;
const CNSS_EMPLOYEE_MONTHLY_CAP = 268.80;   // 4.48% × 6,000 MAD ceiling
const AMO_RATE_EMPLOYEE = 0.0226;

// Frais professionnels (Art. 59 CGI, reform LF 2023):
//   35% if annual gross taxable ≤ 78,000 MAD, else 25% — capped at 35,000 MAD/yr.
//   Computed on the salaire brut imposable (before CNSS/AMO), not net of them.
const FRAIS_PRO_RATE_LOW = 0.35;
const FRAIS_PRO_RATE_HIGH = 0.25;
const FRAIS_PRO_THRESHOLD_ANNUAL = 78000;
const FRAIS_PRO_ANNUAL_CAP = 35000;

// Déduction pour charge de famille: 500 MAD/year per dependent (LF 2025), max 6.
const FAMILY_DEDUCTION_ANNUAL_PER_DEP = 500;

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
  tfp_employer: number;
}

function applyIRBrackets(annualTaxableBase: number, brackets: [number, number, number, number][]): number {
  for (const [, hi, rate, fixedDed] of brackets) {
    if (annualTaxableBase <= hi) {
      return Math.max(0, annualTaxableBase * rate - fixedDed);
    }
  }
  return 0;
}

export function computeStatutoryDeductions(params: {
  grossSalary: number;                 // brut imposable (soumis IR)
  grossSubjectCnss?: number;           // brut soumis CNSS/AMO (default = grossSalary)
  cimrRate?: number;
  dependentsCount?: number;
  settings?: PayrollSettings;
}): StatutoryDeductions {
  const { grossSalary, cimrRate = 0, dependentsCount = 0 } = params;
  const s = params.settings || DEFAULT_PAYROLL_SETTINGS;
  const cnssBase = params.grossSubjectCnss ?? grossSalary;

  // Employee CNSS (capped)
  const cnss_employee = Math.min(cnssBase, s.cnss_cap) * s.cnss_rate_emp;
  // Employee AMO (no cap)
  const amo_employee = cnssBase * s.amo_rate_emp;
  // CIMR (optional)
  const cimr_employee = grossSalary * (cimrRate / 100);

  // Frais professionnels — on the brut imposable, rate depends on annualized gross.
  const annualGross = grossSalary * 12;
  const fraisRate = annualGross <= s.frais_pro_threshold ? s.frais_pro_low : s.frais_pro_high;
  const frais_pro = Math.min(grossSalary * fraisRate, s.frais_pro_cap / 12);

  // Salaire net imposable
  const salaire_net_imposable = grossSalary - frais_pro - cnss_employee - amo_employee - cimr_employee;

  // Family deductions + IR from the annual scale
  const annual_family_ded = Math.min(dependentsCount, s.family_ded_max) * s.family_ded_per_dep;
  const annual_ir = applyIRBrackets(salaire_net_imposable * 12, s.ir_brackets);
  const ir_amount = Math.max(0, (annual_ir - annual_family_ded) / 12);

  // Employer contributions
  const cnss_employer = Math.min(cnssBase, s.cnss_cap) * s.cnss_rate_er;
  const amo_employer = cnssBase * s.amo_rate_er;
  const alloc_familiales = cnssBase * s.af_rate;
  const tfp_employer = cnssBase * s.tfp_rate;

  return {
    cnss_employee: r2(cnss_employee), amo_employee: r2(amo_employee), cimr_employee: r2(cimr_employee),
    frais_pro: r2(frais_pro), ir_amount: r2(ir_amount),
    cnss_employer: r2(cnss_employer), amo_employer: r2(amo_employer),
    alloc_familiales: r2(alloc_familiales), tfp_employer: r2(tfp_employer),
  };
}

// ── Full payroll computation / simulation ─────────────────────────────────────
export interface PayrollInput {
  base_salary: number;
  anciennete_amount?: number;
  primes_soumises?: number;      // primes soumises CNSS + IR (+ ancienneté déjà inclus dans anciennete_amount)
  heures_supp?: number;          // montant heures supplémentaires (soumis)
  primes_non_soumises?: number;  // indemnités exonérées (transport, panier…)
  autres_retenues?: number;      // avances, prêts, saisies (non fiscales)
  cimr_rate?: number;
  dependents_count?: number;
  settings?: PayrollSettings;
}

export interface PayrollResult {
  brut_imposable: number;
  brut_global: number;
  cnss_employee: number;
  amo_employee: number;
  cimr_employee: number;
  frais_pro: number;
  net_imposable: number;
  ir_amount: number;
  autres_retenues: number;
  total_deductions: number;
  net_salary: number;
  cnss_employer: number;
  amo_employer: number;
  alloc_familiales: number;
  tfp_employer: number;
  charges_patronales: number;
  employer_cost: number;
}

/** Full monthly payroll from structured inputs (used by real payslips + simulator). */
export function computePayroll(input: PayrollInput): PayrollResult {
  const s = input.settings || DEFAULT_PAYROLL_SETTINGS;
  const base = Number(input.base_salary) || 0;
  const anc = Number(input.anciennete_amount) || 0;
  const primesSoumises = Number(input.primes_soumises) || 0;
  const hs = Number(input.heures_supp) || 0;
  const primesNon = Number(input.primes_non_soumises) || 0;
  const autres = Number(input.autres_retenues) || 0;

  const brut_imposable = r2(base + anc + primesSoumises + hs);
  const brut_global = r2(brut_imposable + primesNon);

  const st = computeStatutoryDeductions({
    grossSalary: brut_imposable, grossSubjectCnss: brut_imposable,
    cimrRate: input.cimr_rate ?? 0, dependentsCount: input.dependents_count ?? 0, settings: s,
  });

  const net_imposable = r2(brut_imposable - st.frais_pro - st.cnss_employee - st.amo_employee - st.cimr_employee);
  const total_deductions = r2(st.cnss_employee + st.amo_employee + st.cimr_employee + st.ir_amount + autres);
  const net_salary = r2(brut_global - total_deductions);
  const charges_patronales = r2(st.cnss_employer + st.amo_employer + st.alloc_familiales + st.tfp_employer);
  const employer_cost = r2(brut_global + charges_patronales);

  return {
    brut_imposable, brut_global,
    cnss_employee: st.cnss_employee, amo_employee: st.amo_employee, cimr_employee: st.cimr_employee,
    frais_pro: st.frais_pro, net_imposable, ir_amount: st.ir_amount, autres_retenues: r2(autres),
    total_deductions, net_salary,
    cnss_employer: st.cnss_employer, amo_employer: st.amo_employer, alloc_familiales: st.alloc_familiales,
    tfp_employer: st.tfp_employer, charges_patronales, employer_cost,
  };
}

export const simulatePayroll = computePayroll;

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
  tfp_employer: number;
}

export function buildPayslipTotals(
  employee: Employee,
  manualItems: PayslipItem[],
  settings?: PayrollSettings,
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
    settings,
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
    tfp_employer: statutory.tfp_employer,
  };
}
