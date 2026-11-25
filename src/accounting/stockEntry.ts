// Year-end stock entry (CGNC): the opening stock of goods is cancelled and
// the closing stock recorded through the stock-variation account, so the
// result of the year counts the goods still on hand. Pure functions.
//
//   opening stock SI:  debit 6114  / credit 3111
//   closing stock SF:  debit 3111  / credit 6114
//
// 6114 ends with SI − SF: a debit (an expense) when the stock went down, a
// credit when it went up. 3111 ends with SF, which the à-nouveaux carry to
// the next year, where the next closing cancels it in turn.

import type { JournalEntryLine } from '../types';

export const STOCK_ACCOUNT = '3111';
export const STOCK_VARIATION_ACCOUNT = '6114';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const frDay = (d: string) => d.split('-').reverse().join('/');

/** Source id of the stock entry of a fiscal year: one per year. */
export function stockSourceId(fiscalYearId: string): string { return `stock:${fiscalYearId}`; }

/** Variation of stock (balance of 6114 the entry leaves): opening − closing. */
export function stockVariation(opening: number, closing: number): number { return r2(r2(opening) - r2(closing)); }

/**
 * Lines of the stock entry. A pair whose amount is zero is left out; both
 * zero is refused (there is nothing to record). A credit opening balance on
 * 3111 (wrong, but possible in the books) is cancelled the other way round.
 */
export function buildStockEntryLines(input: { opening: number; closing: number; endDate: string }): JournalEntryLine[] {
  const opening = r2(input.opening);
  const closing = r2(input.closing);
  if (closing < 0) throw new Error('Le stock final ne peut pas être négatif.');
  if (opening === 0 && closing === 0) throw new Error('Stock initial et stock final nuls : aucune écriture de stock à passer.');
  const lines: JournalEntryLine[] = [];
  if (opening !== 0) {
    const a = Math.abs(opening);
    const label = 'Annulation du stock initial';
    lines.push(
      { account_code: STOCK_VARIATION_ACCOUNT, label, debit: opening > 0 ? a : 0, credit: opening > 0 ? 0 : a },
      { account_code: STOCK_ACCOUNT, label, debit: opening > 0 ? 0 : a, credit: opening > 0 ? a : 0 },
    );
  }
  if (closing > 0) {
    const label = `Stock final au ${frDay(input.endDate)}`;
    lines.push(
      { account_code: STOCK_ACCOUNT, label, debit: closing, credit: 0 },
      { account_code: STOCK_VARIATION_ACCOUNT, label, debit: 0, credit: closing },
    );
  }
  return lines;
}

interface EntryLike { id: string; status: string; entry_number?: number | null; source_type?: string | null; source_id?: string | null }
interface LineLike { account_code: string; debit: number | string; credit: number | string; entry_id?: string; source_type?: string | null; source_id?: string | null }

/**
 * Where the stock entry of a year stands, from the entries carrying its
 * source id: posted (the year is done), a draft (can be regenerated) or none
 * (also after the entry was reversed: a new one may then be made).
 */
export function stockEntryState<E extends EntryLike>(entries: E[]): { state: 'none' | 'draft' | 'posted'; entry: E | null } {
  const posted = entries.find(e => e.status === 'posted');
  if (posted) return { state: 'posted', entry: posted };
  const draft = entries.find(e => e.status === 'draft');
  if (draft) return { state: 'draft', entry: draft };
  return { state: 'none', entry: null };
}

/**
 * Balance of 3111 in the year's posted lines before any stock entry of the
 * year: the stock entries themselves and their reversals are left out.
 */
export function openingStockBalance(lines: LineLike[], fiscalYearId: string, stockEntryIds: Set<string>): number {
  const source = stockSourceId(fiscalYearId);
  let b = 0;
  for (const l of lines) {
    if (l.account_code !== STOCK_ACCOUNT) continue;
    if (l.source_id === source) continue;
    if (l.entry_id && stockEntryIds.has(l.entry_id)) continue;
    if (l.source_type === 'reversal' && l.source_id && stockEntryIds.has(l.source_id)) continue;
    b += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  return r2(b);
}

/** Amounts of a stock entry, read back from its lines (for the panel once it is posted). */
export function stockEntryAmounts(lines: Array<{ account_code: string; debit: number | string; credit: number | string; label?: string | null }>): { opening: number; closing: number } {
  let opening = 0, closing = 0;
  for (const l of lines) {
    if (l.account_code !== STOCK_ACCOUNT) continue;
    opening += Number(l.credit) || 0;
    closing += Number(l.debit) || 0;
  }
  // A credit opening balance was cancelled with a debit on 3111 labelled as the cancellation.
  const debitOpening = lines.filter(l => l.account_code === STOCK_ACCOUNT && Number(l.debit) > 0 && /initial/i.test(l.label || ''))
    .reduce((s, l) => s + (Number(l.debit) || 0), 0);
  return { opening: r2(opening - debitOpening), closing: r2(closing - debitOpening) };
}
