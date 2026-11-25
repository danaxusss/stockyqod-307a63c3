// HR rules, hand-computed: severance scale and the 1,000,000 MAD ceiling,
// each motif, the reference salary, paid-leave entitlement, working days
// around holidays and weekends, absence lines and CNSS days, trainee payslips.
// Every expected figure is worked out in the comment above it; amounts are
// rounded to the centime at each step, like the payslip.
import { describe, expect, it } from 'vitest';
import { computePayslip, leaveWorkingDays, smigWarning, traineeIrEnd, type TraineeTerms } from '../utils/payrollCalc';
import { hrLimitsFor, officialSettingsFor } from '../utils/payrollDefaults';
import {
  allocateCeiling, computeStc, defaultNoticeMonths, exitMonthSalary, legalSeverance, referenceSalary, serviceLength, STC_MOTIFS,
  type RefPayslip, type StcInput,
} from '../utils/stcCalc';
import { absencePlan, fixedCivilHolidays, leaveEntitlement, leaveYear, mergeAbsenceLines, workingDaysInMonth } from '../utils/hrLeave';
import { traineeTermsFor } from '../utils/payslipCompute';
import { computeIrRegularisation } from '../utils/payrollRegularisation';
import { blankLine, loanLine } from '../utils/payslipLines';
import type { Employee } from '../types';

const s2026 = officialSettingsFor(2026);
const limits = hrLimitsFor(2026);

describe('official HR limits by year', () => {
  it('1,000,000 MAD for severance, 6,000 MAD over 12 months for trainees, in 2025 and 2026 (and inherited after)', () => {
    expect(hrLimitsFor(2025)).toEqual({ severance_ir_ceiling: 1000000, trainee_ir_ceiling: 6000, trainee_ir_months: 12, trainee_cnss_months: 24 });
    expect(hrLimitsFor(2026)).toEqual(hrLimitsFor(2025));
    // The 2027 bill (8,000) is not law: 2027 inherits 6,000.
    expect(hrLimitsFor(2027).trainee_ir_ceiling).toBe(6000);
  });
});

describe('seniority to the day', () => {
  it('counts whole years, then months, then days, the exit day included', () => {
    // 1 Sep 2019 → 30 Nov 2026 included = up to 1 Dec 2026: 87 months = 7 years 3 months, 0 days
    expect(serviceLength('2019-09-01', '2026-11-30')).toMatchObject({ years: 7, months: 3, days: 0, decimal: 7.25 });
    // 16 Nov 2022 → 30 Nov 2026: 48 months to 16 Nov 2026, then 16 Nov → 1 Dec = 15 days
    const l = serviceLength('2022-11-16', '2026-11-30');
    expect(l).toMatchObject({ years: 4, months: 0, days: 15 });
    expect(l.decimal).toBeCloseTo(4 + 15 / 365, 10);
  });
});

describe('severance scale (art. 53): reference 9,550 MAD → 9,550 / 191 = 50 MAD an hour', () => {
  const sev = (hire: string) => legalSeverance(9550, serviceLength(hire, '2026-11-30'));

  it('4 years: 4 × 96 = 384 h × 50 = 19,200.00', () => {
    expect(sev('2022-12-01')).toMatchObject({ due: true, hours: 384, amount: 19200 });
  });

  it('7 years 3 months: 5 × 96 + 2.25 × 144 = 480 + 324 = 804 h × 50 = 40,200.00', () => {
    const s = sev('2019-09-01');
    expect(s).toMatchObject({ due: true, hours: 804, amount: 40200 });
    expect(s.bands.map(b => [b.years, b.hoursPerYear])).toEqual([[5, 96], [2.25, 144]]);
  });

  it('16 years: 480 + 5 × 144 + 5 × 192 + 1 × 240 = 480 + 720 + 960 + 240 = 2,400 h × 50 = 120,000.00', () => {
    expect(sev('2010-12-01')).toMatchObject({ due: true, hours: 2400, amount: 120000 });
  });

  it('prorates days: 4 years 15 days = 96 × (4 + 15/365) = 387.945 h × 50 = 19,397.26', () => {
    expect(sev('2022-11-16').amount).toBe(19397.26);
  });

  it('needs 6 months of service: 5 months → not due; 6 months → 0.5 × 96 = 48 h × 50 = 2,400.00', () => {
    expect(sev('2026-07-01')).toMatchObject({ due: false, reason: 'moins de 6 mois de service', amount: 0 });
    expect(sev('2026-06-01')).toMatchObject({ due: true, hours: 48, amount: 2400 });
  });
});

