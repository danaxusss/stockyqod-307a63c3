import type { CustomerInfo, PaymentEntry, Quote, QuoteItem } from '../types';

// Document lines store prices TTC: subtotal = unitPrice × (1 − discount%) × qty.
// Every page that recomputes a line goes through here so a discount set in
// the quote survives edits, merges and PDFs.

const round2 = (n: number) => Math.round(n * 100) / 100;

export function discountRate(item: Pick<QuoteItem, 'discount'>): number {
  const d = Number(item.discount) || 0;
  return Math.min(100, Math.max(0, d));
}

/** Line total TTC with the line discount applied. */
export function lineSubtotal(item: Pick<QuoteItem, 'unitPrice' | 'quantity' | 'discount'>): number {
  const unit = Number(item.unitPrice) || 0;
  const qty = Number(item.quantity) || 0;
  return round2(unit * (1 - discountRate(item) / 100) * qty);
}

/** The same line with its total recomputed after a quantity, price or discount change. */
export function recomputeLine<T extends QuoteItem>(item: T): T {
  return { ...item, subtotal: lineSubtotal(item) };
}

export function documentTotal(items: Pick<QuoteItem, 'subtotal'>[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0));
}

// ─── VAT rate ────────────────────────────────────────────────────────────────

/** VAT rates in force since 1 January 2026 (CGI art. 99): 7 % and 14 % are gone. */
export const LEGAL_TVA_RATES = [20, 10, 0] as const;

export function isLegalTvaRate(rate: number): boolean {
  return (LEGAL_TVA_RATES as readonly number[]).includes(Number(rate));
}

/**
 * The VAT rate of a document: the one stored on it when it was issued, else
 * (documents from before the column, or a database not migrated yet) the
 * company's current rate. Every HT/TVA figure of a document goes through
 * here, so changing the company rate never rewrites a past document.
 */
export function documentTvaRate(doc: { tva_rate?: number | string | null } | null | undefined, companyRate?: number | null): number {
  const stored = doc?.tva_rate;
  if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) return Number(stored);
  return companyRate !== null && companyRate !== undefined && Number.isFinite(Number(companyRate)) ? Number(companyRate) : 20;
}

export function toHT(ttc: number, tvaRate: number): number {
  return ttc / (1 + tvaRate / 100);
}

export function toTTC(ht: number, tvaRate: number): number {
  return ht * (1 + tvaRate / 100);
}

/** Unit price HT as shown in an edit field (two decimals). */
export function unitPriceHTInput(item: Pick<QuoteItem, 'unitPrice'>, tvaRate: number): number {
  return round2(toHT(Number(item.unitPrice) || 0, tvaRate));
}

const lineKey = (item: QuoteItem) => item.quoteBarcode || item.product?.barcode || item.id;

/**
 * Merge lines from several documents. Lines for the same product are summed
 * only when they carry the same price and discount, so a line sold at another
 * price keeps its own price.
 */
