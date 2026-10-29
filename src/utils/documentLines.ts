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
