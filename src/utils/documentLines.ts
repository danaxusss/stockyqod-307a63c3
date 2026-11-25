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

/** Method label of a settlement where the client withheld the VAT (CGI art. 117-IV). */
export const WITHHOLDING_METHOD = 'TVA retenue à la source';

export const isWithholding = (e: Pick<PaymentEntry, 'kind'> | null | undefined) => e?.kind === 'vat_withholding';

/**
 * Cash, as the books and the tax rules see it: notes and coins handed over.
 * A bank deposit ("Versement"), a card, a cheque or a transfer are not cash
 * (CGI art. 193 lists the deposit with the accepted means of payment).
 */
export function isCashMethod(method: string | null | undefined): boolean {
  return /esp[eè]ce|cash|caisse|liquide/i.test(method || '');
}

/**
 * One settlement of an invoice: the advance (avance_amount, dated by
 * payment_date) or an entry of payment_methods_json. `date` is the entry's
 * own date; entries saved before dated payments, and the advance, take the
 * invoice's payment date, else the invoice date (what every payment used
 * before).
 */
export interface Settlement {
  /** 'avance', the entry id, or '#<index>' for entries without an id. */
  key: string;
  source: 'avance' | 'entry';
  /** Index in payment_methods_json; -1 for the advance. */
  index: number;
  kind: 'payment' | 'vat_withholding';
  method: string;
  reference: string;
  bank: string;
  amount: number;
  date: string;
  /** Whether the date was stored on the settlement itself. */
  dated: boolean;
  stampDuty: number;
  withholdingRate?: number;
}

type SettledInvoice = Pick<Quote, 'totalAmount' | 'avance_amount' | 'payment_methods_json'> &
  Partial<Pick<Quote, 'payment_date' | 'payment_method' | 'payment_reference' | 'payment_bank' | 'quote_date' | 'createdAt'>>;

/** The day an undated settlement of this invoice is booked on. */
export function fallbackPaymentDay(inv: Partial<Pick<Quote, 'payment_date' | 'quote_date' | 'createdAt'>>): string {
  if (inv.payment_date) return String(inv.payment_date).slice(0, 10);
  if (inv.quote_date) return String(inv.quote_date).slice(0, 10);
  return localDay(inv.createdAt ? new Date(inv.createdAt) : new Date());
}

/** Every settlement of an invoice, in the order they were recorded (the advance first). */
export function invoiceSettlements(inv: SettledInvoice): Settlement[] {
  const fallback = fallbackPaymentDay(inv);
  const out: Settlement[] = [];
  const avance = round2(Number(inv.avance_amount) || 0);
  if (avance > 0) {
    out.push({
      key: 'avance', source: 'avance', index: -1, kind: 'payment', method: inv.payment_method || '', reference: inv.payment_reference || '',
      bank: inv.payment_bank || '', amount: avance, date: fallback, dated: !!inv.payment_date, stampDuty: 0,
    });
  }
  ((inv.payment_methods_json || []) as PaymentEntry[]).forEach((e, index) => {
    const withholding = isWithholding(e);
    out.push({
      key: e.id || `#${index}`, source: 'entry', index, kind: withholding ? 'vat_withholding' : 'payment',
      method: withholding ? WITHHOLDING_METHOD : (e.method || ''), reference: e.reference || '', bank: e.bank || '',
      amount: round2(Number(e.amount) || 0), date: e.date ? String(e.date).slice(0, 10) : fallback, dated: !!e.date,
      // Duty is collected on cash only; a stray value on another kind is ignored.
      stampDuty: !withholding && isCashMethod(e.method) ? round2(Number(e.stamp_duty) || 0) : 0,
      withholdingRate: withholding ? Number(e.withholding_rate) || 100 : undefined,
    });
  });
  return out;
}

export interface InvoicePayment {
  avance: number;
  /** Settled: money received plus VAT withheld by the client. Drives the rest and the status. */
  paid: number;
  reste: number;
  status: 'paid' | 'partial' | 'unpaid';
  /** Money actually received (advance and payments), withholding excluded. */
  received: number;
  /** VAT withheld at source by the client (not money received). */
  withheld: number;
  /** Part of `received` paid in cash. */
  cash: number;
  /** Stamp duty collected on top of the cash payments (not part of `received`). */
  stampDuty: number;
}