describe('the 1,000,000 MAD IR exemption of severance-type indemnities (CGI art. 57-7°)', () => {
  it('splits one ceiling over the indemnities in order', () => {
    // 600,000 + 500,000 of damages: 600,000 exempt, then 400,000 of the damages; 100,000 taxed
    expect(allocateCeiling([600000, 0, 500000], 1000000)).toEqual([600000, 0, 400000]);
    expect(allocateCeiling([5760000, 0, 200000], 1000000)).toEqual([1000000, 0, 0]);
  });

  it('30 years at 191,000 MAD: 5,760,000 MAD severance, 1,000,000 exempt, 4,760,000 taxed as salary', () => {
    // hourly 191,000 / 191 = 1,000 ; hours 480 + 720 + 960 + 15 × 240 = 5,760 → 5,760,000
    const e = { hire_date: '1996-12-01', cimr_rate: 0, dependents_count: 0 };
    const r = computeStc({
      motif: 'licenciement', hire_date: e.hire_date, exit_date: '2026-11-30', reference: 191000, monthSalary: 191000,
      noticeMonths: 0, leaveDays: 0, loans: 0, employee: e, settings: s2026, limits,
    });
    expect(r.severance.amount).toBe(5760000);
    expect(r).toMatchObject({ exemptIr: 1000000, taxedExcess: 4760000 });
    // Seniority 30 years → 25 % × 191,000 = 47,750.
    // IR taxable gross = 191,000 + 47,750 + (5,760,000 − 1,000,000) = 4,998,750
    expect(r.payslip.brut_imposable).toBe(4998750);
    // CNSS base: the legal indemnity is left out → 191,000 + 47,750 = 238,750
    expect(r.payslip.cnss_base).toBe(238750);
  });
});

describe('what each motif gives', () => {
  const employee = { hire_date: '2019-09-01', cimr_rate: 0, dependents_count: 0 };
  const run = (motif: StcInput['motif'], extra: Partial<StcInput> = {}) => computeStc({
    motif, hire_date: employee.hire_date, exit_date: '2026-11-30', reference: 9550, monthSalary: 8500,
    noticeMonths: 2, leaveDays: 12, loans: 0, employee, settings: s2026, limits, ...extra,
  });
  const el = (r: ReturnType<typeof run>, code: string) => r.elements.find(e => e.code === code)!;

  it('dismissal: severance, notice (1 month under 5 years, 2 from 5), leave pay', () => {
    const length = serviceLength('2019-09-01', '2026-11-30');
    expect(defaultNoticeMonths('licenciement', length)).toBe(2);
    expect(defaultNoticeMonths('licenciement', serviceLength('2022-12-01', '2026-11-30'))).toBe(1);
    const r = run('licenciement');
    expect(el(r, 'STC_LICENCIEMENT')).toMatchObject({ due: true, amount: 40200 });
    // 2 × 9,550 = 19,100 ; 12 × 9,550 / 26 = 4,407.69
    expect(el(r, 'STC_PREAVIS')).toMatchObject({ due: true, amount: 19100 });
    expect(el(r, 'STC_CONGES')).toMatchObject({ due: true, amount: 4407.69 });
  });

  it('serious misconduct: no severance, no notice ("non due : faute grave"), leave still paid', () => {
    const r = run('faute_grave');
    expect(el(r, 'STC_LICENCIEMENT')).toMatchObject({ due: false, amount: 0, detail: 'non due : faute grave' });
    expect(el(r, 'STC_PREAVIS')).toMatchObject({ due: false, amount: 0, detail: 'non due : faute grave' });
    expect(el(r, 'STC_CONGES').amount).toBe(4407.69);
    expect(defaultNoticeMonths('faute_grave', serviceLength('2019-09-01', '2026-11-30'))).toBe(0);
  });

  it('resignation: no severance, notice owed by the employee and not paid', () => {
    const r = run('demission');
    expect(el(r, 'STC_LICENCIEMENT').detail).toBe('non due : démission');
    expect(el(r, 'STC_PREAVIS')).toMatchObject({ amount: 0, detail: 'non due : dû par le salarié, non payé' });
  });

  it('end of fixed-term contract, retirement, death: no legal severance', () => {
    expect(el(run('fin_cdd'), 'STC_LICENCIEMENT').detail).toBe('non due : fin de CDD');
    expect(el(run('fin_cdd'), 'STC_PREAVIS').amount).toBe(0);
    expect(el(run('deces'), 'STC_LICENCIEMENT').detail).toBe('non due : décès');
    // Retirement: a conventional indemnity is taxable (not in art. 57-7°).
    const ret = run('retraite', { retirement: 10000, noticeMonths: 0 });
    expect(el(ret, 'STC_RETRAITE')).toMatchObject({ amount: 10000, ir: 'imposable (hors art. 57-7°)' });
    expect(ret.exemptIr).toBe(0);
  });

  it('negotiated departure: the agreed amount, exempt within the ceiling; CNSS exempt up to the legal amount', () => {
    const r = run('depart_negocie', { negotiated: 50000, noticeMonths: 0 });
    expect(el(r, 'STC_NEGOCIE')).toMatchObject({ due: true, amount: 50000 });
    expect(r.exemptIr).toBe(50000);
    const line = r.lines.find(l => l.code === 'STC_NEGOCIE')!;
    // CNSS ceiling = legal severance 40,200: 9,800 joins the CNSS base.
    expect(line.cnss_ceiling).toEqual({ type: 'amount', value: 40200 });
    // CNSS base: 8,500 + seniority 850 + leave 4,407.69 + 9,800 = 23,557.69
    expect(r.payslip.cnss_base).toBe(23557.69);
  });

  it('every motif is listed with its rules', () => {
    expect(Object.keys(STC_MOTIFS)).toEqual(['licenciement', 'faute_grave', 'demission', 'fin_cdd', 'depart_negocie', 'retraite', 'deces']);
  });
});

