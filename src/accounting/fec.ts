// Fichier des écritures comptables (FEC).
//
// CGI art. 145-I (LF 2026): the books are kept in electronic form; art. 210:
// a copy of the FEC is handed over at a tax audit. CNC avis n° 24 (annex §3)
// lists the minimum fields, reproduced in FEC_COLUMNS in that order.
// Everything here is pure so the file and its controls can be tested.

export const FEC_COLUMNS = [
  'Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture',
  'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux', 'Libelle_Compte_Aux',
  'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit',
  'Lettrage_Ecriture', 'Date_Lettrage', 'Date_Validation', 'Montant_Devise', 'Id_Devise',
] as const;

export type FecRow = Record<(typeof FEC_COLUMNS)[number], string>;

export interface FecEntry {
  id: string;
  journal_id: string;
  entry_number: number | null;
  entry_date: string;
  reference: string | null;
  label: string | null;
  status: string;
  posted_at: string | null;
}

export interface FecLine {
  entry_id: string;
  account_code: string;
  aux_account_id?: string | null;
  label?: string | null;
  debit: number | string;
  credit: number | string;
  lettrage_code?: string | null;
  lettered_at?: string | null;
  sort_order?: number | null;
}

export interface FecInput {
  entries: FecEntry[];
  lines: FecLine[];
  journals: { id: string; code: string; label: string }[];
  accounts: { id?: string; code: string; label: string }[];
}

const cents = (v: unknown) => Math.round((Number(v) || 0) * 100);

