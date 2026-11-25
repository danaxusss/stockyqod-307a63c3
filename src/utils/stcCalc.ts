// Solde de tout compte (final settlement): pure computation.
//
// Labour rules (Code du travail, research level unless the HR report says
// otherwise): severance art. 52–53 (6 months of service at least, none for
// serious misconduct, 96 / 144 / 192 / 240 hours of salary per year of service
// by band, on the average salary of the last 52 weeks, never below the
// minimum wage); notice art. 43 and following; paid leave not taken is paid.
// Tax: CGI art. 57-7° (checked in the text): the dismissal indemnity, the
// voluntary-departure indemnity and court-awarded damages are exempt from IR
// within a combined ceiling of 1,000,000 MAD; the excess is taxable salary.
// Notice pay and leave pay are ordinary salary.
//
// The settlement is computed as the employee's final payslip of the exit
// month (one engine, the usual annualisation): the elements become lines.

import { checkNetPay, computePayslip, isGrossDeduction, leaveWorkingDays, type NetPayCheck, type PayslipResult, type WorkingDayRules } from './payrollCalc';
import { LEGAL_MONTHLY_HOURS, FULL_MONTH_CNSS_DAYS, type HrLimits, type PayrollSettings } from './payrollDefaults';
import { traineeTermsFor, type PayslipEmployee } from './payslipCompute';
import { blankLine, loanLine, LOAN_LINE, type PayslipLine } from './payslipLines';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── Motifs ──────────────────────────────────────────────────────────────────

export type StcMotif = 'licenciement' | 'faute_grave' | 'demission' | 'fin_cdd' | 'depart_negocie' | 'retraite' | 'deces';

export interface MotifRules {
  label: string;
  /** legal: the art. 53 scale; negotiated: an agreed amount; none: not due. */
  severance: 'legal' | 'negotiated' | 'none';
  /** Why no severance (shown as "non due : …"). */
  severanceNote?: string;
  /** employer: paid when not worked; employee: owed by the employee, not paid; none. */
  notice: 'employer' | 'employee' | 'none' | 'optional';
  noticeNote?: string;
  /** Court-awarded damages can be entered (dismissal only). */
  damages: boolean;
  /** A retirement indemnity from a collective agreement or the contract can be entered. */
  retirement: boolean;
}

export const STC_MOTIFS: Record<StcMotif, MotifRules> = {
  licenciement: { label: 'Licenciement', severance: 'legal', notice: 'employer', damages: true, retirement: false },
  faute_grave: {
    label: 'Licenciement pour faute grave', severance: 'none', severanceNote: 'faute grave',
    notice: 'none', noticeNote: 'faute grave', damages: false, retirement: false,
  },
  demission: {
    label: 'Démission', severance: 'none', severanceNote: 'démission',
    notice: 'employee', noticeNote: 'dû par le salarié, non payé', damages: false, retirement: false,
  },
  fin_cdd: {
    label: 'Fin de CDD', severance: 'none', severanceNote: 'fin de CDD',
    notice: 'none', noticeNote: 'fin de CDD', damages: false, retirement: false,
  },
  depart_negocie: { label: 'Départ négocié / volontaire', severance: 'negotiated', notice: 'optional', damages: false, retirement: false },
  retraite: {
    label: 'Départ à la retraite', severance: 'none', severanceNote: 'retraite (pas d\'indemnité légale ; indemnité conventionnelle éventuelle ci-dessous)',
    notice: 'optional', damages: false, retirement: true,
  },
  deces: {
    label: 'Décès', severance: 'none', severanceNote: 'décès', notice: 'none', noticeNote: 'décès',
    damages: false, retirement: false,
  },
};

// ── Seniority to the day ────────────────────────────────────────────────────

export interface ServiceLength { years: number; months: number; days: number; /** years + months/12 + days/365 */ decimal: number }

const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), lastDay));
};

/**
 * Service from the hire day to the exit day included (exit = last day of the
 * contract): whole years, then whole months, then days. The fraction of a
 * year counts months as twelfths and days as 1/365.
 */
