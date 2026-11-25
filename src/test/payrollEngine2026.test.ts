// Hand-computed Moroccan payslips (2025 and 2026 rules) and the rules of the
// parameter sets. Every expected figure is worked out in the comment above it;
// amounts are rounded to the centime at each step, like the payslip.
import { describe, expect, it } from 'vitest';
import { computePayroll, computePayslip, checkNetPay, hoursLineAmount, smigWarning, seniorityBase, type PayLine } from '../utils/payrollCalc';
import {
  officialSettingsFor, officialYearFor, plf2027SettingsFor, settingsStatus, smigMonthly, validateIrBrackets, withIrDeductions,
  DEFAULT_RUBRIQUES, mealAllowanceCeiling, type IrBracket,
} from '../utils/payrollDefaults';
import { mapSettingsRow } from '../utils/supabasePayrollSettings';

const s2025 = officialSettingsFor(2025);
const s2026 = officialSettingsFor(2026);
const subject = { soumis_cnss: true, soumis_amo: true, soumis_ir: true };

describe('official parameters by year', () => {
  it('keep 2025, move to 600 MAD a dependant and SMIG 17.92 in 2026, and later years inherit 2026', () => {
    expect(s2025).toMatchObject({ family_ded_per_dep: 500, family_ded_max: 6, smig_hourly: 17.10 });
    expect(s2026).toMatchObject({ family_ded_per_dep: 600, family_ded_max: 6, smig_hourly: 17.92 });
    expect(officialYearFor(2027)).toBe(2026);
    expect(officialSettingsFor(2027)).toMatchObject({ year: 2027, family_ded_per_dep: 600, smig_hourly: 17.92 });
    // The 2027 bill is never applied on its own.
    expect(officialSettingsFor(2027).frais_pro_low).toBe(0.35);
    // CNSS / AMO / training tax unchanged.
    expect(s2026).toMatchObject({ cnss_rate_emp: 0.0448, cnss_rate_er: 0.0898, cnss_cap: 6000, af_rate: 0.064, amo_rate_emp: 0.0226, amo_rate_er: 0.0411, tfp_rate: 0.016 });
    // 17.92 × 191 = 3,422.72
    expect(smigMonthly(s2026)).toBe(3422.72);
  });

  it('work out each band\'s amount to deduct from the bands and rates (CGI art. 73)', () => {
    // 40,000×10 % = 4,000; +60,000×10 % = 10,000; +80,000×10 % = 18,000;
    // +100,000×4 % = 22,000; +180,000×3 % = 27,400.
    expect(s2026.ir_brackets.map(b => b[3])).toEqual([0, 4000, 10000, 18000, 22000, 27400]);
    expect(s2026.ir_brackets.map(b => b[2])).toEqual([0, 0.10, 0.20, 0.30, 0.34, 0.37]);
    // 2027 bill: 60,000×10 % = 6,000; +80,000×10 % = 14,000; +100,000×14 % = 28,000; +180,000×3 % = 33,400.
    const plf = plf2027SettingsFor(2027);
    expect(plf.ir_brackets.map(b => [b[0], b[2], b[3]])).toEqual([[0, 0, 0], [60000, 0.10, 6000], [80000, 0.20, 14000], [100000, 0.34, 28000], [180000, 0.37, 33400]]);
    expect(plf).toMatchObject({ frais_pro_low: 0.45, frais_pro_high: 0.45, frais_pro_cap: 35000, family_ded_per_dep: 600 });
  });

  it('validate an IR scale: from 0, ascending, contiguous, open-ended, rates 0–100 %', () => {
    expect(validateIrBrackets(s2026.ir_brackets)).toEqual([]);
    const bad = (b: IrBracket[]) => validateIrBrackets(b);
    expect(bad([[1000, Infinity, 0.1, 0]])[0]).toMatch(/commencer à 0/);
    expect(bad([[0, 40000, 0, 0], [45000, Infinity, 0.1, 0]]).join()).toMatch(/commencer où finit/);
    expect(bad([[0, 40000, 0, 0], [40000, 30000, 0.1, 0], [30000, Infinity, 0.2, 0]]).join()).toMatch(/dépasser/);
    expect(bad([[0, 40000, 0, 0], [40000, 60000, 0.1, 0]]).join()).toMatch(/sans limite/);
    expect(bad([[0, Infinity, 1.2, 0]]).join()).toMatch(/entre 0 et 100/);
  });

  it('say which official set a year matches', () => {
    expect(settingsStatus(s2026, 2026)).toEqual({ kind: 'official', officialYear: 2026 });
    expect(settingsStatus({ ...s2026, family_ded_per_dep: 500 }, 2026).kind).toBe('modified');
    expect(settingsStatus(officialSettingsFor(2027), 2027)).toEqual({ kind: 'official', officialYear: 2026 });
    expect(settingsStatus(plf2027SettingsFor(2027), 2027).kind).toBe('plf2027');
    // A scale typed by hand with the official bands and rates matches (deductions are recomputed).
    const typed = withIrDeductions(s2026.ir_brackets.map(b => [b[0], b[1], b[2], 0] as IrBracket));
    expect(settingsStatus({ ...s2026, ir_brackets: typed }, 2026).kind).toBe('official');
  });

  it('read a saved row, treating missing columns as the year\'s official value', () => {
    const s = mapSettingsRow({ year: 2026, cnss_rate_emp: 0.05, ir_brackets: [[0, 999999999, 0, 0]] }, 2026);
    expect(s.cnss_rate_emp).toBe(0.05);
    expect(s.family_ded_per_dep).toBe(600);
    expect(s.ir_brackets[0][1]).toBe(Infinity);
    expect(mapSettingsRow(null, 2025).family_ded_per_dep).toBe(500);
  });

  it('seed the allowances with their 2026 ceilings', () => {
    const by = (code: string) => DEFAULT_RUBRIQUES.find(r => r.code === code)!;
    expect(by('IND_TRANSPORT')).toMatchObject({ ir_ceiling: { type: 'amount', value: 500 }, cnss_ceiling: { type: 'amount', value: 500 } });
    // 2 × 17.92 × 26 = 931.84
    expect(mealAllowanceCeiling(17.92)).toBe(931.84);
    expect(by('IND_PANIER').ir_ceiling).toEqual({ type: 'amount', value: 931.84 });
    expect(by('IND_REPR')).toMatchObject({ ir_ceiling: { type: 'percent', value: 10 }, cnss_ceiling: { type: 'percent', value: 10 } });
  });
});

