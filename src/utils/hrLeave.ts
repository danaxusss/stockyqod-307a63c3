// Paid leave and public holidays (pure functions; the services load the data).
//
// Rules (Code du travail, from research; see the HR report for what was
// checked in a text):
// - art. 231: 1.5 working days of paid leave per month of service, 2 days for
//   employees under 18;
// - art. 232: + 1.5 days per full period of 5 years of service, the total
//   capped at 30 working days;
// - working days (jours ouvrables): every day except the weekly rest day and
//   paid public holidays.

import { leaveWorkingDays, seniorityYears, type WorkingDayRules } from './payrollCalc';
import type { PayslipLine } from './payslipLines';
import { blankLine } from './payslipLines';
import { FULL_MONTH_CNSS_DAYS } from './payrollDefaults';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const frDay = (s: string) => s.slice(0, 10).split('-').reverse().join('/');

// ── Public holidays ─────────────────────────────────────────────────────────

export interface Holiday {
  date: string;
  label: string;
  kind: 'civil' | 'religieux';
}

/**
 * Paid civil holidays of the private sector, fixed dates. Yennayer (14 Jan)
 * is paid since 2024 and Aïd Al Wahda (31 Oct) from 2026 (research level:
 * the decrees were not checked).
 */
export function fixedCivilHolidays(year: number): Holiday[] {
  const d = (m: number, day: number, label: string): Holiday => ({ date: `${year}-${pad(m)}-${pad(day)}`, label, kind: 'civil' });
  const out: Holiday[] = [
    d(1, 1, 'Nouvel an'),
    d(1, 11, 'Manifeste de l\'Indépendance'),
  ];
  if (year >= 2024) out.push(d(1, 14, 'Nouvel an amazigh (Yennayer)'));
  out.push(
    d(5, 1, 'Fête du Travail'),
    d(7, 30, 'Fête du Trône'),
    d(8, 14, 'Allégeance Oued Eddahab'),
    d(8, 20, 'Révolution du Roi et du Peuple'),
    d(8, 21, 'Fête de la Jeunesse'),
  );
  if (year >= 2026) out.push(d(10, 31, 'Aïd Al Wahda'));
  out.push(d(11, 6, 'Marche Verte'), d(11, 18, 'Fête de l\'Indépendance'));
  return out;
}

/** Religious holidays: lunar dates, announced each year, entered by the user. */
export const RELIGIOUS_HOLIDAYS: { label: string; days: number }[] = [
  { label: '1er Moharram', days: 1 },
  { label: 'Aïd Al Mawlid', days: 2 },
  { label: 'Aïd Al Fitr', days: 2 },
  { label: 'Aïd Al Adha', days: 2 },
];

// ── Working days ────────────────────────────────────────────────────────────

/** Working days of a period that fall in a given month. */
export function workingDaysInMonth(start: string, end: string, month: number, year: number, rules: WorkingDayRules = {}): number {
  const first = `${year}-${pad(month)}-01`;
  const last = iso(new Date(year, month, 0));
  const from = start.slice(0, 10) > first ? start.slice(0, 10) : first;
  const to = end.slice(0, 10) < last ? end.slice(0, 10) : last;
  if (from > to) return 0;
  return leaveWorkingDays(from, to, rules);
}

// ── Entitlement ─────────────────────────────────────────────────────────────

const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), lastDay));
};

export interface LeaveEntitlement {
  /** Whole months of service in the year, up to the date. */
  months: number;
  /** Of which months while under 18 (2 days each). */
  minorMonths: number;
  /** Days earned by the months (1.5 or 2 a month). */
  monthlyDays: number;
  /** Full years of service at the date. */
  seniorityYears: number;
  /** 1.5 days per full 5 years of service. */
  seniorityDays: number;
  /** True when the 30-day cap cut the total. */
  capped: boolean;
  /** Days of paid leave earned for the year, up to the date. */
  entitlement: number;
}

export const LEAVE_CAP_DAYS = 30;

/**
 * Paid leave earned in `year` up to `asOf` (inclusive). A month counts when
 * it is complete (from the hire day, or 1 January); a month is a minor's
 * month when the employee is under 18 at its end.
 */