describe('reference salary', () => {
  const slip = (month: number, year: number, extra: Partial<RefPayslip> = {}): RefPayslip => ({
    id: `${year}-${month}`, period_month: month, period_year: year, base_salary: 8500, anciennete_amount: 850,
    lines: [
      { type: 'gain', amount: 200, soumis_cnss: true, soumis_ir: true },
      // Commuting allowance: an exempt reimbursement, left out.
      { type: 'gain', amount: 300, soumis_cnss: false, soumis_ir: false },
    ],
    ...extra,
  });

  it('averages the last 12 validated months: base + seniority + subject gains − absences', () => {
    // 13 months Oct 2025 – Nov 2026 (no December 2025): October is dropped. 11 months at
    // 9,550 and March with a 1,100 absence (8,450): (11 × 9,550 + 8,450) / 12 = 113,500 / 12 = 9,458.33
    const months = [slip(10, 2025), slip(11, 2025)];
    for (let m = 1; m <= 11; m++) months.push(slip(m, 2026, m === 3 ? { lines: [...slip(m, 2026).lines, { type: 'retenue', amount: 1100, soumis_cnss: true, soumis_ir: true }] } : {}));
    months.push(slip(12, 2026)); // after the exit month: ignored
    const r = referenceSalary(months, '2026-11-30', 3422.72, 0);
    expect(r.months).toHaveLength(12);
    expect(r.months[0]).toMatchObject({ month: 11, year: 2025, total: 9550 });
    expect(r.months.find(m => m.month === 3)).toMatchObject({ base: 8500, seniority: 850, gains: 200, absences: 1100, total: 8450 });
    expect(r).toMatchObject({ average: 9458.33, value: 9458.33, source: 'payslips', floored: false });
  });

  it('never below SMIG × 191 for the exit year; without payslips, the current salary', () => {
    // 2026: 17.92 × 191 = 3,422.72
    const low = referenceSalary([slip(10, 2026, { base_salary: 3000, anciennete_amount: 0, lines: [] })], '2026-11-30', 3422.72, 0);
    expect(low).toMatchObject({ average: 3000, value: 3422.72, floored: true });
    expect(referenceSalary([], '2026-11-30', 3422.72, 9350)).toMatchObject({ value: 9350, source: 'fallback' });
  });
});