export function mergeLines(items: QuoteItem[]): QuoteItem[] {
  const merged = new Map<string, QuoteItem>();
  for (const item of items) {
    const key = `${lineKey(item)}|${Number(item.unitPrice) || 0}|${discountRate(item)}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, recomputeLine({ ...existing, quantity: existing.quantity + item.quantity }));
    } else {
      merged.set(key, { ...item });
    }
  }
  return Array.from(merged.values());
}

const phoneDigits = (p?: string) => (p || '').replace(/\D/g, '').replace(/^(00)?212/, '0');

/** Same customer: same phone when both have one, otherwise the same name. */
export function sameCustomer(a?: CustomerInfo | null, b?: CustomerInfo | null): boolean {
  const pa = phoneDigits(a?.phoneNumber), pb = phoneDigits(b?.phoneNumber);
  if (pa && pb) return pa === pb;
  const na = (a?.fullName || '').trim().toLowerCase(), nb = (b?.fullName || '').trim().toLowerCase();
  return !!na && na === nb;
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface InvoicePayment {
  avance: number;
  paid: number;
  reste: number;
  status: 'paid' | 'partial' | 'unpaid';
}

/** Money received on an invoice: the advance plus every recorded payment. */
export function invoicePayment(inv: Pick<Quote, 'totalAmount' | 'avance_amount' | 'payment_methods_json'>): InvoicePayment {
  const avance = Number(inv.avance_amount) || 0;
  const entries = (inv.payment_methods_json || []) as PaymentEntry[];
  const paid = round2(avance + entries.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const reste = round2(Math.max(0, inv.totalAmount - paid));
  const status: InvoicePayment['status'] =
    reste <= 0 && (paid > 0 || inv.totalAmount === 0) ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { avance, paid, reste, status };
}

/** Every payment method used on an invoice (primary and extra payments). */
export function paymentMethods(inv: Pick<Quote, 'payment_method' | 'payment_methods_json'>): string[] {
  return [inv.payment_method, ...((inv.payment_methods_json || []) as PaymentEntry[]).map(e => e.method)]
    .filter((m): m is string => !!m && !!m.trim());
}

/** "Virement" matches "Virement bancaire", "Carte" matches "Carte bancaire"… */
export function matchesPaymentFilter(inv: Pick<Quote, 'payment_method' | 'payment_methods_json'>, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  return paymentMethods(inv).some(m => m.trim().toLowerCase().startsWith(f));
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local time (an <input type="date"> value). */
export function localDay(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The date printed on a document: the edited date, else the creation day. */
export function documentDay(doc: Pick<Quote, 'quote_date' | 'createdAt'>): string {
  return doc.quote_date ? doc.quote_date.slice(0, 10) : localDay(new Date(doc.createdAt));
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

/** YYYY-MM-DD plus a number of days (calendar arithmetic, no time zone drift). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return localDay(new Date(y, m - 1, d + days));
}

/** Whole days from `from` to `to` (YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// ─── Payment terms (loi 69-21) ───────────────────────────────────────────────

/** Between businesses: 60 days from the invoice date when nothing is agreed, 120 at most by agreement. */
export const DEFAULT_PAYMENT_DAYS = 60;
export const MAX_PAYMENT_DAYS = 120;

/** Why a payment delay setting is refused, or null when it is valid. */
export function paymentDaysError(days: number): string | null {
  if (!Number.isInteger(days) || days < 0) return 'Le délai de paiement est un nombre de jours entier (0 à 120).';
  if (days > MAX_PAYMENT_DAYS) return 'Le délai de paiement ne peut pas dépasser 120 jours (maximum légal, loi 69-21).';
  return null;
}

/** The due date of an invoice: the stored one, else invoice date + the legal 60 days. */
export function invoiceDueDay(inv: Pick<Quote, 'quote_date' | 'createdAt'> & { due_date?: string | null }): string {
  return inv.due_date ? inv.due_date.slice(0, 10) : addDays(documentDay(inv), DEFAULT_PAYMENT_DAYS);
}

/** Why a due date is refused for an invoice of `invoiceDay`, or null. */
export function dueDateError(invoiceDay: string, dueDay: string): string | null {
  if (!dueDay) return 'Indiquez la date d’échéance.';
  if (dueDay < invoiceDay) return 'L’échéance ne peut pas précéder la date de la facture.';
  if (daysBetween(invoiceDay, dueDay) > MAX_PAYMENT_DAYS) {
    return `L’échéance ne peut pas dépasser 120 jours après la facture (au plus tard le ${formatDay(addDays(invoiceDay, MAX_PAYMENT_DAYS))}).`;
  }
  return null;
}

export interface Overdue { overdue: boolean; days: number; dueDay: string }

/**
 * An issued invoice not fully paid after its due date is late, by that many
 * days. Uses the same payment computation as the rest of the app.
 */
export function invoiceOverdue(
  inv: Pick<Quote, 'quote_date' | 'createdAt' | 'status' | 'totalAmount' | 'avance_amount' | 'payment_methods_json'> & { due_date?: string | null },
  today: string = localDay(),
): Overdue {
  const dueDay = invoiceDueDay(inv);
  const late = daysBetween(dueDay, today);
  const open = inv.status !== 'draft' && invoicePayment(inv).status !== 'paid';
  return { overdue: open && late > 0, days: open && late > 0 ? late : 0, dueDay };
}
