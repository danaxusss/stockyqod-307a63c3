// Official Moroccan payroll parameters, by year. A company can override them
// per year in payroll_settings; these are the values a year falls back to.
//
// Sources (checked 25 Nov 2026):
// - IR scale: CGI art. 73-I (unchanged in 2025 and 2026).
// - Professional expenses: CGI art. 59-I-A, 35 % when the annual gross taxable
//   income is ≤ 78,000 MAD, otherwise 25 %, capped at 35,000 MAD a year.
// - Family deduction: CGI art. 74-I, 500 MAD per dependant (max 6) in 2025,
//   600 MAD from income earned on 1 January 2026 (finance law 2026).
// - SMIG: 17.10 MAD/h in 2025, 17.92 MAD/h from 1 January 2026.
// - CNSS: 4.48 % employee / 8.98 % employer on salary capped at 6,000 MAD;
//   family allowances 6.40 %, AMO 2.26 % / 4.11 %, training tax 1.60 %, uncapped.

export type IrBracket = [number, number, number, number]; // [from, to, rate, amount to deduct]

export interface PayrollSettings {
  year?: number;
  cnss_rate_emp: number;
  cnss_cap: number;
  amo_rate_emp: number;
  cnss_rate_er: number;
  af_rate: number;
  amo_rate_er: number;
  tfp_rate: number;
  frais_pro_low: number;
  frais_pro_high: number;
  frais_pro_threshold: number;
  frais_pro_cap: number;
  family_ded_per_dep: number;
  family_ded_max: number;
  smig_hourly: number;
  conges_days_per_month: number;
  ir_brackets: IrBracket[];
}

/** Monthly legal working hours (Code du travail: 44 h a week). */
export const LEGAL_MONTHLY_HOURS = 191;
/** Days declared to the CNSS for a full month. */
export const FULL_MONTH_CNSS_DAYS = 26;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * IR scale from its bands, the "amount to deduct" of each band worked out
 * from the bands and rates (so it can never disagree with them): each band's
 * deduction is the previous one plus its lower bound times the rate increase.
 */
export function withIrDeductions(brackets: IrBracket[]): IrBracket[] {
  let ded = 0;
  let prevRate = 0;
  return brackets.map(([lo, hi, rate]) => {
    ded = r2(ded + lo * (rate - prevRate));
    prevRate = rate;
    return [lo, hi, rate, ded];
  });
}

/** Problems of an IR scale, in French, empty when it can be used. */
export function validateIrBrackets(brackets: IrBracket[]): string[] {
  const errors: string[] = [];
  if (brackets.length === 0) return ['Le barème doit avoir au moins une tranche.'];
  if (brackets[0][0] !== 0) errors.push('La première tranche doit commencer à 0.');
  brackets.forEach(([lo, hi, rate], i) => {
    const n = i + 1;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) errors.push(`Tranche ${n} : le taux doit être entre 0 et 100 %.`);
    if (i < brackets.length - 1) {
      if (!Number.isFinite(hi)) errors.push(`Tranche ${n} : seule la dernière tranche peut être sans limite.`);
      else if (hi <= lo) errors.push(`Tranche ${n} : la borne haute doit dépasser la borne basse.`);
      if (brackets[i + 1][0] !== hi) errors.push(`Tranche ${n + 1} : elle doit commencer où finit la tranche ${n} (${hi}).`);
    } else if (Number.isFinite(hi)) {
      errors.push('La dernière tranche doit être sans limite (« et plus »).');
    }
  });
  return errors;
}

const IR_SCALE_2025: IrBracket[] = withIrDeductions([
  [0, 40000, 0, 0],
  [40000, 60000, 0.10, 0],
  [60000, 80000, 0.20, 0],
  [80000, 100000, 0.30, 0],
  [100000, 180000, 0.34, 0],
  [180000, Infinity, 0.37, 0],
]);

const BASE_2025: PayrollSettings = {
  cnss_rate_emp: 0.0448,
  cnss_cap: 6000,
  amo_rate_emp: 0.0226,
  cnss_rate_er: 0.0898,
  af_rate: 0.0640,
  amo_rate_er: 0.0411,
  tfp_rate: 0.0160,
  frais_pro_low: 0.35,
  frais_pro_high: 0.25,
  frais_pro_threshold: 78000,
  frais_pro_cap: 35000,
  family_ded_per_dep: 500,
  family_ded_max: 6,
  smig_hourly: 17.10,
  conges_days_per_month: 1.5,
  ir_brackets: IR_SCALE_2025,
};