describe('the exit month salary', () => {
  it('full month when the contract runs to the last day; else base / 26 per working day (Sundays off)', () => {
    expect(exitMonthSalary(9100, '2019-01-01', '2026-11-30')).toEqual({ amount: 9100, days: 25, full: true });
    // 1–14 Nov 2026: 14 days minus Sundays 1 and 8 = 12 → 12 × 9,100 / 26 = 4,200.00
    expect(exitMonthSalary(9100, '2019-01-01', '2026-11-14')).toEqual({ amount: 4200, days: 12, full: false });
  });
});

describe('a full final settlement (licenciement), hand-computed', () => {
  it('7 years 3 months, reference 9,550, 2 months notice, 12 days leave, 1,000 MAD loan', () => {
    // Severance 40,200 (exempt) ; notice 19,100 ; leave 4,407.69 ; November salary 8,500 + seniority 10 % = 850
    // Gross 8,500 + 850 + 19,100 + 4,407.69 + 40,200 = 73,057.69
    // IR taxable 8,500 + 850 + 19,100 + 4,407.69 = 32,857.69 ; CNSS 6,000 × 4.48 % = 268.80 ; AMO 32,857.69 × 2.26 % = 742.58
    // Frais pro 25 % capped at 35,000 / 12 = 2,916.67 ; net taxable 32,857.69 − 2,916.67 − 268.80 − 742.58 = 28,929.64
    // IR: 28,929.64 × 12 = 347,155.68 × 37 % − 27,400 = 101,047.60 ; − 2 × 600 = 99,847.60 ; / 12 = 8,320.63
    // Net 73,057.69 − 268.80 − 742.58 − 8,320.63 − 1,000 = 62,725.68
    const employee = { hire_date: '2019-09-01', cimr_rate: 0, dependents_count: 2 };
    const r = computeStc({
      motif: 'licenciement', hire_date: employee.hire_date, exit_date: '2026-11-30', reference: 9550, monthSalary: 8500,
      noticeMonths: 2, leaveDays: 12, loans: 1000, employee, settings: s2026, limits,
    });
    expect(r.payslip).toMatchObject({
      anciennete_amount: 850, brut_global: 73057.69, brut_imposable: 32857.69, cnss_employee: 268.8, amo_employee: 742.58,
      frais_pro: 2916.67, net_imposable: 28929.64, ir_amount: 8320.63, autres_retenues: 1000, net_salary: 62725.68,
    });
    expect(r.netToPay).toBe(62725.68);
    expect(r.exemptIr).toBe(40200);
    // The loan line is after tax; 1,000 is under a third of the net.
    expect(r.lines.map(l => l.code)).toEqual(['STC_LICENCIEMENT', 'STC_PREAVIS', 'STC_CONGES', 'AVANCE']);
    expect(r.loanCheck).toEqual({ error: null, warning: null });
  });

  it('flags a loan settlement above a third of the net and keeps lines of the month payslip', () => {
    const employee = { hire_date: '2024-01-01', cimr_rate: 0, dependents_count: 0 };
    const r = computeStc({
      motif: 'demission', hire_date: employee.hire_date, exit_date: '2026-11-30', reference: 5000, monthSalary: 5000,
      noticeMonths: 0, leaveDays: 0, loans: 3000, employee, settings: s2026, limits,
      otherLines: [{ ...blankLine('gain'), code: 'PRIME', label: 'Prime', amount: 100 }, loanLine(200)],
    });
    // The month's own instalment line (200) is replaced by the settlement (3,000).
    expect(r.payslip.autres_retenues).toBe(3000);
    expect(r.payslip.other_earnings).toBe(100);
    expect(r.loanCheck.warning).toMatch(/tiers du net/);
  });
});

