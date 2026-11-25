import { LEGAL_MONTHLY_HOURS, officialSettingsFor, smigMonthly, type ExemptionCeiling, type IrBracket, type PayrollSettings } from './payrollDefaults';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface AncienneteResult {
  rate: number;
  amount: number;
}

/** Last day of a pay period, the date seniority is measured at. */
export function periodEnd(month: number, year: number): Date {
  return new Date(year, month, 0);
}

/** Completed years of service at a date, by calendar date. */
export function seniorityYears(hireDateStr: string | undefined | null, asOf: Date): number {
  if (!hireDateStr) return 0;
  const [hy, hm, hd] = hireDateStr.slice(0, 10).split('-').map(Number);
  if (!hy || !hm || !hd) return 0;
  let years = asOf.getFullYear() - hy;
  if (asOf.getMonth() + 1 < hm || (asOf.getMonth() + 1 === hm && asOf.getDate() < hd)) years -= 1;
  return Math.max(0, years);
}

/** Seniority bonus rate for completed years (Code du travail art. 350). */
export function seniorityRate(years: number): number {
  if (years >= 25) return 0.25;
  if (years >= 20) return 0.20;
  if (years >= 12) return 0.15;
  if (years >= 5) return 0.10;
  if (years >= 2) return 0.05;
  return 0;
}

/**
 * Seniority bonus. `asOf` is the end of the pay period (default: today), so a
 * payslip keeps the rate of its own month however late it is computed.
 */
export function computeAnciennete(hireDateStr: string | undefined, basePlusRegularPrimes: number, asOf: Date = new Date()): AncienneteResult {
  if (!hireDateStr) return { rate: 0, amount: 0 };
  const rate = seniorityRate(seniorityYears(hireDateStr, asOf));
  return { rate, amount: r2(basePlusRegularPrimes * rate) };
}

function applyIRBrackets(annualTaxableBase: number, brackets: IrBracket[]): number {
  for (const [, hi, rate, fixedDed] of brackets) {
    if (annualTaxableBase <= hi) return Math.max(0, annualTaxableBase * rate - fixedDed);
  }
  return 0;
}

// ── Payslip lines ────────────────────────────────────────────────────────────

/**
 * A variable line of a payslip. A gain enters the gross; each flag says which
 * base it also enters. A retenue with any flag is an absence-type deduction:
 * it lowers the gross and each base it is flagged for. A retenue without flags
 * (advance, loan) is taken off the net after tax.
 */
export interface PayLine {
  type: 'gain' | 'retenue';
  amount: number;
  soumis_cnss?: boolean;
  /** Defaults to soumis_cnss (older lines have no AMO flag). */
  soumis_amo?: boolean | null;
  soumis_ir?: boolean;
  soumis_cimr?: boolean;
  inclus_anciennete?: boolean;
  /** Exempt for IR up to this ceiling, subject above it (only when not soumis_ir). */
  ir_ceiling?: ExemptionCeiling | null;
  /** Exempt for CNSS and AMO up to this ceiling (only when not subject to them). */
  cnss_ceiling?: ExemptionCeiling | null;
}

const amoFlag = (l: PayLine) => (l.soumis_amo == null ? !!l.soumis_cnss : !!l.soumis_amo);

/** A retenue that lowers the gross (absence) rather than the net. */
export function isGrossDeduction(l: PayLine): boolean {
  return l.type === 'retenue' && !!(l.soumis_cnss || amoFlag(l) || l.soumis_ir || l.soumis_cimr);
}

/** The amount a ceiling stands for, on a given base salary. */
export function ceilingAmount(c: ExemptionCeiling | null | undefined, baseSalary: number): number | null {
  if (!c || !Number.isFinite(Number(c.value))) return null;
  return c.type === 'percent' ? r2(baseSalary * Number(c.value) / 100) : r2(Number(c.value));
}

/** Part of a gain that enters a base: all of it when subject, else what exceeds its ceiling. */
function subjectPart(amount: number, subject: boolean, ceiling: number | null): number {
  if (subject) return amount;
  if (ceiling == null) return 0;
  return Math.max(0, amount - ceiling);
}