describe('hand-computed payslips', () => {
  it('SMIG earner 2026: 3,422.72, no IR', () => {
    // CNSS 3,422.72 × 4.48 % = 153.34 ; AMO × 2.26 % = 77.35
    // Frais pro: 41,072.64 a year ≤ 78,000 → 35 % = 1,197.95
    // Net taxable 3,422.72 − 1,197.95 − 153.34 − 77.35 = 1,994.08 → 23,928.96 a year < 40,000 → IR 0
    // Net 3,422.72 − 153.34 − 77.35 = 3,192.03
    // Employer: CNSS 307.36 + AMO 140.67 + AF 219.05 + TFP 54.76 = 721.84
    const r = computePayroll({ base_salary: 3422.72, settings: s2026 });
    expect(r).toMatchObject({
      brut_global: 3422.72, brut_imposable: 3422.72, cnss_employee: 153.34, amo_employee: 77.35, frais_pro: 1197.95,
      net_imposable: 1994.08, ir_amount: 0, net_salary: 3192.03,
      cnss_employer: 307.36, amo_employer: 140.67, alloc_familiales: 219.05, tfp_employer: 54.76, charges_patronales: 721.84, employer_cost: 4144.56,
    });
  });

  it('6,000 MAD, no dependant, 2026', () => {
    // CNSS 268.80 (at the 6,000 cap) ; AMO 135.60 ; frais pro 72,000 ≤ 78,000 → 35 % = 2,100.00
    // Net taxable 6,000 − 2,100 − 268.80 − 135.60 = 3,495.60 → 41,947.20 a year
    // IR (41,947.20 × 10 % − 4,000) / 12 = 194.72 / 12 = 16.23 ; net 6,000 − 268.80 − 135.60 − 16.23 = 5,579.37
    // Employer 538.80 + 246.60 + 384.00 + 96.00 = 1,265.40
    const r = computePayroll({ base_salary: 6000, settings: s2026 });
    expect(r).toMatchObject({ cnss_employee: 268.8, amo_employee: 135.6, frais_pro: 2100, net_imposable: 3495.6, ir_amount: 16.23, net_salary: 5579.37, charges_patronales: 1265.4, employer_cost: 7265.4 });
  });

  it('10,000 MAD with 2 dependants, 2025 and 2026', () => {
    // CNSS 268.80 (capped) ; AMO 226.00 ; 120,000 a year > 78,000 → frais pro 25 % = 2,500.00
    // Net taxable 10,000 − 2,500 − 268.80 − 226 = 7,005.20 → 84,062.40 a year
    // Annual IR 84,062.40 × 30 % − 18,000 = 7,218.72
    // 2026: (7,218.72 − 2 × 600) / 12 = 501.56 ; 2025: (7,218.72 − 2 × 500) / 12 = 518.23
    const r26 = computePayroll({ base_salary: 10000, dependents_count: 2, settings: s2026 });
    const r25 = computePayroll({ base_salary: 10000, dependents_count: 2, settings: s2025 });
    expect(r26).toMatchObject({ cnss_employee: 268.8, amo_employee: 226, frais_pro: 2500, net_imposable: 7005.2, ir_amount: 501.56, net_salary: 9003.64 });
    expect(r25.ir_amount).toBe(518.23);
    expect(r26).toMatchObject({ cnss_employer: 538.8, amo_employer: 411, alloc_familiales: 640, tfp_employer: 160, charges_patronales: 1749.8, employer_cost: 11749.8 });
  });

  it('25,000 MAD with 6 dependants: professional expenses at their cap', () => {
    // Frais pro 25 % × 25,000 = 6,250 > cap 35,000 / 12 = 2,916.67 → 2,916.67
    // AMO 25,000 × 2.26 % = 565.00 ; CNSS 268.80
    // Net taxable 25,000 − 2,916.67 − 268.80 − 565.00 = 21,249.53 → 254,994.36 a year
    // Annual IR 254,994.36 × 37 % − 27,400 = 66,947.91 ; 2026: (66,947.9132 − 3,600) / 12 = 5,278.99
    // 2025: (66,947.9132 − 3,000) / 12 = 5,328.99 ; net 2026: 25,000 − 268.80 − 565 − 5,278.99 = 18,887.21
    // Employer 538.80 + 1,027.50 + 1,600.00 + 400.00 = 3,566.30
    const r = computePayroll({ base_salary: 25000, dependents_count: 6, settings: s2026 });
    expect(r).toMatchObject({ frais_pro: 2916.67, amo_employee: 565, net_imposable: 21249.53, ir_amount: 5278.99, net_salary: 18887.21, charges_patronales: 3566.3 });
    expect(computePayroll({ base_salary: 25000, dependents_count: 6, settings: s2025 }).ir_amount).toBe(5328.99);
    // A 7th dependant changes nothing (max 6).
    expect(computePayroll({ base_salary: 25000, dependents_count: 7, settings: s2026 }).ir_amount).toBe(5278.99);
  });

  it('crossing the 78,000 MAD threshold of the professional-expense rate', () => {
    // 6,500 × 12 = 78,000 ≤ 78,000 → 35 % = 2,275.00 ; AMO 146.90
    // Net taxable 6,500 − 2,275 − 268.80 − 146.90 = 3,809.30 → 45,711.60 ; IR (4,571.16 − 4,000) / 12 = 47.60
    const at = computePayroll({ base_salary: 6500, settings: s2026 });
    expect(at).toMatchObject({ frais_pro: 2275, net_imposable: 3809.3, ir_amount: 47.6, net_salary: 6036.7 });
    // 6,600 × 12 = 79,200 > 78,000 → 25 % = 1,650.00 ; AMO 149.16
    // Net taxable 6,600 − 1,650 − 268.80 − 149.16 = 4,532.04 → 54,384.48 ; IR (5,438.45 − 4,000) / 12 = 119.87
    const above = computePayroll({ base_salary: 6600, settings: s2026 });
    expect(above).toMatchObject({ frais_pro: 1650, net_imposable: 4532.04, ir_amount: 119.87, net_salary: 6062.17 });
  });

  it('with CIMR: employee share deducted, employer share in the charges', () => {
    // CIMR 6 % × 10,000 = 600.00 each (employer rate defaults to the employee's)
    // Net taxable 10,000 − 2,500 − 268.80 − 226 − 600 = 6,405.20 → 76,862.40 ; IR (15,372.48 − 10,000) / 12 = 447.71
    // Net 10,000 − 268.80 − 226 − 600 − 447.71 = 8,457.49 ; employer 1,749.80 + 600 = 2,349.80
    const r = computePayroll({ base_salary: 10000, cimr_rate: 6, settings: s2026 });
    expect(r).toMatchObject({ cimr_base: 10000, cimr_employee: 600, cimr_employer: 600, net_imposable: 6405.2, ir_amount: 447.71, net_salary: 8457.49, charges_patronales: 2349.8, employer_cost: 12349.8 });
    // An employer rate of its own: 8.4 % → 840.00
    expect(computePayroll({ base_salary: 10000, cimr_rate: 6, cimr_employer_rate: 8.4, settings: s2026 }).cimr_employer).toBe(840);
  });

  it('exempt transport above its ceilings: different IR and CNSS bases', () => {
    // Base 8,050 + transport 800 (exempt up to 500 for IR, 750 for CNSS)
    // Gross 8,850 ; IR base 8,050 + 300 = 8,350 ; CNSS / AMO base 8,050 + 50 = 8,100
    // CNSS 268.80 (capped) ; AMO 8,100 × 2.26 % = 183.06 ; frais pro 100,200 > 78,000 → 25 % = 2,087.50
    // Net taxable 8,350 − 2,087.50 − 268.80 − 183.06 = 5,810.64 → 69,727.68 ; IR (13,945.54 − 10,000) / 12 = 328.79
    // Net 8,850 − 268.80 − 183.06 − 328.79 = 8,069.35
    // Employer: CNSS 538.80 ; AMO 8,100 × 4.11 % = 332.91 ; AF 8,100 × 6.4 % = 518.40 ; TFP 129.60 → 1,519.71
    const transport: PayLine = { type: 'gain', amount: 800, ir_ceiling: { type: 'amount', value: 500 }, cnss_ceiling: { type: 'amount', value: 750 } };
    const r = computePayslip({ base_salary: 8050, lines: [transport], settings: s2026 });
    expect(r).toMatchObject({
      brut_global: 8850, brut_imposable: 8350, cnss_base: 8100, amo_base: 8100,
      cnss_employee: 268.8, amo_employee: 183.06, frais_pro: 2087.5, net_imposable: 5810.64, ir_amount: 328.79, net_salary: 8069.35,
      cnss_employer: 538.8, amo_employer: 332.91, alloc_familiales: 518.4, tfp_employer: 129.6, charges_patronales: 1519.71,
    });
    // Below its ceiling it stays fully exempt; a percentage ceiling follows the base salary.
    expect(computePayslip({ base_salary: 8050, lines: [{ ...transport, amount: 400 }], settings: s2026 }).brut_imposable).toBe(8050);
    const repr: PayLine = { type: 'gain', amount: 1000, ir_ceiling: { type: 'percent', value: 10 }, cnss_ceiling: { type: 'percent', value: 10 } };
    // 10 % of 8,000 = 800 exempt → 200 subject
    expect(computePayslip({ base_salary: 8000, lines: [repr], settings: s2026 })).toMatchObject({ brut_imposable: 8200, cnss_base: 8200 });
  });

  it('a line subject to only one of CNSS and IR enters only that base', () => {
    const r = computePayslip({ base_salary: 5000, settings: s2026, lines: [
      { type: 'gain', amount: 1000, soumis_ir: true },                       // IR only
      { type: 'gain', amount: 400, soumis_cnss: true, soumis_amo: false },   // CNSS only, not AMO
      { type: 'gain', amount: 300, soumis_cimr: true },                      // CIMR only
    ], cimr_rate: 3 });
    expect(r).toMatchObject({ brut_global: 6700, brut_imposable: 6000, cnss_base: 5400, amo_base: 5000, cimr_base: 5300 });
    // CNSS 5,400 × 4.48 % = 241.92 ; AMO 5,000 × 2.26 % = 113.00 ; CIMR 5,300 × 3 % = 159.00
    expect(r).toMatchObject({ cnss_employee: 241.92, amo_employee: 113, cimr_employee: 159 });
  });

  it('with an absence (8 hours): shown as a negative earning, lowers every base', () => {
    // 8 h × 6,000 / 191 = 251.31 ; gross 6,000 − 251.31 = 5,748.69
    // CNSS 257.54 ; AMO 129.92 ; 68,984.28 ≤ 78,000 → frais 35 % = 2,012.04
    // Net taxable 5,748.69 − 2,012.04 − 257.54 − 129.92 = 3,349.19 → 40,190.28 ; IR (4,019.03 − 4,000) / 12 = 1.59
    // Net 5,748.69 − 257.54 − 129.92 − 1.59 = 5,359.64
    const amount = hoursLineAmount(6000, 8, 1);
    expect(amount).toBe(251.31);
    const r = computePayslip({ base_salary: 6000, settings: s2026, lines: [{ type: 'retenue', amount, ...subject, soumis_cimr: true }] });
    expect(r).toMatchObject({ gross_deductions: 251.31, brut_global: 5748.69, cnss_base: 5748.69, cnss_employee: 257.54, amo_employee: 129.92, frais_pro: 2012.04, net_imposable: 3349.19, ir_amount: 1.59, net_salary: 5359.64 });
    // The deductions table (contributions + IR + after-tax lines) adds up to its total.
    expect(r.total_deductions).toBe(Math.round((r.cnss_employee + r.amo_employee + r.cimr_employee + r.ir_amount + r.autres_retenues) * 100) / 100);
    // The earnings table adds up to the gross: base + seniority + gains − absences.
    expect(r.brut_global).toBe(Math.round((6000 + r.anciennete_amount + r.other_earnings - r.gross_deductions) * 100) / 100);
  });

  it('with overtime hours (10 h at +25 %), 1 dependant', () => {
    // 10 h × 8,000 / 191 × 1.25 = 523.56 ; gross 8,523.56
    // AMO 192.63 ; 102,282.72 > 78,000 → frais 25 % = 2,130.89
    // Net taxable 8,523.56 − 2,130.89 − 268.80 − 192.63 = 5,931.24 → 71,174.88
    // IR (71,174.88 × 20 % − 10,000 − 600) / 12 = 3,634.98 / 12 = 302.91 ; net 8,523.56 − 268.80 − 192.63 − 302.91 = 7,759.22
    const amount = hoursLineAmount(8000, 10, 1.25);
    expect(amount).toBe(523.56);
    const r = computePayslip({ base_salary: 8000, dependents_count: 1, settings: s2026, lines: [{ type: 'gain', amount, ...subject }] });
    expect(r).toMatchObject({ brut_global: 8523.56, amo_employee: 192.63, frais_pro: 2130.89, net_imposable: 5931.24, ir_amount: 302.91, net_salary: 7759.22 });
  });

  it('seniority: base salary plus gains flagged for it, at the end of the pay period', () => {
    // Hired 2020-01-01: 6 completed years at 30 Nov 2026 → 10 % of (10,000 + 1,000) = 1,100
    const lines: PayLine[] = [{ type: 'gain', amount: 1000, ...subject, inclus_anciennete: true }, { type: 'gain', amount: 500, ...subject }];
    expect(seniorityBase(10000, lines)).toBe(11000);
    const r = computePayslip({ base_salary: 10000, hire_date: '2020-01-01', period_month: 11, period_year: 2026, lines, settings: s2026 });
    expect(r).toMatchObject({ anciennete_rate: 0.1, anciennete_amount: 1100, brut_global: 12600 });
  });
});

describe('checks', () => {
  it('warn when a full-time base salary is below SMIG × 191 of the period year', () => {
    expect(smigWarning(3000, s2026)).toMatch(/3.422,72 MAD pour 191 h/);
    expect(smigWarning(3422.72, s2026)).toBeNull();
    // 2025: 17.10 × 191 = 3,266.10
    expect(smigWarning(3300, s2025)).toBeNull();
    // Part-time hours: no warning.
    expect(smigWarning(2000, s2026, 100)).toBeNull();
  });

  it('block a negative net and flag advances above a third of the net', () => {
    expect(checkNetPay(-10, 0).error).toMatch(/négatif/);
    // Net before advances 3,000 → a third is 1,000: 1,200 withheld is too much.
    expect(checkNetPay(1800, 1200).warning).toMatch(/tiers/);
    expect(checkNetPay(2100, 900)).toEqual({ error: null, warning: null });
  });
});