describe('paid leave entitlement (art. 231–232)', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  it('1.5 days a month + 1.5 per full 5 years: 7 years → 12 × 1.5 + 1.5 = 19.5', () => {
    expect(leaveEntitlement({ hire_date: '2019-07-01' }, 2026, at(2026, 12, 31))).toMatchObject({ months: 12, monthlyDays: 18, seniorityYears: 7, seniorityDays: 1.5, entitlement: 19.5 });
  });

  it('counts whole months from the hire day: hired 15 March → 9 months by 31 December = 13.5', () => {
    expect(leaveEntitlement({ hire_date: '2026-03-15' }, 2026, at(2026, 12, 31))).toMatchObject({ months: 9, entitlement: 13.5 });
  });

  it('2 days a month while under 18: 18 on 15 July 2026 → 6 × 2 + 6 × 1.5 = 21', () => {
    expect(leaveEntitlement({ hire_date: '2025-01-01', birth_date: '2008-07-15' }, 2026, at(2026, 12, 31))).toMatchObject({ months: 12, minorMonths: 6, entitlement: 21 });
  });

  it('caps the total at 30 working days: 46 years → 18 + 9 × 1.5 = 31.5 → 30', () => {
    expect(leaveEntitlement({ hire_date: '1980-01-01' }, 2026, at(2026, 12, 31))).toMatchObject({ seniorityDays: 13.5, capped: true, entitlement: 30 });
  });

  it('balance = entitlement + carry-over − paid leave taken', () => {
    const e = { id: 'e1', hire_date: '2019-07-01' };
    const requests = [{ id: 'r1', employee_id: 'e1', type: 'paye', status: 'approved', start_date: '2026-08-03', end_date: '2026-08-07', days: 5 }];
    // 19.5 + opening 4 − 5 = 18.5
    expect(leaveYear(e, 2026, at(2026, 12, 31), { requests, openings: [{ employee_id: 'e1', year: 2026, days: 4 }] }))
      .toMatchObject({ carry: 4, openingSet: true, taken: 5, balance: 18.5 });
    // A pending or sick leave takes nothing.
    expect(leaveYear(e, 2026, at(2026, 12, 31), { requests: [...requests, { ...requests[0], id: 'r2', status: 'pending' }, { ...requests[0], id: 'r3', type: 'maladie' }], openings: [] }).taken).toBe(5);
  });

  it('carries the previous year from the first year with data, never before', () => {
    const e = { id: 'e2', hire_date: '2024-01-01' };
    const requests = [{ id: 'r1', employee_id: 'e2', type: 'paye', status: 'approved', start_date: '2025-07-01', end_date: '2025-07-12', days: 10 }];
    // 2025: 18 − 10 = 8 (2024 is before the first year: no carry) ; 2026: 18 + 8 = 26
    expect(leaveYear(e, 2025, at(2025, 12, 31), { requests, openings: [] })).toMatchObject({ carry: 0, balance: 8 });
    expect(leaveYear(e, 2026, at(2026, 12, 31), { requests, openings: [] })).toMatchObject({ carry: 8, balance: 26 });
  });
});

describe('working days around a holiday and a weekend', () => {
  // November 2026: Sunday 1, Friday 6 (Marche Verte), Sunday 8, Wednesday 18 (Indépendance).
  const holidays = fixedCivilHolidays(2026).map(h => h.date);

  it('lists the civil holidays, Yennayer and Aïd Al Wahda from 2026', () => {
    expect(holidays).toEqual(['2026-01-01', '2026-01-11', '2026-01-14', '2026-05-01', '2026-07-30', '2026-08-14', '2026-08-20', '2026-08-21', '2026-10-31', '2026-11-06', '2026-11-18']);
    expect(fixedCivilHolidays(2025).map(h => h.date)).not.toContain('2025-10-31');
  });

  it('Thu 5 → Mon 9 Nov: Thu, Sat, Mon = 3 days (Fri holiday, Sun rest); 4 without the holiday', () => {
    expect(leaveWorkingDays('2026-11-05', '2026-11-09', { holidays })).toBe(3);
    expect(leaveWorkingDays('2026-11-05', '2026-11-09')).toBe(4);
    // Friday as the rest day: Thu, Sat, Sun, Mon = 4 (the holiday falls on the rest day).
    expect(leaveWorkingDays('2026-11-05', '2026-11-09', { restDay: 5, holidays })).toBe(4);
  });

  it('splits a leave across months: 29 Oct → 3 Nov = Thu 29, Fri 30 (Sat 31 Aïd Al Wahda) | Mon 2, Tue 3', () => {
    expect(workingDaysInMonth('2026-10-29', '2026-11-03', 10, 2026, { holidays })).toBe(2);
    expect(workingDaysInMonth('2026-10-29', '2026-11-03', 11, 2026, { holidays })).toBe(2);
  });
});