/** What settles an invoice: the advance, every payment, and the VAT withheld by the client. */
export function invoicePayment(inv: SettledInvoice): InvoicePayment {
  const all = invoiceSettlements(inv);
  const sum = (list: Settlement[], f: (s: Settlement) => number = s => s.amount) => round2(list.reduce((t, s) => t + f(s), 0));
  const money = all.filter(s => s.kind === 'payment');
  const avance = round2(Number(inv.avance_amount) || 0);
  const received = sum(money);
  const withheld = sum(all.filter(s => s.kind === 'vat_withholding'));
  const paid = round2(received + withheld);
  const reste = round2(Math.max(0, inv.totalAmount - paid));
  const status: InvoicePayment['status'] =
    reste <= 0 && (paid > 0 || inv.totalAmount === 0) ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return {
    avance, paid, reste, status, received, withheld,
    cash: sum(money.filter(s => isCashMethod(s.method))),
    stampDuty: sum(money, s => s.stampDuty),
  };
}

/** Every payment method used on an invoice (primary and extra payments). */
export function paymentMethods(inv: Pick<Quote, 'payment_method' | 'payment_methods_json'>): string[] {
  return [inv.payment_method, ...((inv.payment_methods_json || []) as PaymentEntry[]).map(e => (isWithholding(e) ? WITHHOLDING_METHOD : e.method))]
    .filter((m): m is string => !!m && !!m.trim());
}

/** Why a payment entry cannot be saved on an invoice dated `invoiceDay`, or null. */
export function paymentEntryError(e: PaymentEntry, invoiceDay: string): string | null {
  if (!e.date) return null; // older entries: dated by the invoice
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return 'Date de règlement invalide.';
  if (e.date < invoiceDay && !e.advance && !isWithholding(e)) {
    return `Le règlement du ${formatDay(e.date)} précède la facture du ${formatDay(invoiceDay)} : cochez « Avance » s’il a été reçu avant la facture.`;
  }
  if (isWithholding(e) && e.date < invoiceDay) return 'La retenue à la source ne peut pas précéder la facture.';
  return null;
}

/** A new payment line, dated today. */
export function newPaymentEntry(extra: Partial<PaymentEntry> = {}): PaymentEntry {
  return { id: crypto.randomUUID(), method: '', reference: '', bank: '', amount: 0, date: localDay(), kind: 'payment', ...extra };
}

// ─── VAT withheld at source by the client (CGI art. 117-IV) ─────────────────

/**
 * Art. 117-IV: a supplier of equipment goods or works that does not show its
 * VAT-registered client an "attestation de régularité fiscale" issued less
 * than 6 months ago has the VAT of its invoices withheld by that client.
 * The validity stays in this one constant: a 2027 bill would shorten it.
 */
export const TAX_ATTESTATION_VALIDITY_MONTHS = 6;
/** Warn this many days before the attestation stops being valid. */
export const TAX_ATTESTATION_WARNING_DAYS = 30;

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  // The same day N months later; the 31st of a shorter month becomes its last day.
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  return localDay(new Date(y, m - 1 + months, Math.min(d, last)));
}

export interface AttestationStatus {
  state: 'missing' | 'expired' | 'expiring' | 'valid';
  /** Last day it is less than 6 months old. */
  validUntil?: string;
  daysLeft?: number;
  message: string;
}

/** Whether the company's attestation de régularité fiscale spares it the withholding today. */
export function taxAttestationStatus(issuedOn: string | null | undefined, today: string = localDay()): AttestationStatus {
  const warn = 'vos clients assujettis doivent retenir la TVA (art. 117-IV CGI)';
  if (!issuedOn || !/^\d{4}-\d{2}-\d{2}/.test(issuedOn)) {
    return { state: 'missing', message: `Attestation de régularité fiscale non renseignée : ${warn}.` };
  }
  // "Délivrée depuis moins de six mois": valid up to the day before the 6-month anniversary.
  const validUntil = addDays(addMonths(issuedOn, TAX_ATTESTATION_VALIDITY_MONTHS), -1);
  const daysLeft = daysBetween(today, validUntil);
  if (daysLeft < 0) {
    return { state: 'expired', validUntil, daysLeft, message: `Attestation de régularité fiscale de plus de 6 mois (expirée le ${formatDay(addDays(validUntil, 1))}) : ${warn}.` };
  }
  if (daysLeft <= TAX_ATTESTATION_WARNING_DAYS) {
    return { state: 'expiring', validUntil, daysLeft, message: `Attestation de régularité fiscale valable jusqu’au ${formatDay(validUntil)} (${daysLeft} j) : demandez-en une nouvelle.` };
  }
  return { state: 'valid', validUntil, daysLeft, message: `Attestation de régularité fiscale valable jusqu’au ${formatDay(validUntil)}.` };
}