/** Enacted official values, by year. */
export const OFFICIAL_PAYROLL_SETTINGS: Record<number, PayrollSettings> = {
  2025: { ...BASE_2025, year: 2025 },
  2026: { ...BASE_2025, year: 2026, family_ded_per_dep: 600, smig_hourly: 17.92 },
};

/**
 * The 2027 finance BILL (PLF 2027, passed by the first chamber on 14 Nov 2026,
 * not yet law): new 2027 IR scale (CGI art. 247-XXXXVII transitional scale)
 * and a single 45 % professional-expense rate capped at 35,000 MAD. Never
 * applied on its own: the settings page offers it behind a confirmation.
 */
export const PLF_2027_CHANGES: Pick<PayrollSettings, 'ir_brackets' | 'frais_pro_low' | 'frais_pro_high'> = {
  ir_brackets: withIrDeductions([
    [0, 60000, 0, 0],
    [60000, 80000, 0.10, 0],
    [80000, 100000, 0.20, 0],
    [100000, 180000, 0.34, 0],
    [180000, Infinity, 0.37, 0],
  ]),
  frais_pro_low: 0.45,
  frais_pro_high: 0.45,
};

/**
 * The enacted year whose values apply to `year`: the latest enacted year not
 * after it (a later year inherits the latest enacted one). Years before the
 * first one known use the first one.
 */
export function officialYearFor(year: number): number {
  const years = Object.keys(OFFICIAL_PAYROLL_SETTINGS).map(Number).sort((a, b) => a - b);
  let found = years[0];
  for (const y of years) if (y <= year) found = y;
  return found;
}

/** Official values for a year (a copy, safe to edit). */
export function officialSettingsFor(year: number): PayrollSettings {
  const s = OFFICIAL_PAYROLL_SETTINGS[officialYearFor(year)];
  return { ...s, year, ir_brackets: s.ir_brackets.map(b => [...b] as IrBracket) };
}

/** Official values with the 2027 finance bill applied on top. */
export function plf2027SettingsFor(year: number): PayrollSettings {
  return { ...officialSettingsFor(year), ...PLF_2027_CHANGES, year, ir_brackets: PLF_2027_CHANGES.ir_brackets.map(b => [...b] as IrBracket) };
}

const NUMERIC_KEYS: (keyof PayrollSettings)[] = [
  'cnss_rate_emp', 'cnss_cap', 'amo_rate_emp', 'cnss_rate_er', 'af_rate', 'amo_rate_er', 'tfp_rate',
  'frais_pro_low', 'frais_pro_high', 'frais_pro_threshold', 'frais_pro_cap',
  'family_ded_per_dep', 'family_ded_max', 'smig_hourly', 'conges_days_per_month',
];

const near = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6;

/** Same rates, ceilings and IR scale (the year itself is not compared). */
export function sameSettings(a: PayrollSettings, b: PayrollSettings): boolean {
  if (!NUMERIC_KEYS.every(k => near(a[k] as number, b[k] as number))) return false;
  if (a.ir_brackets.length !== b.ir_brackets.length) return false;
  return a.ir_brackets.every((x, i) => x.every((v, j) => {
    const w = b.ir_brackets[i][j];
    return (v === Infinity && w === Infinity) || near(v, w);
  }));
}

/** Which official set a year's settings match. */
export function settingsStatus(s: PayrollSettings, year: number): { kind: 'official' | 'plf2027' | 'modified'; officialYear: number } {
  const officialYear = officialYearFor(year);
  if (sameSettings(s, officialSettingsFor(year))) return { kind: 'official', officialYear };
  if (year >= 2027 && sameSettings(s, plf2027SettingsFor(year))) return { kind: 'plf2027', officialYear };
  return { kind: 'modified', officialYear };
}

// ── HR limits set by law, by year ───────────────────────────────────────────
// Not company settings: statutory ceilings that change only with a finance law.
// - severance_ir_ceiling: CGI art. 57-7°, the dismissal indemnity, the
//   voluntary-departure indemnity and court-awarded damages are exempt from IR
//   "dans la limite d'un million (1000000) dirhams au titre du montant total"
//   (finance law 2023).
// - trainee_ir_ceiling / trainee_ir_months: CGI art. 57-16°, "l'indemnité de
//   stage mensuelle brute plafonnée à six mille (6.000) dirhams ... pour une
//   période de douze (12) mois"; above the ceiling the exemption is lost
//   entirely. The 2027 bill (8,000) is not law: not entered.
// - trainee_cnss_months: ANAPEC insertion contracts are reported exempt from
//   CNSS contributions and the training tax for 24 months. NOT verified in an
//   official text; applied only when the employee's own setting says so.
export interface HrLimits {
  severance_ir_ceiling: number;
  trainee_ir_ceiling: number;
  trainee_ir_months: number;
  trainee_cnss_months: number;
}