/** Hourly rate of a base salary (legal month of 191 hours). */
export function hourlyRate(baseSalary: number): number {
  return (Number(baseSalary) || 0) / LEGAL_MONTHLY_HOURS;
}

/** Amount of an hours line: hours × (base salary / 191) × rate. */
export function hoursLineAmount(baseSalary: number, hours: number, rate: number): number {
  return r2((Number(hours) || 0) * hourlyRate(baseSalary) * (Number(rate) || 0));
}

/** One rule for the seniority base everywhere: base salary + gains flagged for it. */
export function seniorityBase(baseSalary: number, lines: PayLine[]): number {
  return r2((Number(baseSalary) || 0) + lines.filter(l => l.type === 'gain' && l.inclus_anciennete).reduce((s, l) => s + (Number(l.amount) || 0), 0));
}

// ── Trainees (contrat de stage ANAPEC) ──────────────────────────────────────

/** What a trainee's contract gives, taken from the employee and the year's limits. */
export interface TraineeTerms {
  /** First day of the internship (start of both exemption periods). */
  start_date: string;
  /** Monthly gross ceiling of the IR exemption (CGI art. 57-16°). */
  ir_ceiling: number;
  /** Number of monthly payslips the IR exemption covers. */
  ir_months: number;
  /** The employee's setting: CNSS and training tax not due (to confirm with the CNSS). */
  cnss_exempt: boolean;
  cnss_months: number;
}