/** Share of the VAT withheld: 100 % for equipment goods and works (117-IV), 75 % for the services of 117-V. */
export const WITHHOLDING_RATES = [100, 75] as const;

/** VAT of an invoice (TTC total at its own rate). */
export function invoiceVat(inv: Pick<Quote, 'totalAmount'> & { tva_rate?: number | string | null }, companyRate?: number | null): number {
  const rate = documentTvaRate(inv, companyRate);
  return round2(inv.totalAmount - toHT(inv.totalAmount, rate));
}

/**
 * The withholding a client would make on this invoice: `share` % of its VAT,
 * less what was already withheld, and never more than what is left to pay.
 */
export function defaultWithholding(inv: SettledInvoice & { tva_rate?: number | string | null }, companyRate?: number | null, share = 100): number {
  const { withheld, reste } = invoicePayment(inv);
  return round2(Math.max(0, Math.min(reste, invoiceVat(inv, companyRate) * share / 100 - withheld)));
}

/** HT base of a withholding: the amount whose VAT the client kept. */
export function withholdingBase(amount: number, tvaRate: number, share = 100): number {
  if (!tvaRate || !share) return 0;
  return round2(amount / (share / 100) / (tvaRate / 100));
}

// ─── Stamp duty on cash settlements (CGI art. 252-I-B) ──────────────────────

/** 0.25 % of what is settled in cash. No minimum and no rounding rule in the text: rounded to the centime. */
export const CASH_STAMP_DUTY_RATE = 0.25;

export function cashStampDuty(amount: number): number {
  return round2((Number(amount) || 0) * CASH_STAMP_DUTY_RATE / 100);
}

// ─── Cash limit (CGI art. 193) ──────────────────────────────────────────────

/** A transaction of 20,000 DH or more settled otherwise than by the accepted means costs the seller 6 % of it. */
export const CASH_TRANSACTION_LIMIT = 20000;
export const CASH_FINE_RATE = 6;

export interface CashLimitWarning { fine: number; cash: number; total: number; message: string }

/**
 * Art. 193 tests the transaction (the sale invoiced), not each payment: any
 * cash on an invoice of 20,000 DH or more, or cash reaching 20,000 DH, exposes
 * the seller to 6 % of the transaction. Never blocks: a warning to show.
 */
export function cashLimitWarning(invoiceTotal: number, cashTotal: number): CashLimitWarning | null {
  const total = round2(Number(invoiceTotal) || 0);
  const cash = round2(Number(cashTotal) || 0);
  if (cash <= 0 || Math.max(total, cash) < CASH_TRANSACTION_LIMIT) return null;
  const base = Math.max(total, cash);
  const fine = round2(base * CASH_FINE_RATE / 100);
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return {
    fine, cash, total,
    message: `Vente de ${fmt(base)} DH réglée en partie en espèces (${fmt(cash)} DH) : au-delà de 20 000 DH, l’amende est de 6 % de la transaction, soit ${fmt(fine)} DH (art. 193 CGI). Préférez chèque, virement, carte ou versement bancaire.`,
  };
}

// ─── Invoice numbers ────────────────────────────────────────────────────────

/**
 * A draft invoice has no number of the series (CGI art. 145-III: continuous
 * series): it carries this provisional reference until it is finalised.
 */
export const PROVISIONAL_NUMBER_PREFIX = 'BROUILLON-';

export function provisionalNumber(id: string = crypto.randomUUID()): string {
  return `${PROVISIONAL_NUMBER_PREFIX}${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export function isProvisionalNumber(number: string | null | undefined): boolean {
  return (number || '').startsWith(PROVISIONAL_NUMBER_PREFIX);
}

/** How an invoice number reads on screen: "Brouillon" for a provisional reference. */
export function invoiceNumberLabel(number: string | null | undefined): string {
  return isProvisionalNumber(number) ? 'Brouillon' : (number || '');
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
