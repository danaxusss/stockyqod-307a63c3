// Checks of a manual entry, run on save and before posting. The form's HTML
// attributes (min=0) are not enough: a pasted or typed value bypasses them.

import type { Account, JournalEntryLine } from '../types';

export interface EntryCheck {
  /** Lines kept: those with an account or an amount. */
  lines: JournalEntryLine[];
  errors: string[];
  balanced: boolean;
}

const amount = (v: unknown) => (v === '' || v == null ? 0 : Number(v));

export function validateEntryLines(input: JournalEntryLine[], accounts: Pick<Account, 'code' | 'active'>[], opts: { forPosting?: boolean } = {}): EntryCheck {
  const byCode = new Map(accounts.map(a => [a.code, a]));
  const errors: string[] = [];
  const lines: JournalEntryLine[] = [];
  input.forEach((l, i) => {
    const n = i + 1;
    const code = String(l.account_code || '').trim();
    const d = amount(l.debit), c = amount(l.credit);
    if (!code && !d && !c) return;
    if (!Number.isFinite(d) || !Number.isFinite(c)) { errors.push(`Ligne ${n} : montant invalide.`); return; }
    if (d < 0 || c < 0) errors.push(`Ligne ${n} : un montant ne peut pas être négatif.`);
    if (d > 0 && c > 0) errors.push(`Ligne ${n} : saisissez soit un débit, soit un crédit, pas les deux.`);
    if (!code) errors.push(`Ligne ${n} : compte manquant.`);
    else if (!byCode.has(code)) errors.push(`Ligne ${n} : le compte ${code} n'existe pas dans le plan comptable.`);
    else if (byCode.get(code)?.active === false) errors.push(`Ligne ${n} : le compte ${code} est désactivé.`);
    if (code && d === 0 && c === 0) errors.push(`Ligne ${n} : saisissez un montant.`);
    lines.push({ ...l, account_code: code, debit: Math.round(d * 100) / 100, credit: Math.round(c * 100) / 100 });
  });
  if (lines.length < 2) errors.push('Au moins deux lignes mouvementées.');
  const D = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100);
  const C = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100);
  const balanced = D === C && D > 0;
  if (opts.forPosting && !balanced) errors.push(D === 0 ? 'Écriture sans montant.' : 'Écriture déséquilibrée : le total des débits doit égaler celui des crédits.');
  return { lines, errors, balanced };
}