describe('absence lines and CNSS days', () => {
  const leave = (extra: Record<string, unknown>) => ({ id: 'l1', employee_id: 'e1', type: 'sans_solde', status: 'approved', start_date: '2026-11-02', end_date: '2026-11-04', days: 3, ...extra });

  it('unpaid leave Mon 2 → Wed 4 Nov: 3 × 9,100 / 26 = 1,050.00, 26 − 3 = 23 CNSS days', () => {
    const plan = absencePlan([leave({})], 'e1', 11, 2026, 9100);
    expect(plan).toMatchObject({ days: 3, cnssDays: 23 });
    expect(plan.lines[0]).toMatchObject({ code: 'CONGE:l1', amount: 1050, quantity: 3, soumis_cnss: true, soumis_ir: true, soumis_cimr: true, type: 'retenue' });
    expect(plan.lines[0].label.replace(/\s/g, ' ')).toBe('Absence sans solde 02/11–04/11 : 3 j × 9 100,00 / 26');
    // On the payslip: gross 9,100 − 1,050 = 8,050 ; CNSS 268.80 ; AMO 8,050 × 2.26 % = 181.93
    // Frais pro 25 % = 2,012.50 ; net taxable 8,050 − 2,012.50 − 268.80 − 181.93 = 5,586.77
    // IR (67,041.24 × 20 % − 10,000) / 12 = 284.02 ; net 8,050 − 268.80 − 181.93 − 284.02 = 7,315.25
    const r = computePayslip({ base_salary: 9100, lines: plan.lines, period_month: 11, period_year: 2026, settings: s2026 });
    expect(r).toMatchObject({ brut_global: 8050, cnss_base: 8050, amo_employee: 181.93, net_imposable: 5586.77, ir_amount: 284.02, net_salary: 7315.25 });
  });

  it('paid leave changes nothing; sick leave is unpaid unless maintained; pending or rejected leave is ignored', () => {
    expect(absencePlan([leave({ type: 'paye' })], 'e1', 11, 2026, 9100).lines).toHaveLength(0);
    expect(absencePlan([leave({ type: 'maladie' })], 'e1', 11, 2026, 9100).days).toBe(3);
    expect(absencePlan([leave({ type: 'maladie', pay_maintained: true })], 'e1', 11, 2026, 9100).days).toBe(0);
    expect(absencePlan([leave({ status: 'pending' }), leave({ id: 'l2', status: 'rejected' })], 'e1', 11, 2026, 9100).days).toBe(0);
    // An unjustified absence on the 6 Nov holiday counts 0 days.
    expect(absencePlan([leave({ type: 'absence', start_date: '2026-11-06', end_date: '2026-11-06' })], 'e1', 11, 2026, 9100, { holidays: ['2026-11-06'] }).days).toBe(0);
  });

  it('keeps an amount typed over, adds new leave lines, drops lines of leave no longer approved', () => {
    const plan = absencePlan([leave({}), leave({ id: 'l2', start_date: '2026-11-10', end_date: '2026-11-10' })], 'e1', 11, 2026, 9100);
    const typed = { ...plan.lines[0], amount: 1000 };
    const stale = { ...plan.lines[0], code: 'CONGE:old' };
    const merged = mergeAbsenceLines([typed, stale, loanLine(300)], plan);
    expect(merged.map(l => [l.code, l.amount])).toEqual([['CONGE:l1', 1000], ['AVANCE', 300], ['CONGE:l2', 350]]);
  });
});