export interface TraineeOutcome {
  /** exempt: no IR; over_ceiling: allowance above the ceiling, exemption lost; expired / not_started: outside the period. */
  ir: 'exempt' | 'over_ceiling' | 'expired' | 'not_started';
  cnss_exempt: boolean;
  /** Last day of the month of the last exempt payslip. */
  ir_end: string;
  /** One sentence for the payslip. */
  note: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Index of a pay month counted from the start month (0 = the start month). */
function monthIndex(start: string, month: number, year: number): number | null {
  const [sy, sm] = start.slice(0, 10).split('-').map(Number);
  if (!sy || !sm) return null;
  return year * 12 + month - (sy * 12 + sm);
}

/** Last day of the last month of the IR exemption (12 monthly payslips from the start month). */
export function traineeIrEnd(t: Pick<TraineeTerms, 'start_date' | 'ir_months'>): string {
  const [sy, sm] = t.start_date.slice(0, 10).split('-').map(Number);
  return iso(new Date(sy, sm - 1 + t.ir_months, 0));
}

/**
 * Exemptions of a trainee's payslip. The IR exemption covers the monthly
 * payslips of the first `ir_months` months from the start month, and only
 * when the gross allowance is at or under the ceiling: above it, CGI art.
 * 57-16° says the exemption is lost ("perdent le bénéfice de l'exonération"),
 * so the whole allowance is taxed, not just the excess.
 */
export function traineeOutcome(t: TraineeTerms, month: number, year: number, grossAllowance: number): TraineeOutcome {
  const idx = monthIndex(t.start_date, month, year);
  const fmtN = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const end = traineeIrEnd(t);
  const endFr = end.split('-').reverse().join('/');
  const cnss_exempt = t.cnss_exempt && idx != null && idx >= 0 && idx < t.cnss_months;
  if (idx == null || idx < 0) return { ir: 'not_started', cnss_exempt, ir_end: end, note: 'Stage pas encore commencé ce mois : IR normal.' };
  if (idx >= t.ir_months) return { ir: 'expired', cnss_exempt, ir_end: end, note: `Exonération IR du stage terminée le ${endFr} (${t.ir_months} mois) : IR normal.` };
  if (grossAllowance > t.ir_ceiling + 0.005) {
    return { ir: 'over_ceiling', cnss_exempt, ir_end: end, note: `Indemnité de ${fmtN(grossAllowance)} MAD au-dessus du plafond de ${fmtN(t.ir_ceiling)} MAD : l'exonération est perdue, toute l'indemnité est imposée (CGI art. 57-16°).` };
  }
  return { ir: 'exempt', cnss_exempt, ir_end: end, note: `Stagiaire ANAPEC : indemnité exonérée d'IR jusqu'à ${fmtN(t.ir_ceiling)} MAD par mois, jusqu'au ${endFr} (CGI art. 57-16°).` };
}

// ── The payslip computation ─────────────────────────────────────────────────

export interface PayslipInput {
  base_salary: number;
  /** Seniority from the hire date at the end of the period… */
  hire_date?: string | null;
  period_month?: number;
  period_year?: number;
  /** …or a given amount (simulator, STC). */
  anciennete_amount?: number;
  lines?: PayLine[];
  /** Employee CIMR rate, in % (6 = 6 %). */
  cimr_rate?: number;
  /** Employer CIMR rate, in %; defaults to the employee rate. */
  cimr_employer_rate?: number | null;
  dependents_count?: number;
  settings?: PayrollSettings;
  /**
   * IR regularisation applied on this payslip: positive gives back IR withheld
   * in excess earlier in the year, negative collects IR under-withheld.
   */
  ir_regularisation?: number;
  /** A trainee's contract (needs the period): IR and CNSS exemptions. */
  trainee?: TraineeTerms | null;
}

export interface PayslipResult {
  anciennete_rate: number;
  anciennete_amount: number;
  /** Gains on top of base and seniority. */
  other_earnings: number;
  /** Absence-type deductions (they lower the gross). */
  gross_deductions: number;
  /** Total gross paid (base + seniority + gains − absences). */
  brut_global: number;
  /** IR taxable gross (salaire brut imposable). */
  brut_imposable: number;
  cnss_base: number;
  amo_base: number;
  cimr_base: number;
  cnss_employee: number;
  amo_employee: number;
  cimr_employee: number;
  frais_pro: number;
  /** Net taxable salary (salaire net imposable). */
  net_imposable: number;
  /** IR of the month before any regularisation. */
  ir_brut: number;
  /** Regularisation actually applied (capped so the month's IR stays ≥ 0). */
  ir_regularisation: number;
  /** Net IR withheld this month. */
  ir_amount: number;
  /** Deductions after tax (advances, loans). */
  autres_retenues: number;
  total_deductions: number;
  net_salary: number;
  cnss_employer: number;
  amo_employer: number;
  alloc_familiales: number;
  tfp_employer: number;
  cimr_employer: number;
  charges_patronales: number;
  employer_cost: number;
  /** Set on a trainee's payslip: which exemptions applied and why. */
  trainee?: TraineeOutcome | null;
}

/**
 * A full monthly payslip. Four bases come from the line flags: IR taxable
 * gross, CNSS base (capped at 6,000 for the CNSS branches only), AMO base and
 * CIMR base. Family allowances and training tax use the uncapped CNSS base.
 */
export function computePayslip(input: PayslipInput): PayslipResult {
  const s = input.settings || officialSettingsFor(input.period_year || new Date().getFullYear());
  const base = r2(Number(input.base_salary) || 0);
  const lines = (input.lines || []).map(l => ({ ...l, amount: r2(Number(l.amount) || 0) }));

  const anc = input.anciennete_amount != null
    ? { rate: 0, amount: r2(input.anciennete_amount) }
    : input.period_month && input.period_year
      ? computeAnciennete(input.hire_date || undefined, seniorityBase(base, lines), periodEnd(input.period_month, input.period_year))
      : { rate: 0, amount: 0 };

  const fixed = base + anc.amount;
  const gains = lines.filter(l => l.type === 'gain');
  const absences = lines.filter(isGrossDeduction);
  const afterTax = lines.filter(l => l.type === 'retenue' && !isGrossDeduction(l));
  const sum = (ls: PayLine[], f: (l: PayLine) => number = l => l.amount) => ls.reduce((t, l) => t + f(l), 0);

  const other_earnings = r2(sum(gains));
  const gross_deductions = r2(sum(absences));
  const brut_global = r2(fixed + other_earnings - gross_deductions);

  // A trainee's exemptions depend on the month and on the gross allowance.
  const trainee = input.trainee && input.period_month && input.period_year
    ? traineeOutcome(input.trainee, input.period_month, input.period_year, brut_global)
    : null;
  const irExempt = trainee?.ir === 'exempt';

  const irCeil = (l: PayLine) => ceilingAmount(l.ir_ceiling, base);
  const cnssCeil = (l: PayLine) => ceilingAmount(l.cnss_ceiling, base);
  const brut_imposable = irExempt ? 0 : r2(Math.max(0, fixed
    + sum(gains, l => subjectPart(l.amount, !!l.soumis_ir, irCeil(l)))
    - sum(absences.filter(l => l.soumis_ir))));
  const cnss_base = r2(Math.max(0, fixed
    + sum(gains, l => subjectPart(l.amount, !!l.soumis_cnss, cnssCeil(l)))
    - sum(absences.filter(l => l.soumis_cnss))));
  const amo_base = r2(Math.max(0, fixed
    + sum(gains, l => subjectPart(l.amount, amoFlag(l), cnssCeil(l)))
    - sum(absences.filter(amoFlag))));
  const cimr_base = r2(Math.max(0, fixed
    + sum(gains.filter(l => l.soumis_cimr))
    - sum(absences.filter(l => l.soumis_cimr))));

  // Trainee CNSS exemption (employee setting): no CNSS share, no family
  // allowances, no training tax. AMO stays due (not covered by the setting).
  const cnssFree = !!trainee?.cnss_exempt;
  const capped = cnssFree ? 0 : Math.min(cnss_base, s.cnss_cap);
  const cnss_employee = r2(capped * s.cnss_rate_emp);
  const amo_employee = r2(amo_base * s.amo_rate_emp);
  const cimrRate = Number(input.cimr_rate) || 0;
  const cimrErRate = input.cimr_employer_rate == null ? cimrRate : Number(input.cimr_employer_rate) || 0;
  const cimr_employee = r2(cimr_base * cimrRate / 100);
  const cimr_employer = r2(cimr_base * cimrErRate / 100);

  // Professional expenses on the taxable gross; the rate depends on the
  // annualised taxable gross, the cap is monthly (annual cap / 12).
  const fraisRate = brut_imposable * 12 <= s.frais_pro_threshold ? s.frais_pro_low : s.frais_pro_high;
  const frais_pro = r2(Math.min(brut_imposable * fraisRate, s.frais_pro_cap / 12));
  const net_imposable = r2(Math.max(0, brut_imposable - frais_pro - cnss_employee - amo_employee - cimr_employee));

  const familyDed = Math.min(Number(input.dependents_count) || 0, s.family_ded_max) * s.family_ded_per_dep;
  const ir_brut = r2(Math.max(0, (applyIRBrackets(net_imposable * 12, s.ir_brackets) - familyDed) / 12));
  const wanted = r2(Number(input.ir_regularisation) || 0);
  // A refund cannot take the month's IR below zero; the rest stays owed.
  const ir_regularisation = wanted > 0 ? Math.min(wanted, ir_brut) : wanted;
  const ir_amount = r2(ir_brut - ir_regularisation);

  const autres_retenues = r2(sum(afterTax));
  const total_deductions = r2(cnss_employee + amo_employee + cimr_employee + ir_amount + autres_retenues);
  const net_salary = r2(brut_global - total_deductions);

  const cnss_employer = r2(capped * s.cnss_rate_er);
  const amo_employer = r2(amo_base * s.amo_rate_er);
  const alloc_familiales = cnssFree ? 0 : r2(cnss_base * s.af_rate);
  const tfp_employer = cnssFree ? 0 : r2(cnss_base * s.tfp_rate);
  const charges_patronales = r2(cnss_employer + amo_employer + alloc_familiales + tfp_employer + cimr_employer);
  const employer_cost = r2(brut_global + charges_patronales);

  return {
    anciennete_rate: anc.rate, anciennete_amount: anc.amount, other_earnings, gross_deductions,
    brut_global, brut_imposable, cnss_base, amo_base, cimr_base,
    cnss_employee, amo_employee, cimr_employee, frais_pro, net_imposable,
    ir_brut, ir_regularisation, ir_amount, autres_retenues, total_deductions, net_salary,
    cnss_employer, amo_employer, alloc_familiales, tfp_employer, cimr_employer, charges_patronales, employer_cost,
    trainee,
  };
}

// ── Simple inputs (simulator, STC) ──────────────────────────────────────────
export interface PayrollInput {
  base_salary: number;
  anciennete_amount?: number;
  primes_soumises?: number;      // subject to CNSS, AMO and IR
  heures_supp?: number;          // overtime amount (subject)
  primes_non_soumises?: number;  // fully exempt allowances
  autres_retenues?: number;      // advances, loans (after tax)
  cimr_rate?: number;
  cimr_employer_rate?: number | null;
  dependents_count?: number;
  settings?: PayrollSettings;
}

export type PayrollResult = PayslipResult;

/** Monthly payroll from amounts rather than lines. */
export function computePayroll(input: PayrollInput): PayrollResult {
  const subject = { soumis_cnss: true, soumis_amo: true, soumis_ir: true };
  const lines: PayLine[] = [
    { type: 'gain', amount: Number(input.primes_soumises) || 0, ...subject },
    { type: 'gain', amount: Number(input.heures_supp) || 0, ...subject },
    { type: 'gain', amount: Number(input.primes_non_soumises) || 0 },
    { type: 'retenue', amount: Number(input.autres_retenues) || 0 },
  ].filter(l => l.amount !== 0) as PayLine[];
  return computePayslip({
    base_salary: input.base_salary, anciennete_amount: Number(input.anciennete_amount) || 0, lines,
    cimr_rate: input.cimr_rate, cimr_employer_rate: input.cimr_employer_rate,
    dependents_count: input.dependents_count, settings: input.settings,
  });
}

// ── Checks ──────────────────────────────────────────────────────────────────

/**
 * Minimum-wage warning for a full-time base salary (non-blocking: part-time
 * exists). Null when the salary reaches SMIG × 191 or the hours are part-time.
 */
export function smigWarning(baseSalary: number, settings: PayrollSettings, hoursWorked: number = LEGAL_MONTHLY_HOURS, contractType?: string | null): string | null {
  // A trainee receives an internship allowance, not a salary: no SMIG.
  if (contractType === 'Stage') return null;
  const legal = smigMonthly(settings);
  if (!legal || (Number(hoursWorked) || 0) < LEGAL_MONTHLY_HOURS) return null;
  if ((Number(baseSalary) || 0) >= legal) return null;
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const year = settings.year ? ` ${settings.year}` : '';
  return `Salaire de base sous le SMIG${year} : ${fmt(legal)} MAD pour 191 h (${fmt(settings.smig_hourly)} MAD/h). Normal seulement pour un temps partiel.`;
}

export interface NetPayCheck { error: string | null; warning: string | null }

/**
 * Net pay checks: a negative net blocks validation; advances and loans above
 * a third of the net pay are flagged (the legal limit on what can be withheld).
 */
export function checkNetPay(netSalary: number, loanWithheld: number): NetPayCheck {
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  if (netSalary < 0) return { error: `Net à payer négatif (${fmt(netSalary)} MAD) : réduisez les retenues avant de valider.`, warning: null };
  const before = netSalary + loanWithheld;
  if (loanWithheld > 0 && loanWithheld > before / 3 + 0.005) {
    return { error: null, warning: `Les avances et prêts retenus (${fmt(loanWithheld)} MAD) dépassent le tiers du net (${fmt(before / 3)} MAD).` };
  }
  return { error: null, warning: null };
}

export interface WorkingDayRules {
  /** Weekly rest day, 0 = Sunday … 6 = Saturday (company setting). */
  restDay?: number;
  /** Paid public holidays, as YYYY-MM-DD. */
  holidays?: Iterable<string>;
}

/**
 * Days a leave takes from the paid-leave balance: jours ouvrables, i.e. every
 * day except the weekly rest day and paid public holidays (Code du travail
 * art. 231). Without rules: every day but Sunday.
 */
export function leaveWorkingDays(start: string, end: string, rules: WorkingDayRules = {}): number {
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number);
  if (!sy || !ey) return 0;
  const rest = rules.restDay ?? 0;
  const off = new Set(rules.holidays || []);
  let days = 0;
  for (let d = new Date(sy, sm - 1, sd); d <= new Date(ey, em - 1, ed); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== rest && !off.has(iso(d))) days += 1;
  }
  return days;
}
