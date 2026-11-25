// Fiscal-year rules and the closing (à-nouveaux) lines. Pure functions.

import type { FiscalYear, JournalEntryLine } from '../types';

/** CNC avis n° 24 §2.3-d: no more than two periods open at once (the current one and the previous one). */
export const MAX_OPEN_YEARS = 2;

const frDay = (day: string) => day.split('-').reverse().join('/');
const overlaps = (y: Pick<FiscalYear, 'start_date' | 'end_date'>, start: string, end: string) => y.start_date <= end && start <= y.end_date;

/** Same day one year later (29 February → 28 February). */
function oneYearAfter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// One shape rather than a union: the app compiles without strictNullChecks,
// where a union on `ok` does not narrow.
export interface NewYearDecision { ok: boolean; message: string; label: string; start_date: string; end_date: string }

/**
 * Whether the calendar year of `day` may be opened, when no fiscal year
 * covers that date. It may when, once opened, at most two years are open,
 * the date is no more than one year ahead of today (a mistyped 2062 is
 * refused) and no closed year comes after it.
 */
const refuse = (message: string): NewYearDecision => ({ ok: false, message, label: '', start_date: '', end_date: '' });

export function decideNewFiscalYear(years: FiscalYear[], day: string, today: string): NewYearDecision {
  const y = Number(day.slice(0, 4));
  const start = `${y}-01-01`, end = `${y}-12-31`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !y) return refuse(`Date hors exercice : « ${day} » n'est pas une date valide.`);
  if (years.some(x => overlaps(x, start, end))) {
    return refuse(`Aucun exercice ne couvre le ${frDay(day)} : créez-le avant de comptabiliser.`);
  }
  if (day > oneYearAfter(today)) {
    return refuse(`Date hors exercice : le ${frDay(day)} est à plus d'un an d'aujourd'hui. Vérifiez l'année saisie.`);
  }
  const laterClosed = years.find(x => x.status === 'closed' && x.start_date > end);
  if (laterClosed) {
    return refuse(`Date hors exercice : l'exercice ${laterClosed.label} est déjà clôturé, l'exercice ${y} ne peut plus être ouvert.`);
  }
  const open = years.filter(x => x.status === 'open').sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (open.length >= MAX_OPEN_YEARS) {
    return refuse(`Clôturez l'exercice ${open[0].label} avant d'ouvrir l'exercice ${y} : deux exercices au plus peuvent être ouverts.`);
  }
  return { ok: true, message: '', label: String(y), start_date: start, end_date: end };
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Accounts the year's result is carried to: a profit to 1191 (credit), a loss to 1199 (debit). */
export const RESULT_PROFIT_ACCOUNT = '1191';
export const RESULT_LOSS_ACCOUNT = '1199';

/**
 * Opening entry of the next year: every class 1–5 balance carried forward,
 * and the result of the year (what balances them) on 1191 when it is a
 * profit, on 1199 when it is a loss.
 */
export function buildOpeningLines(balances: Map<string, number>): JournalEntryLine[] {
  const lines: JournalEntryLine[] = [];
  Array.from(balances.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, b]) => {
    const c = Number(String(code)[0]);
    if (c >= 1 && c <= 5 && Math.abs(b) > 0.005) lines.push({ account_code: code, label: 'À-nouveau', debit: b > 0 ? r2(b) : 0, credit: b < 0 ? r2(-b) : 0 });
  });
  const D = r2(lines.reduce((s, l) => s + l.debit, 0));
  const C = r2(lines.reduce((s, l) => s + l.credit, 0));
  const diff = r2(D - C);
  if (diff > 0.005) lines.push({ account_code: RESULT_PROFIT_ACCOUNT, label: 'Résultat de l\'exercice (bénéfice)', debit: 0, credit: diff });
  else if (diff < -0.005) lines.push({ account_code: RESULT_LOSS_ACCOUNT, label: 'Résultat de l\'exercice (perte)', debit: -diff, credit: 0 });
  return lines;
}

/** Balance (debit − credit) per account. */
export function balancesOf(lines: { account_code: string; debit: number | string; credit: number | string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.account_code, (m.get(l.account_code) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
  return m;
}