export function serviceLength(hire: string | null | undefined, exit: string): ServiceLength {
  if (!hire) return { years: 0, months: 0, days: 0, decimal: 0 };
  const start = parse(hire);
  const e = parse(exit);
  const endExcl = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
  if (endExcl <= start) return { years: 0, months: 0, days: 0, decimal: 0 };
  let total = 0;
  while (addMonths(start, total + 1) <= endExcl) total += 1;
  const years = Math.floor(total / 12);
  const months = total % 12;
  const days = Math.round((endExcl.getTime() - addMonths(start, total).getTime()) / 864e5);
  return { years, months, days, decimal: years + months / 12 + days / 365 };
}

export const formatServiceLength = (l: ServiceLength) =>
  [`${l.years} an${l.years > 1 ? 's' : ''}`, `${l.months} mois`, `${l.days} jour${l.days > 1 ? 's' : ''}`].join(' ');

// ── Severance scale (art. 53) ───────────────────────────────────────────────

export const SEVERANCE_SCALE: { years: number; hours: number; label: string }[] = [
  { years: 5, hours: 96, label: '1re à 5e année' },
  { years: 5, hours: 144, label: '6e à 10e année' },
  { years: 5, hours: 192, label: '11e à 15e année' },
  { years: Infinity, hours: 240, label: 'au-delà de 15 ans' },
];

export interface SeveranceBand { label: string; years: number; hoursPerYear: number; hours: number }

/** Hours of salary owed for a length of service, band by band. */
export function severanceHours(decimalYears: number): { hours: number; bands: SeveranceBand[] } {
  const bands: SeveranceBand[] = [];
  let left = Math.max(0, decimalYears);
  for (const b of SEVERANCE_SCALE) {
    if (left <= 0) break;
    const y = Math.min(left, b.years);
    bands.push({ label: b.label, years: y, hoursPerYear: b.hours, hours: y * b.hours });
    left -= y;
  }
  return { hours: bands.reduce((s, b) => s + b.hours, 0), bands };
}

export interface LegalSeverance {
  due: boolean;
  /** "non due : …" when not due. */
  reason: string | null;
  hours: number;
  bands: SeveranceBand[];
  /** Monthly reference salary / 191. */
  hourly: number;
  amount: number;
}

/** The legal dismissal indemnity: reference salary / 191 × the scale hours; 6 months of service at least. */
export function legalSeverance(reference: number, length: ServiceLength): LegalSeverance {
  const { hours, bands } = severanceHours(length.decimal);
  const hourly = (Number(reference) || 0) / LEGAL_MONTHLY_HOURS;
  if (length.years === 0 && length.months < 6) {
    return { due: false, reason: 'moins de 6 mois de service', hours, bands, hourly, amount: 0 };
  }
  // Hours × monthly / 191 in one step, so the hourly rate is not rounded first.
  return { due: true, reason: null, hours, bands, hourly, amount: r2(hours * (Number(reference) || 0) / LEGAL_MONTHLY_HOURS) };
}

// ── Reference salary ────────────────────────────────────────────────────────

export interface RefLine { type: 'gain' | 'retenue'; amount: number; code?: string | null; soumis_cnss?: boolean; soumis_amo?: boolean | null; soumis_ir?: boolean; soumis_cimr?: boolean }

export interface RefPayslip {
  id: string;
  period_month: number;
  period_year: number;
  base_salary: number;
  anciennete_amount: number;
  lines: RefLine[];
}

export interface ReferenceMonth { id: string; month: number; year: number; base: number; seniority: number; gains: number; absences: number; total: number }

export interface ReferenceSalary {
  months: ReferenceMonth[];
  /** Average of the months (0 without payslips). */
  average: number;
  /** SMIG × 191 for the exit year. */
  floor: number;
  /** What the settlement uses: the average (or the fallback), never below the floor. */
  value: number;
  source: 'payslips' | 'fallback';
  floored: boolean;
}

/** STC lines are never salary for the reference. */
const isStcCode = (code: string | null | undefined) => !!code && code.startsWith('STC_');

/**
 * Average monthly salary of the last 12 validated payslips up to the exit
 * month: base + seniority + gains subject to IR or CNSS (part of salary;
 * exempt reimbursements left out) − absences. Without payslips, `fallback`
 * (current base + seniority). Never below the minimum wage.
 */
