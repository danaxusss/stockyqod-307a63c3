// CSV exports of the grand livre and the journals. Same conventions as the
// balance export (";" separator, UTF-8 BOM), with comma decimals for Excel
// as set up in Morocco. Each file opens with lines naming the company, the
// report, the fiscal year and period, the date produced and the software:
// CNC avis n° 24 §2.7 asks every report to identify them.

export interface ReportContext {
  company: string;
  report: string;
  fiscalYear: { label: string; start_date: string; end_date: string };
  /** Period covered when narrower than the fiscal year. */
  period?: { from: string; to: string };
  producedAt: Date;
}

export interface LedgerLine {
  account_code: string;
  label?: string | null;
  entry_label?: string | null;
  entry_date: string;
  entry_number?: number | null;
  journal_id?: string;
  reference?: string | null;
  debit: number | string;
  credit: number | string;
  lettrage_code?: string | null;
  sort_order?: number | null;
}

export const SOFTWARE_NAME = 'Stocky';

const frDay = (d: string) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const amount = (v: unknown) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',');

function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Text Excel would run as a formula (CSV injection). Amounts are written by amount(), not here.
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(,\d+)?$/.test(s))) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

function pad(d: number) { return String(d).padStart(2, '0'); }

export function reportHeader(ctx: ReportContext): string[][] {
  const at = ctx.producedAt;
  const fy = ctx.fiscalYear;
  const rows: string[][] = [
    ['Société', ctx.company],
    ['État', ctx.report],
    ['Exercice', `${fy.label} (du ${frDay(fy.start_date)} au ${frDay(fy.end_date)})`],
    ['Période', ctx.period ? `du ${frDay(ctx.period.from)} au ${frDay(ctx.period.to)}` : `du ${frDay(fy.start_date)} au ${frDay(fy.end_date)}`],
    ['Édité le', `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`],
    ['Logiciel', SOFTWARE_NAME],
    ['Écritures', 'validées uniquement (brouillons exclus)'],
  ];
  return [...rows, []];
}

const byDate = (a: LedgerLine, b: LedgerLine) =>
  a.entry_date.localeCompare(b.entry_date) || (a.entry_number ?? 0) - (b.entry_number ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0);

/**
 * Grand livre of the given accounts (one or all): for each account its lines
 * by date with a running balance, then the account totals.
 */
export function grandLivreRows(lines: LedgerLine[], codes: string[], labelOf: (code: string) => string, journalCode: (id?: string) => string): unknown[][] {
  const out: unknown[][] = [['Compte', 'Libellé du compte', 'Date', 'Journal', 'N° écriture', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde', 'Lettrage']];
  let gd = 0, gc = 0;
  for (const code of codes) {
    const list = lines.filter(l => l.account_code === code).sort(byDate);
    if (list.length === 0) continue;
    let solde = 0, d = 0, c = 0;
    for (const l of list) {
      const ld = Number(l.debit) || 0, lc = Number(l.credit) || 0;
      d += ld; c += lc; solde += ld - lc;
      out.push([code, labelOf(code), frDay(l.entry_date), journalCode(l.journal_id), l.entry_number ?? '', l.reference || '', l.label || l.entry_label || '', amount(ld), amount(lc), amount(solde), l.lettrage_code || '']);
    }
    out.push([code, `Total ${code}`, '', '', '', '', '', amount(d), amount(c), amount(d - c), '']);
    gd += d; gc += c;
  }
  if (codes.length > 1) out.push(['', 'Total général', '', '', '', '', '', amount(gd), amount(gc), amount(gd - gc), '']);
  return out;
}

/** Journal: entries in number order, their lines, totals. */
export function journalRows(lines: LedgerLine[], labelOf: (code: string) => string): unknown[][] {
  const out: unknown[][] = [['N° écriture', 'Date', 'Pièce', 'Compte', 'Libellé du compte', 'Libellé', 'Débit', 'Crédit']];
  const sorted = [...lines].sort((a, b) => (a.entry_number ?? 0) - (b.entry_number ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let d = 0, c = 0;
  for (const l of sorted) {
    const ld = Number(l.debit) || 0, lc = Number(l.credit) || 0;
    d += ld; c += lc;
    out.push([l.entry_number ?? '', frDay(l.entry_date), l.reference || '', l.account_code, labelOf(l.account_code), l.label || l.entry_label || '', amount(ld), amount(lc)]);
  }
  out.push(['', '', '', '', '', 'Totaux', amount(d), amount(c)]);
  return out;
}

/** Browser download of a text file. */
export function downloadText(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