export function leaveEntitlement(
  employee: { hire_date?: string | null; birth_date?: string | null },
  year: number, asOf: Date, daysPerMonth = 1.5,
): LeaveEntitlement {
  const none: LeaveEntitlement = { months: 0, minorMonths: 0, monthlyDays: 0, seniorityYears: 0, seniorityDays: 0, capped: false, entitlement: 0 };
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const hire = employee.hire_date ? parse(employee.hire_date) : yearStart;
  const start = hire > yearStart ? hire : yearStart;
  const end = asOf < yearEnd ? asOf : yearEnd;
  if (end < start) return none;
  const endExcl = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const birth = employee.birth_date ? parse(employee.birth_date) : null;
  let months = 0;
  let minorMonths = 0;
  while (addMonths(start, months + 1) <= endExcl) {
    const monthEnd = addMonths(start, months + 1);
    monthEnd.setDate(monthEnd.getDate() - 1);
    if (birth && seniorityYears(iso(birth), monthEnd) < 18) minorMonths += 1;
    months += 1;
  }
  const monthlyDays = r2((months - minorMonths) * daysPerMonth + minorMonths * 2);
  const years = employee.hire_date ? seniorityYears(employee.hire_date, end) : 0;
  const seniorityDays = Math.floor(years / 5) * 1.5;
  const total = monthlyDays + seniorityDays;
  return {
    months, minorMonths, monthlyDays, seniorityYears: years, seniorityDays,
    capped: total > LEAVE_CAP_DAYS, entitlement: r2(Math.min(total, LEAVE_CAP_DAYS)),
  };
}

// ── Balances ────────────────────────────────────────────────────────────────

export interface LeaveRequestLike {
  id: string;
  employee_id: string;
  type: string;
  status: string;
  start_date: string;
  end_date: string;
  days: number;
  pay_maintained?: boolean | null;
}

export interface OpeningBalance { employee_id: string; year: number; days: number }

export interface LeaveYear {
  year: number;
  entitlement: LeaveEntitlement;
  /** Carried from the previous year (or the opening balance typed for the year). */
  carry: number;
  /** True when `carry` is an opening balance typed by the user. */
  openingSet: boolean;
  /** Approved paid leave starting in the year. */
  taken: number;
  balance: number;
}

/** Approved paid leave of an employee starting in a year. */
export function paidLeaveTaken(requests: LeaveRequestLike[], employeeId: string, year: number): number {
  return r2(requests
    .filter(r => r.employee_id === employeeId && r.type === 'paye' && r.status === 'approved' && Number(r.start_date.slice(0, 4)) === year)
    .reduce((s, r) => s + (Number(r.days) || 0), 0));
}

/**
 * First year the leave module has data for: before it, balances are unknown
 * and nothing is carried (the user types an opening balance instead).
 */
export function firstLeaveYear(requests: LeaveRequestLike[], openings: OpeningBalance[], employeeId: string): number | null {
  const years = [
    ...requests.map(r => Number(r.start_date.slice(0, 4))),
    ...openings.filter(o => o.employee_id === employeeId).map(o => o.year),
  ].filter(Boolean);
  return years.length ? Math.min(...years) : null;
}

/**
 * Leave balance of an employee for a year at a date: entitlement + carry-over
 * − paid leave taken. The carry-over is the opening balance typed for the
 * year if any, else the previous year's balance at 31 December (from the
 * first year with data on).
 */