export const OFFICIAL_HR_LIMITS: Record<number, HrLimits> = {
  2025: { severance_ir_ceiling: 1000000, trainee_ir_ceiling: 6000, trainee_ir_months: 12, trainee_cnss_months: 24 },
  2026: { severance_ir_ceiling: 1000000, trainee_ir_ceiling: 6000, trainee_ir_months: 12, trainee_cnss_months: 24 },
};

/** Limits in force for a year: the latest year known not after it. */
export function hrLimitsFor(year: number): HrLimits {
  const years = Object.keys(OFFICIAL_HR_LIMITS).map(Number).sort((a, b) => a - b);
  let found = years[0];
  for (const y of years) if (y <= year) found = y;
  return { ...OFFICIAL_HR_LIMITS[found] };
}

/** Monthly SMIG for a full-time employee (191 hours). */
export function smigMonthly(s: Pick<PayrollSettings, 'smig_hourly'>): number {
  return r2((Number(s.smig_hourly) || 0) * LEGAL_MONTHLY_HOURS);
}

// ── Rubriques ────────────────────────────────────────────────────────────────

/**
 * Exemption ceiling of an allowance: the part of a line up to the ceiling is
 * exempt, the part above it is subject. `percent` is a percentage of the base
 * salary (10 = 10 %).
 */
export interface ExemptionCeiling { type: 'amount' | 'percent'; value: number }

export interface DefaultRubrique {
  code: string; label: string; type: 'gain' | 'retenue';
  base: 'fixe' | 'pourcentage_base' | 'heures' | 'formule'; rate?: number;
  soumis_cnss: boolean; soumis_amo: boolean; soumis_ir: boolean; soumis_cimr: boolean; inclus_anciennete: boolean;
  compte_comptable?: string;
  ir_ceiling?: ExemptionCeiling; cnss_ceiling?: ExemptionCeiling;
}

/** Meal allowance ceiling: 2 × hourly SMIG per worked day, 26 days a month. */
export function mealAllowanceCeiling(smigHourly: number): number {
  return r2(2 * smigHourly * FULL_MONTH_CNSS_DAYS);
}

const LATEST_SMIG = OFFICIAL_PAYROLL_SETTINGS[officialYearFor(9999)].smig_hourly;

// Common Moroccan rubriques seeded on init. The allowances carry the tax and
// CNSS ceilings reported for 2026 (commuting 500 MAD/month in town, meal
// allowance 2 × hourly SMIG a worked day, representation 10 % of base salary).
export const DEFAULT_RUBRIQUES: DefaultRubrique[] = [
  { code: 'HS25', label: 'Heures supplémentaires 25%', type: 'gain', base: 'heures', rate: 1.25, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'HS50', label: 'Heures supplémentaires 50%', type: 'gain', base: 'heures', rate: 1.50, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'HS100', label: 'Heures supplémentaires 100%', type: 'gain', base: 'heures', rate: 2.00, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'PRIME_RESP', label: 'Prime de responsabilité', type: 'gain', base: 'fixe', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: true, compte_comptable: '6171' },
  { code: 'PRIME_REND', label: 'Prime de rendement', type: 'gain', base: 'fixe', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'IND_TRANSPORT', label: 'Indemnité de transport', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171',
    ir_ceiling: { type: 'amount', value: 500 }, cnss_ceiling: { type: 'amount', value: 500 } },
  { code: 'IND_PANIER', label: 'Indemnité de panier', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171',
    ir_ceiling: { type: 'amount', value: mealAllowanceCeiling(LATEST_SMIG) }, cnss_ceiling: { type: 'amount', value: mealAllowanceCeiling(LATEST_SMIG) } },
  { code: 'IND_REPR', label: 'Indemnité de représentation', type: 'gain', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '6171',
    ir_ceiling: { type: 'percent', value: 10 }, cnss_ceiling: { type: 'percent', value: 10 } },
  // An absence lowers every base, CIMR included: the pension contribution is
  // due on the salary actually paid.
  { code: 'ABSENCE', label: 'Retenue pour absence', type: 'retenue', base: 'heures', rate: 1, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: true, inclus_anciennete: false, compte_comptable: '6171' },
  { code: 'AVANCE', label: 'Retenue avance / prêt', type: 'retenue', base: 'fixe', soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, compte_comptable: '3488' },
];