export function referenceSalary(payslips: RefPayslip[], exitDate: string, floor: number, fallback: number): ReferenceSalary {
  const [ey, em] = exitDate.slice(0, 10).split('-').map(Number);
  const months = payslips
    .filter(p => p.period_year * 12 + p.period_month <= ey * 12 + em)
    .sort((a, b) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month))
    .slice(0, 12)
    .map(p => {
      const gains = r2(p.lines.filter(l => l.type === 'gain' && !isStcCode(l.code) && (l.soumis_ir || l.soumis_cnss)).reduce((s, l) => s + (Number(l.amount) || 0), 0));
      const absences = r2(p.lines.filter(l => isGrossDeduction({ ...l, soumis_amo: l.soumis_amo ?? null })).reduce((s, l) => s + (Number(l.amount) || 0), 0));
      const base = r2(p.base_salary);
      const seniority = r2(p.anciennete_amount);
      return { id: p.id, month: p.period_month, year: p.period_year, base, seniority, gains, absences, total: r2(base + seniority + gains - absences) };
    })
    .reverse();
  const average = months.length ? r2(months.reduce((s, m) => s + m.total, 0) / months.length) : 0;
  const raw = months.length ? average : r2(fallback);
  return { months, average, floor: r2(floor), value: r2(Math.max(raw, floor)), source: months.length ? 'payslips' : 'fallback', floored: raw < floor };
}

// ── Exit month salary ───────────────────────────────────────────────────────

/**
 * Salary of the exit month: the full base when the contract runs to the end
 * of the month, else base / 26 per working day up to the exit date (paid
 * holidays are paid days: only the weekly rest day is left out), never more
 * than the base.
 */
export function exitMonthSalary(base: number, hire: string | null | undefined, exit: string, rules: Pick<WorkingDayRules, 'restDay'> = {}): { amount: number; days: number; full: boolean } {
  const e = parse(exit);
  const first = new Date(e.getFullYear(), e.getMonth(), 1);
  const last = new Date(e.getFullYear(), e.getMonth() + 1, 0);
  const from = hire && parse(hire) > first ? parse(hire) : first;
  const fullMonth = from.getTime() === first.getTime() && e.getTime() === last.getTime();
  const days = leaveWorkingDays(iso(from), exit, { restDay: rules.restDay });
  if (fullMonth) return { amount: r2(base), days, full: true };
  return { amount: r2(Math.min(base, days * base / FULL_MONTH_CNSS_DAYS)), days, full: false };
}

// ── The settlement ──────────────────────────────────────────────────────────

/** Default notice in months: 1 under 5 years, 2 from 5 years (editable). */
export function defaultNoticeMonths(motif: StcMotif, length: ServiceLength): number {
  const n = STC_MOTIFS[motif].notice;
  if (n === 'employer') return length.decimal >= 5 ? 2 : 1;
  return 0;
}

/** Splits a combined exemption ceiling over amounts, in order. */
export function allocateCeiling(amounts: number[], ceiling: number): number[] {
  let left = Math.max(0, ceiling);
  return amounts.map(a => {
    const part = Math.min(Math.max(0, Number(a) || 0), left);
    left -= part;
    return r2(part);
  });
}

export interface StcInput {
  motif: StcMotif;
  hire_date: string | null | undefined;
  exit_date: string;
  /** Monthly reference salary (after any override and the floor). */
  reference: number;
  /** Salary of the exit month (prorated). */
  monthSalary: number;
  noticeMonths: number;
  leaveDays: number;
  /** Departure by agreement: the agreed indemnity. */
  negotiated?: number;
  /** Court-awarded damages (dismissal). */
  damages?: number;
  /** Conventional retirement indemnity (taxable). */
  retirement?: number;
  /** Advances and loans withheld on the settlement. */
  loans: number;
  /** Lines already on the exit month's open payslip (bonuses, absences). */
  otherLines?: PayslipLine[];
  employee: PayslipEmployee;
  settings: PayrollSettings;
  limits: HrLimits;
}

export interface StcElement {
  code: string;
  label: string;
  amount: number;
  due: boolean;
  /** "non due : …" or how the amount is worked out. */
  detail: string;
  ir: string;
  cnss: string;
}