export function leaveYear(
  employee: { id: string; hire_date?: string | null; birth_date?: string | null },
  year: number, asOf: Date,
  data: { requests: LeaveRequestLike[]; openings: OpeningBalance[]; daysPerMonth?: number | ((year: number) => number) },
): LeaveYear {
  const perMonth = (y: number) => (typeof data.daysPerMonth === 'function' ? data.daysPerMonth(y) : data.daysPerMonth ?? 1.5);
  const first = firstLeaveYear(data.requests, data.openings, employee.id);
  const hireYear = employee.hire_date ? Number(employee.hire_date.slice(0, 4)) : -Infinity;
  const compute = (y: number, at: Date, depth: number): LeaveYear => {
    const entitlement = leaveEntitlement(employee, y, at, perMonth(y));
    const opening = data.openings.find(o => o.employee_id === employee.id && o.year === y);
    let carry = 0;
    if (opening) carry = Number(opening.days) || 0;
    else if (first != null && y - 1 >= first && y - 1 >= hireYear && depth < 50) carry = compute(y - 1, new Date(y - 1, 11, 31), depth + 1).balance;
    const taken = paidLeaveTaken(data.requests, employee.id, y);
    return { year: y, entitlement, carry: r2(carry), openingSet: !!opening, taken, balance: r2(entitlement.entitlement + carry - taken) };
  };
  return compute(year, asOf, 0);
}

// ── Unpaid days on the payslip ──────────────────────────────────────────────

/** Leave types that are not paid by the employer (sick leave unless maintained). */
export function isUnpaidLeave(r: Pick<LeaveRequestLike, 'type' | 'pay_maintained'>): boolean {
  if (r.type === 'sans_solde' || r.type === 'absence') return true;
  return r.type === 'maladie' && !r.pay_maintained;
}

/** Code of the payslip line made for a leave request (one line per request). */
export const leaveLineCode = (leaveId: string) => `CONGE:${leaveId}`;
export const isLeaveLine = (code: string | null | undefined) => !!code && code.startsWith('CONGE:');

const UNPAID_LABEL: Record<string, string> = {
  sans_solde: 'Absence sans solde',
  absence: 'Absence non justifiée',
  maladie: 'Maladie (non payée : indemnités CNSS)',
};

export interface AbsencePlan {
  /** One ABSENCE-type line per approved unpaid leave of the month. */
  lines: PayslipLine[];
  /** Working days not paid. */
  days: number;
  /** Days to declare to the CNSS: 26 minus the unpaid days. */
  cnssDays: number;
}

/**
 * Absence lines of an employee's month: each approved unpaid leave gives
 * days × base salary / 26 (days = its working days in the month), lowering
 * the gross and every base. Paid leave changes nothing.
 */
export function absencePlan(
  requests: LeaveRequestLike[], employeeId: string, month: number, year: number, baseSalary: number, rules: WorkingDayRules = {},
): AbsencePlan {
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const lines: PayslipLine[] = [];
  let days = 0;
  for (const r of requests) {
    if (r.employee_id !== employeeId || r.status !== 'approved' || !isUnpaidLeave(r)) continue;
    const n = workingDaysInMonth(r.start_date, r.end_date, month, year, rules);
    if (n <= 0) continue;
    days += n;
    const amount = r2(n * (Number(baseSalary) || 0) / FULL_MONTH_CNSS_DAYS);
    lines.push({
      ...blankLine('retenue'), code: leaveLineCode(r.id),
      label: `${UNPAID_LABEL[r.type] || 'Absence'} ${frDay(r.start_date).slice(0, 5)}–${frDay(r.end_date).slice(0, 5)} : ${n} j × ${fmt(baseSalary)} / 26`,
      amount, quantity: n, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: true,
    });
  }
  return { lines, days, cnssDays: Math.max(0, FULL_MONTH_CNSS_DAYS - days) };
}

/**
 * The lines of an open payslip after a leave change: leave lines no longer
 * backed by an approved unpaid leave go, new ones come in, and a line already
 * there keeps its amount (it may have been typed over).
 */
export function mergeAbsenceLines(current: PayslipLine[], plan: AbsencePlan): PayslipLine[] {
  const wanted = new Map(plan.lines.map(l => [l.code, l]));
  const kept = current.filter(l => !isLeaveLine(l.code) || wanted.has(l.code));
  const have = new Set(kept.map(l => l.code));
  return [...kept, ...plan.lines.filter(l => !have.has(l.code))];
}

/** Days the leave lines of a payslip stand for (CNSS days = 26 − these). */
export function leaveLineDays(lines: PayslipLine[]): number {
  return lines.filter(l => isLeaveLine(l.code)).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}