/** YYYYMMDD from an ISO date or timestamp; empty when there is none. */
export function fecDate(v: string | null | undefined): string {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/** Comma decimal, two places, no thousands separator: 1234,50. */
export function fecAmount(v: unknown): string {
  const c = cents(v);
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

// A tab or line break inside a text field would shift every following column.
const text = (v: unknown) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());

/** Entry number as written in the file: journal code and number, unique across the file. */
export const fecEntryNumber = (journalCode: string, n: number | null) => (n == null ? '' : `${journalCode}-${String(n).padStart(6, '0')}`);

/**
 * One row per line of every posted or reversed entry (drafts are not part of
 * the books), ordered by journal code, entry number, then line order.
 */
export function buildFecRows(input: FecInput): FecRow[] {
  const journals = new Map(input.journals.map(j => [j.id, j]));
  const accByCode = new Map(input.accounts.map(a => [a.code, a]));
  const accById = new Map(input.accounts.filter(a => a.id).map(a => [a.id as string, a]));
  const entries = input.entries
    .filter(e => e.status === 'posted' || e.status === 'reversed')
    .map(e => ({ e, j: journals.get(e.journal_id) }))
    .sort((a, b) => (a.j?.code || '').localeCompare(b.j?.code || '') || (a.e.entry_number ?? 0) - (b.e.entry_number ?? 0) || a.e.entry_date.localeCompare(b.e.entry_date));
  const linesByEntry = new Map<string, FecLine[]>();
  for (const l of input.lines) {
    const list = linesByEntry.get(l.entry_id) || [];
    list.push(l);
    linesByEntry.set(l.entry_id, list);
  }
  const rows: FecRow[] = [];
  for (const { e, j } of entries) {
    const lines = (linesByEntry.get(e.id) || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    for (const l of lines) {
      const aux = l.aux_account_id ? accById.get(l.aux_account_id) : undefined;
      rows.push({
        Code_Journal: text(j?.code),
        Libelle_Journal: text(j?.label),
        Num_Ecriture: fecEntryNumber(text(j?.code), e.entry_number),
        Date_Ecriture: fecDate(e.entry_date),
        Num_Compte: text(l.account_code),
        Libelle_Compte: text(accByCode.get(l.account_code)?.label),
        Num_Compte_Aux: text(aux?.code),
        Libelle_Compte_Aux: text(aux?.label),
        Ref_Piece: text(e.reference),
        // The app records one date per entry: the document date it was booked at.
        Date_Piece: fecDate(e.entry_date),
        Libelle_Ecriture: text(l.label || e.label),
        Montant_Debit: fecAmount(l.debit),
        Montant_Credit: fecAmount(l.credit),
        Lettrage_Ecriture: text(l.lettrage_code),
        Date_Lettrage: l.lettrage_code ? fecDate(l.lettered_at) : '',
        Date_Validation: fecDate(e.posted_at),
        // Amounts are kept in MAD only: blank, as avis 24 asks when unused.
        Montant_Devise: '',
        Id_Devise: '',
      });
    }
  }
  return rows;
}

/** The file: UTF-8 text, a header row, tab-separated, CRLF line ends. */
export function fecText(rows: FecRow[]): string {
  return [FEC_COLUMNS.join('\t'), ...rows.map(r => FEC_COLUMNS.map(c => r[c]).join('\t'))].join('\r\n') + '\r\n';
}

/** FEC_<IF or ICE>_<YYYYMMDD of the year end>.txt */
export function fecFileName(company: { if_number?: string | null; ice?: string | null } | null, yearEnd: string): string {
  const id = String(company?.if_number || company?.ice || '').replace(/[^0-9A-Za-z]/g, '') || 'SANS-IF';
  return `FEC_${id}_${fecDate(yearEnd)}.txt`;
}

export interface FecCheck {
  totalDebit: number;
  totalCredit: number;
  lineCount: number;
  entryCount: number;
  /** Blocking anomalies: the file would not reflect balanced, complete books. */
  errors: string[];
  /** Points to know that do not make the file wrong. */
  warnings: string[];
}

/**
 * Controls run before the download (CNC avis 24, §2.2 and §2.5): total debit
 * equals total credit, each entry is balanced, entry numbers run 1, 2, 3…
 * without gaps or repeats in each journal, every account is in the chart.
 */
export function checkFec(input: FecInput, opts: { draftCount?: number } = {}): FecCheck {
  const journals = new Map(input.journals.map(j => [j.id, j]));
  const chart = new Set(input.accounts.map(a => a.code));
  const booked = input.entries.filter(e => e.status === 'posted' || e.status === 'reversed');
  const ids = new Set(booked.map(e => e.id));
  const lines = input.lines.filter(l => ids.has(l.entry_id));
  const errors: string[] = [];
  const warnings: string[] = [];

  let d = 0, c = 0;
  const perEntry = new Map<string, { d: number; c: number; n: number }>();
  for (const l of lines) {
    const ld = cents(l.debit), lc = cents(l.credit);
    d += ld; c += lc;
    const cur = perEntry.get(l.entry_id) || { d: 0, c: 0, n: 0 };
    cur.d += ld; cur.c += lc; cur.n += 1;
    perEntry.set(l.entry_id, cur);
  }
  if (d !== c) errors.push(`Total débit ${fecAmount(d / 100)} ≠ total crédit ${fecAmount(c / 100)}.`);

  const name = (e: FecEntry) => {
    const code = journals.get(e.journal_id)?.code || '?';
    return e.entry_number == null ? `${code} (sans numéro, ${e.entry_date})` : `${code} n° ${e.entry_number}`;
  };
  for (const e of booked) {
    const t = perEntry.get(e.id);
    if (!t || t.n === 0) errors.push(`Écriture ${name(e)} sans ligne.`);
    else if (t.d !== t.c) errors.push(`Écriture ${name(e)} déséquilibrée : débit ${fecAmount(t.d / 100)}, crédit ${fecAmount(t.c / 100)}.`);
  }

  const byJournal = new Map<string, number[]>();
  for (const e of booked) {
    if (e.entry_number == null) { errors.push(`Écriture ${name(e)} validée sans numéro.`); continue; }
    const list = byJournal.get(e.journal_id) || [];
    list.push(e.entry_number);
    byJournal.set(e.journal_id, list);
  }
  byJournal.forEach((nums, jid) => {
    const code = journals.get(jid)?.code || '?';
    const sorted = [...nums].sort((a, b) => a - b);
    const dup = sorted.filter((n, i) => i > 0 && sorted[i - 1] === n);
    if (dup.length) errors.push(`Journal ${code} : numéro(s) en double ${Array.from(new Set(dup)).join(', ')}.`);
    const have = new Set(sorted);
    const max = sorted[sorted.length - 1] || 0;
    const missing: number[] = [];
    for (let n = 1; n <= max && missing.length < 20; n++) if (!have.has(n)) missing.push(n);
    if (missing.length) errors.push(`Journal ${code} : numérotation interrompue, manque ${missing.join(', ')}${missing.length === 20 ? '…' : ''}.`);
  });

  const unknown = Array.from(new Set(lines.map(l => l.account_code).filter(code => !chart.has(code)))).sort();
  if (unknown.length) errors.push(`Compte(s) absent(s) du plan comptable : ${unknown.join(', ')}.`);

  const noRef = booked.filter(e => !String(e.reference || '').trim()).length;
  if (noRef) warnings.push(`${noRef} écriture${noRef > 1 ? 's' : ''} sans référence de pièce.`);
  if (opts.draftCount) warnings.push(`${opts.draftCount} écriture${opts.draftCount > 1 ? 's' : ''} en brouillon ne figure${opts.draftCount > 1 ? 'nt' : ''} pas dans le FEC.`);

  return { totalDebit: d / 100, totalCredit: c / 100, lineCount: lines.length, entryCount: booked.length, errors, warnings };
}