export interface StcResult {
  length: ServiceLength;
  severance: LegalSeverance;
  elements: StcElement[];
  /** STC lines of the final payslip (without the other lines). */
  lines: PayslipLine[];
  /** The final payslip's computation (other lines included). */
  payslip: PayslipResult;
  /** Exempt part of severance-type indemnities and the taxed excess. */
  exemptIr: number;
  taxedExcess: number;
  loanCheck: NetPayCheck;
  netToPay: number;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Gain line subject to CNSS, AMO and IR (salary). */
const salaryLine = (code: string, label: string, amount: number, quantity = 1): PayslipLine => ({
  ...blankLine('gain'), code, label, amount: r2(amount), quantity, soumis_cnss: true, soumis_amo: true, soumis_ir: true,
});

/** Gain line exempt from IR up to `irPart`; CNSS exempt up to `cnssCeiling` (null = fully exempt). */
const indemnityLine = (code: string, label: string, amount: number, irPart: number, cnssCeiling: number | null): PayslipLine => ({
  ...blankLine('gain'), code, label, amount: r2(amount),
  soumis_cnss: false, soumis_amo: false, soumis_ir: false,
  ir_ceiling: { type: 'amount', value: r2(irPart) },
  cnss_ceiling: cnssCeiling == null ? null : { type: 'amount', value: r2(cnssCeiling) },
});

export function computeStc(input: StcInput): StcResult {
  const rules = STC_MOTIFS[input.motif];
  const length = serviceLength(input.hire_date, input.exit_date);
  const ref = r2(input.reference);
  const severance = legalSeverance(ref, length);
  const elements: StcElement[] = [];
  const lines: PayslipLine[] = [];
  const CNSS_TBC = 'à confirmer avec la CNSS';

  // Severance-type indemnities share the 1,000,000 MAD exemption (CGI 57-7°).
  const legalAmount = rules.severance === 'legal' && severance.due ? severance.amount : 0;
  const negotiated = rules.severance === 'negotiated' ? r2(Math.max(0, Number(input.negotiated) || 0)) : 0;
  const damages = rules.damages ? r2(Math.max(0, Number(input.damages) || 0)) : 0;
  const [legalIr, negotiatedIr, damagesIr] = allocateCeiling([legalAmount, negotiated, damages], input.limits.severance_ir_ceiling);
  const ceilingTxt = `exonérée d'IR dans la limite de ${fmt(input.limits.severance_ir_ceiling)} MAD pour l'ensemble des indemnités de rupture (CGI art. 57-7°), excédent imposable`;

  // Salary of the exit month.
  elements.push({ code: 'SALAIRE', label: 'Salaire du mois de sortie', amount: r2(input.monthSalary), due: true, detail: 'au prorata des jours jusqu\'à la sortie', ir: 'imposable', cnss: 'soumis' });

  // Severance.
  const bandTxt = severance.bands.map(b => `${fmt(b.years)} an × ${b.hoursPerYear} h`).join(' + ');
  if (rules.severance === 'legal') {
    const why = severance.due ? null : severance.reason;
    elements.push({
      code: 'STC_LICENCIEMENT', label: 'Indemnité de licenciement', amount: legalAmount, due: severance.due,
      detail: severance.due ? `${bandTxt} = ${fmt(severance.hours)} h × ${fmt(ref)} / 191` : `non due : ${why}`,
      ir: ceilingTxt, cnss: `non soumise dans la limite légale (${CNSS_TBC})`,
    });
    if (legalAmount > 0) lines.push(indemnityLine('STC_LICENCIEMENT', `Indemnité de licenciement (${fmt(severance.hours)} h)`, legalAmount, legalIr, null));
  } else if (rules.severance === 'negotiated') {
    elements.push({
      code: 'STC_NEGOCIE', label: 'Indemnité de départ négocié', amount: negotiated, due: true,
      detail: `montant convenu ; minimum légal de référence ${fmt(severance.due ? severance.amount : 0)} MAD`,
      ir: ceilingTxt, cnss: `non soumise jusqu'au montant légal, excédent soumis (${CNSS_TBC})`,
    });
    if (negotiated > 0) lines.push(indemnityLine('STC_NEGOCIE', 'Indemnité de départ volontaire', negotiated, negotiatedIr, severance.due ? severance.amount : 0));
  } else {
    elements.push({ code: 'STC_LICENCIEMENT', label: 'Indemnité de licenciement', amount: 0, due: false, detail: `non due : ${rules.severanceNote}`, ir: '—', cnss: '—' });
  }

  // Notice.
  const noticeMonths = rules.notice === 'employer' || rules.notice === 'optional' ? Math.max(0, Number(input.noticeMonths) || 0) : 0;
  const notice = r2(noticeMonths * ref);
  elements.push({
    code: 'STC_PREAVIS', label: 'Indemnité compensatrice de préavis', amount: notice, due: noticeMonths > 0,
    detail: rules.notice === 'employee' || rules.notice === 'none' ? `non due : ${rules.noticeNote}` : noticeMonths > 0 ? `${fmt(noticeMonths)} mois × ${fmt(ref)}` : 'préavis effectué ou non dû',
    ir: 'imposable (salaire)', cnss: 'soumise (salaire)',
  });
  if (notice > 0) lines.push(salaryLine('STC_PREAVIS', `Indemnité compensatrice de préavis (${fmt(noticeMonths)} mois)`, notice, noticeMonths));

  // Paid leave not taken.
  const leaveDays = Math.max(0, Number(input.leaveDays) || 0);
  const leave = r2(leaveDays * ref / FULL_MONTH_CNSS_DAYS);
  elements.push({
    code: 'STC_CONGES', label: 'Indemnité compensatrice de congés payés', amount: leave, due: leaveDays > 0,
    detail: `${fmt(leaveDays)} j × ${fmt(ref)} / 26`, ir: 'imposable (salaire)', cnss: 'soumise (salaire)',
  });
  if (leave > 0) lines.push(salaryLine('STC_CONGES', `Indemnité compensatrice de congés payés (${fmt(leaveDays)} j)`, leave, leaveDays));

  if (rules.damages && damages > 0) {
    elements.push({ code: 'STC_DOMMAGES', label: 'Dommages et intérêts (jugement)', amount: damages, due: true, detail: 'montant fixé par le tribunal', ir: ceilingTxt, cnss: `non soumis (${CNSS_TBC})` });
    lines.push(indemnityLine('STC_DOMMAGES', 'Dommages et intérêts pour licenciement', damages, damagesIr, null));
  }
  const retirement = rules.retirement ? r2(Math.max(0, Number(input.retirement) || 0)) : 0;
  if (rules.retirement) {
    elements.push({
      code: 'STC_RETRAITE', label: 'Indemnité de départ à la retraite', amount: retirement, due: retirement > 0,
      detail: 'convention collective ou contrat', ir: 'imposable (hors art. 57-7°)', cnss: `soumise (${CNSS_TBC})`,
    });
    if (retirement > 0) lines.push(salaryLine('STC_RETRAITE', 'Indemnité de départ à la retraite', retirement));
  }

  const loans = r2(Math.max(0, Number(input.loans) || 0));
  if (loans > 0) lines.push(loanLine(loans));

  const [y, m] = input.exit_date.slice(0, 10).split('-').map(Number);
  const others = (input.otherLines || []).filter(l => !isStcCode(l.code) && l.code !== LOAN_LINE.code);
  const payslip = computePayslip({
    base_salary: input.monthSalary, hire_date: input.employee.hire_date, period_month: m, period_year: y,
    lines: [...others, ...lines], cimr_rate: Number(input.employee.cimr_rate) || 0,
    cimr_employer_rate: input.employee.cimr_employer_rate ?? null, dependents_count: input.employee.dependents_count ?? 0,
    settings: input.settings, trainee: traineeTermsFor(input.employee, y),
  });
  const indemnities = legalAmount + negotiated + damages;
  const exemptIr = r2(legalIr + negotiatedIr + damagesIr);
  return {
    length, severance, elements, lines, payslip,
    exemptIr, taxedExcess: r2(indemnities - exemptIr),
    loanCheck: checkNetPay(payslip.net_salary, loans),
    netToPay: payslip.net_salary,
  };
}