describe('trainee payslips (CGI art. 57-16°), internship from 1 March 2026', () => {
  const trainee: TraineeTerms = { start_date: '2026-03-01', ir_ceiling: 6000, ir_months: 12, cnss_exempt: true, cnss_months: 24 };
  const pay = (base: number, month: number, year: number, t: TraineeTerms = trainee) =>
    computePayslip({ base_salary: base, period_month: month, period_year: year, settings: officialSettingsFor(year), trainee: t });

  it('the IR exemption covers 12 payslips, March 2026 to February 2027', () => {
    expect(traineeIrEnd(trainee)).toBe('2027-02-28');
  });

  it('under the ceiling, 4,000 MAD: no IR, no CNSS; AMO 4,000 × 2.26 % = 90.40, net 3,909.60', () => {
    const r = pay(4000, 11, 2026);
    expect(r).toMatchObject({ brut_imposable: 0, net_imposable: 0, ir_amount: 0, cnss_employee: 0, amo_employee: 90.4, net_salary: 3909.6 });
    // Employer: AMO 4,000 × 4.11 % = 164.40 ; no CNSS, family allowances or training tax.
    expect(r).toMatchObject({ cnss_employer: 0, alloc_familiales: 0, tfp_employer: 0, amo_employer: 164.4 });
    expect(r.trainee).toMatchObject({ ir: 'exempt', cnss_exempt: true });
    expect(r.trainee!.note).toMatch(/exonérée d'IR jusqu'à 6\s000,00 MAD par mois, jusqu'au 28\/02\/2027/);
  });

  it('at the ceiling, 6,000 MAD: still exempt; AMO 135.60, net 5,864.40', () => {
    expect(pay(6000, 11, 2026)).toMatchObject({ ir_amount: 0, amo_employee: 135.6, net_salary: 5864.4 });
  });

  it('over the ceiling, 6,500 MAD: the exemption is lost on the whole allowance', () => {
    // CNSS still exempt (setting) ; AMO 146.90 ; 78,000 a year ≤ 78,000 → frais pro 35 % = 2,275
    // Net taxable 6,500 − 2,275 − 146.90 = 4,078.10 → 48,937.20 ; IR (4,893.72 − 4,000) / 12 = 74.48
    // Net 6,500 − 146.90 − 74.48 = 6,278.62
    const r = pay(6500, 11, 2026);
    expect(r).toMatchObject({ brut_imposable: 6500, net_imposable: 4078.1, ir_amount: 74.48, cnss_employee: 0, net_salary: 6278.62 });
    expect(r.trainee!.ir).toBe('over_ceiling');
    expect(r.trainee!.note).toMatch(/au-dessus du plafond/);
    // With the CNSS setting off it is an ordinary 6,500 payslip: IR 47.60 (see payrollEngine2026).
    expect(pay(6500, 11, 2026, { ...trainee, cnss_exempt: false })).toMatchObject({ cnss_employee: 268.8, ir_amount: 47.6 });
  });

  it('after 12 months, 6,000 MAD in March 2027: normal IR; February 2027 still exempt', () => {
    // CNSS exempt (24 months) ; AMO 135.60 ; frais 35 % = 2,100 ; net taxable 6,000 − 2,100 − 135.60 = 3,764.40
    // 45,172.80 a year → (4,517.28 − 4,000) / 12 = 43.11 ; net 6,000 − 135.60 − 43.11 = 5,821.29
    const march = pay(6000, 3, 2027);
    expect(march).toMatchObject({ net_imposable: 3764.4, ir_amount: 43.11, net_salary: 5821.29 });
    expect(march.trainee).toMatchObject({ ir: 'expired', cnss_exempt: true });
    expect(pay(6000, 2, 2027).trainee!.ir).toBe('exempt');
    // CNSS back after 24 months (March 2028); before the start, nothing applies.
    expect(pay(6000, 3, 2028).trainee!.cnss_exempt).toBe(false);
    expect(pay(6000, 2, 2026).trainee).toMatchObject({ ir: 'not_started', cnss_exempt: false });
  });

  it('comes from the employee: contract "Stage", its start date (else the hire date), CNSS on by default', () => {
    const e: Partial<Employee> = { contract_type: 'Stage', hire_date: '2026-03-01', cimr_rate: 0, dependents_count: 0 };
    expect(traineeTermsFor(e as Employee, 2026)).toEqual(trainee);
    expect(traineeTermsFor({ ...e, stage_start_date: '2026-05-01', stage_cnss_exempt: false } as Employee, 2026)).toMatchObject({ start_date: '2026-05-01', cnss_exempt: false });
    expect(traineeTermsFor({ ...e, contract_type: 'CDI' } as Employee, 2026)).toBeNull();
  });

  it('is left out of the SMIG warning and of a false IR shortfall at regularisation', () => {
    expect(smigWarning(2000, s2026, 191, 'Stage')).toBeNull();
    expect(smigWarning(2000, s2026, 191, 'CDI')).toMatch(/SMIG/);
    // A validated exempt month (IR 0 on 6,000) recomputes to 0: nothing owed.
    const months = [{ id: 'm', period_month: 4, period_year: 2026, is_locked: true, ir_amount: 0, base_salary: 6000, lines: [] }];
    expect(computeIrRegularisation('open', months, { contract_type: 'Stage', hire_date: '2026-03-01' }, s2026, 2026).owed).toBe(0);
  });
});
