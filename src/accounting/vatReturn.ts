// The VAT return (déclaration de TVA) computed from the documents, not from
// ledger balances. Pure functions: the page loads invoices, credit notes,
// supplier invoices and payments, and everything below is computed here and
// tested on hand-built data (src/test/vatReturn.test.ts).
//
// What the tax code says, and how it is applied (CGI 2026, articles quoted in
// the comments where they are used):
// - art. 95: VAT is due when the price is received ("encaissement total ou
//   partiel"), unless the company opted for the invoice basis ("débit"); on
//   the invoice basis, payments received before the invoice are taxable when
//   received.
// - art. 99: 20 % and 10 % since 1 January 2026 (art. 247-XXXXI ended the
//   transitional rates). A document at another rate is counted at its own
//   rate on a line of its own: right for an invoice of 2025 paid in 2026
//   (art. 125-III), an error for a document dated in 2026.
// - art. 101-2°: deductible VAT beyond the VAT due is carried to the next
//   month or quarter; art. 101-3°: the right to deduct arises in the month
//   the supplier invoice is paid (in part or in full) and must be used
//   within one year.
// - art. 104: prorata applied to the deductible VAT; art. 106: exclusions
//   (stored per supplier-invoice line, and per payment for the cash limits
//   of 106-II).
// - art. 112-I: content and order of the return; 112-II: relevé de
//   déductions (see vatDeductionStatement.ts).
// - art. 117-IV/V and 103-6°: VAT withheld by clients is the supplier's own
//   VAT collected by the client: the sale is declared as usual and the
//   withheld VAT is set against the VAT due; a credit it creates may be
//   refunded (NC 737, VI-2: "liquidés dans la limite du montant de la TVA
//   retenue à la source").
// - art. 117 (last paragraphs): VAT the company withheld from its suppliers
//   is paid over during the month after each payment, with its own
//   bordereau-avis: shown apart, never netted in the return.

import type { Quote } from '../types';
import { documentDay, documentTvaRate, invoiceSettlements, isProvisionalNumber, isLegalTvaRate } from '../utils/documentLines';
import {
  r2, supplierDisplayName, type Supplier, type SupplierInvoice, type SupplierInvoiceLine, type SupplierPayment, type SupplierPaymentMode,
} from './supplierInvoices';

// ── Settings ────────────────────────────────────────────────────────────────

export type VatRegime = 'encaissement' | 'debit';
export type VatPeriodicity = 'M' | 'T';

export interface VatSettings {
  regime: VatRegime;
  periodicity: VatPeriodicity;
  /** Deduction prorata in % (art. 104), 100 when every sale is taxable. */
  prorata: number;
  /** VAT credit carried into the first period declared with Stocky. */
  openingCredit: number;
  /** First day of the first period declared with Stocky (YYYY-MM-DD), or null. */
  startDate: string | null;
}

export const DEFAULT_VAT_SETTINGS: VatSettings = { regime: 'encaissement', periodicity: 'M', prorata: 100, openingCredit: 0, startDate: null };

/** The migration that adds the VAT settings and the stored lists of a declaration. */
export const VAT_MIGRATION = '20261127120000_vat_return.sql';

/** The VAT settings as stored on the company (settings pages). */
export interface VatSettingsValue {
  vat_regime: 'encaissement' | 'debit';
  vat_periodicity: 'M' | 'T' | '';
  vat_prorata: number;
  vat_opening_credit: number;
  vat_start_date: string;
}

/** Why the VAT settings cannot be saved, or null. */
export function vatSettingsFieldsError(v: Partial<VatSettingsValue>): string | null {
  const p = Number(v.vat_prorata ?? 100);
  if (!Number.isFinite(p) || p <= 0 || p > 100) return 'Le prorata de déduction de TVA est un pourcentage entre 1 et 100.';
  const c = Number(v.vat_opening_credit ?? 0);
  if (!Number.isFinite(c) || c < 0) return 'Le crédit de TVA de départ est un montant positif ou nul.';
  return null;
}

/** Art. 108-I: monthly once the taxable turnover of the past year reaches 1,000,000 DH. */
export const MONTHLY_THRESHOLD = 1_000_000;

/** Why a settings value is refused, or null. */
export function vatSettingsError(s: Partial<VatSettings>): string | null {
  if (s.regime !== undefined && s.regime !== 'encaissement' && s.regime !== 'debit') return 'Régime inconnu.';
  if (s.periodicity !== undefined && s.periodicity !== 'M' && s.periodicity !== 'T') return 'Périodicité inconnue.';
  if (s.prorata !== undefined && (!Number.isFinite(Number(s.prorata)) || Number(s.prorata) <= 0 || Number(s.prorata) > 100)) return 'Le prorata est un pourcentage entre 1 et 100.';
  if (s.openingCredit !== undefined && (!Number.isFinite(Number(s.openingCredit)) || Number(s.openingCredit) < 0)) return 'Le crédit de départ est un montant positif ou nul.';
  if (s.startDate && !/^\d{4}-\d{2}-01$/.test(s.startDate)) return 'La date de départ est le premier jour d’un mois.';
  return null;
}

// ── Periods ─────────────────────────────────────────────────────────────────

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export interface VatPeriod {
  /** "2026-03" for a month, "2026-T1" for a quarter (the key already stored by vat_declarations). */
  key: string;
  type: VatPeriodicity;
  year: number;
  /** 1–12 for a month, 1–4 for a quarter (the <periode> of the EDI file). */
  index: number;
  start: string;
  end: string;
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate(); // m: 1–12

export function vatPeriod(type: VatPeriodicity, year: number, index: number): VatPeriod {
  if (type === 'M') {
    return { key: `${year}-${pad(index)}`, type, year, index, start: `${year}-${pad(index)}-01`, end: `${year}-${pad(index)}-${pad(lastDayOf(year, index))}`, label: `${MONTHS_FR[index - 1]} ${year}` };
  }
  const m0 = (index - 1) * 3 + 1, m1 = m0 + 2;
  return { key: `${year}-T${index}`, type, year, index, start: `${year}-${pad(m0)}-01`, end: `${year}-${pad(m1)}-${pad(lastDayOf(year, m1))}`, label: `${index}${index === 1 ? 'er' : 'e'} trimestre ${year}` };
}

export function parsePeriodKey(key: string): VatPeriod | null {
  const q = /^(\d{4})-T([1-4])$/.exec(key || '');
  if (q) return vatPeriod('T', Number(q[1]), Number(q[2]));
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key || '');
  return m ? vatPeriod('M', Number(m[1]), Number(m[2])) : null;
}

export function periodContaining(type: VatPeriodicity, day: string): VatPeriod {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  return type === 'M' ? vatPeriod('M', y, m) : vatPeriod('T', y, Math.floor((m - 1) / 3) + 1);
}

/** The period before `p`, in the same periodicity. */
export function previousPeriod(p: VatPeriod): VatPeriod {
  if (p.type === 'M') return p.index === 1 ? vatPeriod('M', p.year - 1, 12) : vatPeriod('M', p.year, p.index - 1);
  return p.index === 1 ? vatPeriod('T', p.year - 1, 4) : vatPeriod('T', p.year, p.index - 1);
}

/**
 * Last day to file and pay. Art. 110 and 111: on paper before the 20th of
 * the month after the period; filed electronically (SIMPL-TVA, art. 155)
 * "avant l'expiration" of that month. Electronic filing is the rule for
 * companies, so the page shows the end of the month and mentions the 20th.
 */
export function filingDeadline(p: VatPeriod): { electronic: string; paper: string } {
  const y = Number(p.end.slice(0, 4)), m = Number(p.end.slice(5, 7));
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { electronic: `${ny}-${pad(nm)}-${pad(lastDayOf(ny, nm))}`, paper: `${ny}-${pad(nm)}-19` };
}

/** Periods of a year for a periodicity. */
export function periodsOfYear(type: VatPeriodicity, year: number): VatPeriod[] {
  return Array.from({ length: type === 'M' ? 12 : 4 }, (_, i) => vatPeriod(type, year, i + 1));
}

/** Art. 108: monthly at 1,000,000 DH of taxable turnover in the past year, otherwise quarterly. */
export function suggestedPeriodicity(previousYearTaxableTurnover: number | null): { periodicity: VatPeriodicity; reason: string } {
  if (previousYearTaxableTurnover === null) {
    return { periodicity: 'T', reason: 'Nouvelle entreprise : déclaration trimestrielle pour l’année civile en cours (art. 108-II-3°), sauf option pour le mensuel avant le 31 janvier.' };
  }
  return previousYearTaxableTurnover >= MONTHLY_THRESHOLD
    ? { periodicity: 'M', reason: 'Chiffre d’affaires taxable de l’an dernier d’au moins 1 000 000 DH : déclaration mensuelle obligatoire (art. 108-I).' }
    : { periodicity: 'T', reason: 'Chiffre d’affaires taxable de l’an dernier sous 1 000 000 DH : déclaration trimestrielle, ou mensuelle sur option demandée avant le 31 janvier (art. 108-II).' };
}

// ── Sales: VAT due ──────────────────────────────────────────────────────────

export type SaleEventKind = 'encaissement' | 'retenue' | 'facture' | 'avance' | 'avoir';

/** One amount counted in the return, with what it comes from. */
export interface SaleItem {
  kind: SaleEventKind;
  docId: string;
  /** Number of the invoice (or credit note) shown to the user. */
  number: string;
  /** Day the amount counts (settlement, invoice or credit-note date). */
  date: string;
  /** Date of the invoice it belongs to. */
  invoiceDate: string;
  client: string;
  rate: number;
  /** TTC amount the event brings into the period (negative for a credit note). */
  ttc: number;
  ht: number;
  vat: number;
  /** Settlement method, for a settlement. */
  method?: string;
  /** Full amount of the settlement or credit note, when only part of it counts. */
  fullAmount?: number;
  /** Invoice the credit note corrects. */
  invoiceNumber?: string;
}

export interface SaleRateLine { rate: number; legal: boolean; base: number; vat: number; items: SaleItem[] }

export interface SalesBlock {
  /** Taxable turnover and VAT by rate, highest first; credit notes included (negative). */
  byRate: SaleRateLine[];
  totalBase: number;
  totalVat: number;
  /** Turnover at 0 % (exempt or outside the tax), part of the total. */
  exemptBase: number;
  /** Credit notes of the period alone (negative amounts), also inside byRate. */
  creditNotes: { base: number; vat: number; items: SaleItem[] };
  /** Turnover of the period (HT), all rates. */
  turnover: number;
}

/** One VAT withholding by a client, set against the VAT due (art. 117-IV/V). */
export interface ClientWithholdingItem { docId: string; number: string; date: string; client: string; clientIce: string; rate: number; share: number; amount: number }

function split(ttc: number, rate: number): { ht: number; vat: number } {
  const ht = r2(ttc / (1 + (Number(rate) || 0) / 100));
  return { ht, vat: r2(ttc - ht) };
}

const inRange = (day: string, start: string, end: string) => day >= start && day <= end;
const invoiceIssued = (q: Quote) => q.status !== 'draft';

interface SalesInput {
  invoices: Quote[];
  avoirs: Quote[];
  regime: VatRegime;
  start: string;
  end: string;
  companyRate?: number | null;
}

/**
 * Every amount that makes VAT due between `start` and `end`.
 *
 * Cash basis (encaissement): each settlement of an issued invoice dated in
 * the period counts, money and VAT withheld by the client alike (both pay
 * part of the price; the withheld part reached the State through the
 * client), split HT/VAT at the invoice's own rate.
 *
 * Credit notes on a cash basis: the code (art. 95, 96, 101) does not say how
 * a credit note is taxed when VAT follows the money. Applied here: a credit
 * note lowers the price, so the invoice can never bring more VAT than its
 * price net of credit notes. Settlements and credit notes of an invoice are
 * taken in date order; what is counted is min(settled so far, invoice − credit
 * notes so far). A credit note on an invoice already paid therefore lowers
 * the VAT of the period it is issued in (the client is owed the money back);
 * on an unpaid invoice it only lowers what will be collected. A credit note
 * with no invoice found lowers the VAT of its own period in full.
 *
 * Invoice basis (débit): an issued invoice counts at its date, except the
 * part received earlier as an advance, which counts when received (art. 95:
 * "les encaissements partiels … effectués avant l'établissement du débit
 * sont taxables"); a credit note counts at its date, at its own rate.
 */
export function salesEvents(input: SalesInput): { items: SaleItem[]; withholdings: ClientWithholdingItem[] } {
  const { invoices, avoirs, regime, start, end, companyRate } = input;
  const items: SaleItem[] = [];
  const withholdings: ClientWithholdingItem[] = [];
  const issued = invoices.filter(q => (q.document_type ?? 'invoice') === 'invoice' && invoiceIssued(q));
  const byId = new Map(issued.map(q => [q.id, q]));
  const creditsOf = new Map<string, Quote[]>();
  const orphans: Quote[] = [];
  for (const a of avoirs) {
    if (a.status === 'draft') continue;
    const parent = a.parent_document_id ? byId.get(a.parent_document_id) : undefined;
    if (parent) (creditsOf.get(parent.id) || creditsOf.set(parent.id, []).get(parent.id)!).push(a);
    else orphans.push(a);
  }

  for (const inv of issued) {
    const rate = documentTvaRate(inv, companyRate);
    const ttc = r2(inv.totalAmount);
    const invoiceDate = documentDay(inv);
    const client = inv.customer?.fullName || '';
    const settlements = invoiceSettlements(inv).filter(s => s.amount > 0);
    const credits = (creditsOf.get(inv.id) || []).map(a => ({ a, date: documentDay(a), amount: r2(a.totalAmount) }));

    // Withholdings are set against the VAT due in the period they are made,
    // whatever the regime: the client's withholding is known only then.
    for (const s of settlements) {
      if (s.kind === 'vat_withholding' && inRange(s.date, start, end)) {
        withholdings.push({ docId: inv.id, number: inv.quoteNumber, date: s.date, client, clientIce: inv.customer?.ice || '', rate, share: s.withholdingRate || 100, amount: s.amount });
      }
    }

    const push = (kind: SaleEventKind, date: string, amount: number, extra: Partial<SaleItem> = {}, r = rate) => {
      if (!inRange(date, start, end) || Math.abs(amount) < 0.005) return;
      items.push({ kind, docId: inv.id, number: inv.quoteNumber, date, invoiceDate, client, rate: r, ttc: r2(amount), ...split(amount, r), ...extra });
    };

    if (regime === 'encaissement') {
      type Ev = { date: string; order: number; settle?: typeof settlements[number]; credit?: typeof credits[number] };
      const events: Ev[] = [
        ...settlements.map((s, i) => ({ date: s.date, order: i, settle: s })),
        // On one day, settlements first: the same day nets to the same VAT either way.
        ...credits.map((c, i) => ({ date: c.date, order: 1000 + i, credit: c })),
      ].sort((x, y) => x.date.localeCompare(y.date) || x.order - y.order);
      let settled = 0, credited = 0, counted = 0;
      for (const e of events) {
        if (e.settle) settled = r2(settled + e.settle.amount);
        else credited = r2(credited + e.credit!.amount);
        const now = r2(Math.max(0, Math.min(settled, ttc - credited)));
        const delta = r2(now - counted);
        counted = now;
        if (e.settle) {
          push(e.settle.kind === 'vat_withholding' ? 'retenue' : 'encaissement', e.date, delta, {
            method: e.settle.method, ...(Math.abs(delta - e.settle.amount) > 0.005 ? { fullAmount: e.settle.amount } : {}),
          });
        } else {
          const a = e.credit!.a;
          if (!inRange(e.date, start, end) || Math.abs(delta) < 0.005) continue;
          items.push({
            kind: 'avoir', docId: a.id, number: a.quoteNumber, date: e.date, invoiceDate, client, rate, ttc: delta, ...split(delta, rate),
            invoiceNumber: inv.quoteNumber, ...(Math.abs(-delta - e.credit!.amount) > 0.005 ? { fullAmount: -e.credit!.amount } : {}),
          });
        }
      }
    } else {
      // Advances: settlements dated before the invoice, counted when received, never beyond the invoice.
      let advanced = 0;
      for (const s of [...settlements].sort((x, y) => x.date.localeCompare(y.date))) {
        if (s.date >= invoiceDate) continue;
        const part = r2(Math.min(s.amount, Math.max(0, ttc - advanced)));
        advanced = r2(advanced + part);
        push('avance', s.date, part, { method: s.method, ...(Math.abs(part - s.amount) > 0.005 ? { fullAmount: s.amount } : {}) });
      }
      push('facture', invoiceDate, r2(ttc - advanced), advanced > 0 ? { fullAmount: ttc } : {});
      for (const c of credits) {
        const r = documentTvaRate(c.a, rate);
        if (!inRange(c.date, start, end) || c.amount <= 0) continue;
        items.push({ kind: 'avoir', docId: c.a.id, number: c.a.quoteNumber, date: c.date, invoiceDate, client, rate: r, ttc: -c.amount, ...split(-c.amount, r), invoiceNumber: inv.quoteNumber });
      }
    }
  }

  for (const a of orphans) {
    const date = documentDay(a);
    if (!inRange(date, start, end) || !(a.totalAmount > 0)) continue;
    const r = documentTvaRate(a, companyRate);
    items.push({ kind: 'avoir', docId: a.id, number: a.quoteNumber, date, invoiceDate: '', client: a.customer?.fullName || '', rate: r, ttc: -r2(a.totalAmount), ...split(-r2(a.totalAmount), r) });
  }

  items.sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));
  withholdings.sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));
  return { items, withholdings };
}

export function salesBlock(items: SaleItem[]): SalesBlock {
  const map = new Map<number, SaleRateLine>();
  for (const it of items) {
    const line = map.get(it.rate) || { rate: it.rate, legal: isLegalTvaRate(it.rate), base: 0, vat: 0, items: [] };
    line.base = r2(line.base + it.ht);
    line.vat = r2(line.vat + it.vat);
    line.items.push(it);
    map.set(it.rate, line);
  }
  const byRate = [...map.values()].sort((a, b) => b.rate - a.rate);
  const credits = items.filter(i => i.kind === 'avoir');
  const totalBase = r2(byRate.reduce((s, l) => s + l.base, 0));
  return {
    byRate,
    totalBase,
    totalVat: r2(byRate.reduce((s, l) => s + l.vat, 0)),
    exemptBase: r2(byRate.filter(l => l.rate === 0).reduce((s, l) => s + l.base, 0)),
    creditNotes: { base: r2(credits.reduce((s, i) => s + i.ht, 0)), vat: r2(credits.reduce((s, i) => s + i.vat, 0)), items: credits },
    turnover: totalBase,
  };
}

/** Taxable turnover (HT, rates above 0) over a span, for the periodicity rule of art. 108. */
export function taxableTurnover(input: SalesInput): number {
  const { items } = salesEvents(input);
  return r2(items.filter(i => i.rate > 0).reduce((s, i) => s + i.ht, 0));
}

// ── Purchases: deductible VAT ───────────────────────────────────────────────

/** Art. 112-I-8°: purchases not capitalised (services; purchases, imports, works) and assets. */
export type DeductionCategory = 'services' | 'achats' | 'immobilisations';

export const CATEGORY_LABELS: Record<DeductionCategory, string> = {
  achats: 'Achats non immobilisés : achats, importations et travaux à façon',
  services: 'Achats non immobilisés : prestations de services',
  immobilisations: 'Immobilisations',
};

/** Class 2: assets; 611/612: purchases of goods and supplies; any other charge: services. */
export function deductionCategory(accountCode: string): DeductionCategory {
  const code = (accountCode || '').trim();
  if (/^2/.test(code)) return 'immobilisations';
  if (/^61[12]/.test(code)) return 'achats';
  return 'services';
}

/** Payment mode codes of the relevé de déductions (SIMPL-TVA EDI annex 1). */
export const PAYMENT_MODE_CODES: Record<SupplierPaymentMode, number> = {
  especes: 1, cheque: 2, virement: 4, effet: 5, compensation: 6,
  // The DGI list has no card and no cash deposit: 7 "autres", flagged for checking.
  carte: 7, versement: 7,
};
export const PAYMENT_MODE_CODE_LABELS: Record<number, string> = { 1: 'Espèces', 2: 'Chèque', 3: 'Prélèvement', 4: 'Virement', 5: 'Effet', 6: 'Compensation', 7: 'Autres' };

export interface DeductionItem {
  /** One per payment, category and rate. */
  key: string;
  paymentId: string;
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  supplierIf: string;
  supplierIce: string;
  /** The supplier's invoice number (what the relevé asks for). */
  invoiceNumber: string;
  /** Stocky's register number (FF-2026-0001). */
  registerNumber: string;
  invoiceDate: string;
  paymentDate: string;
  mode: SupplierPaymentMode | string;
  modeCode: number;
  description: string;
  category: DeductionCategory;
  rate: number;
  /** HT of the part of the invoice this payment settles (deductible lines only). */
  ht: number;
  /** VAT of that part, less the VAT lost to the cash limits: deductible before the prorata. */
  vat: number;
  /** VAT of that part lost to the cash limits (art. 106-II). */
  cashLoss: number;
  /** Share of the invoice settled by this payment, 0–1. */
  share: number;
  /** Paid in an earlier period and deducted now (art. 101-3°, within one year). */
  late?: boolean;
}

export interface DeductionCategoryLine { category: DeductionCategory; base: number; vat: number; vatAfterProrata: number; items: DeductionItem[] }

export interface DeductionsBlock {
  byCategory: DeductionCategoryLine[];
  byRate: Array<{ rate: number; base: number; vat: number }>;
  totalBase: number;
  /** Before the prorata. */
  totalVat: number;
  prorata: number;
  /** After the prorata: what the return deducts. */
  totalAfterProrata: number;
  /** VAT not deducted because of the prorata (stays a cost). */
  prorataLoss: number;
  cashLoss: number;
  /** VAT of non-deductible lines (art. 106-I) on the invoices paid in the period: not deducted, for information. */
  excludedVat: number;
  items: DeductionItem[];
}

export interface SupplierWithholdingItem {
  paymentId: string; supplierName: string; supplierIf: string; supplierIce: string; invoiceNumber: string; paymentDate: string;
  rate: number; amount: number;
  /** YYYY-MM: the month the amount must be paid over (month after the payment). */
  dueMonth: string;
}

const nextMonth = (day: string) => {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

/** What a supplier payment settles: money paid plus the VAT and IR withheld. */
export const settledBy = (p: Pick<SupplierPayment, 'amount' | 'vat_withheld' | 'ir_withheld'>) => r2((Number(p.amount) || 0) + (Number(p.vat_withheld) || 0) + (Number(p.ir_withheld) || 0));

interface PurchaseInput {
  supplierInvoices: SupplierInvoice[];
  /** Lines by invoice id (invoices whose lines are missing fall back to their header). */
  lines: Map<string, SupplierInvoiceLine[]>;
  payments: SupplierPayment[];
  suppliers: Map<string, Supplier>;
}

/**
 * The deductible VAT each supplier payment carries, split by category and
 * rate. A payment settles `amount + vat_withheld + ir_withheld` of the
 * invoice TTC; its share of each deductible line's VAT is deductible
 * (art. 101-3°), less the VAT the cash limits took away (stored on the
 * payment, art. 106-II), spread over the lines in proportion of their VAT.
 * Shares are capped so that an invoice never deducts more than its VAT.
 */
export function paymentDeductions(input: PurchaseInput, accept: (p: SupplierPayment) => boolean): { items: DeductionItem[]; excludedVat: number; cappedPayments: string[]; headerOnly: string[] } {
  const invoices = new Map(input.supplierInvoices.map(i => [i.id, i]));
  const items: DeductionItem[] = [];
  let excludedVat = 0;
  const cappedPayments: string[] = [];
  const headerOnly = new Set<string>();
  // Cumulative share per invoice, in payment order, over every payment (not only the accepted ones).
  const used = new Map<string, number>();
  const ordered = [...input.payments].sort((a, b) => a.payment_date.localeCompare(b.payment_date) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
  for (const p of ordered) {
    const inv = invoices.get(p.invoice_id);
    if (!inv || inv.status === 'draft' || !(inv.total_ttc > 0)) continue;
    const before = used.get(inv.id) || 0;
    const raw = settledBy(p) / inv.total_ttc;
    const share = Math.max(0, Math.min(raw, 1 - before));
    if (raw - share > 0.00001) cappedPayments.push(p.id);
    used.set(inv.id, before + share);
    if (!accept(p) || share <= 0) continue;

    const supplier = input.suppliers.get(inv.supplier_id);
    let lines = input.lines.get(inv.id) || [];
    if (!lines.length) {
      // No lines read: one line from the header (nature decides the category).
      headerOnly.add(inv.id);
      const rate = inv.total_ht ? Math.round(inv.total_vat / inv.total_ht * 100) : 0;
      lines = [{ position: 0, label: inv.description || '', barcode: null, quantity: null, amount_ht: inv.total_ht, vat_rate: rate, vat_amount: r2(inv.total_vat - inv.total_nondeductible_vat), account_code: inv.nature === 'immobilisation' ? '2' : inv.nature === 'marchandises' ? '6111' : '6136', vat_nondeductible: false }];
    }
    const groups = new Map<string, { category: DeductionCategory; rate: number; ht: number; vat: number }>();
    for (const l of lines) {
      if (l.vat_nondeductible) { excludedVat += (Number(l.vat_amount) || 0) * share; continue; }
      const category = deductionCategory(l.account_code);
      const rate = Number(l.vat_rate) || 0;
      const k = `${category}|${rate}`;
      const g = groups.get(k) || { category, rate, ht: 0, vat: 0 };
      g.ht += (Number(l.amount_ht) || 0) * share;
      g.vat += (Number(l.vat_amount) || 0) * share;
      groups.set(k, g);
    }
    const list = [...groups.values()].sort((a, b) => a.category.localeCompare(b.category) || b.rate - a.rate);
    const totalVat = list.reduce((s, g) => s + g.vat, 0);
    const loss = r2(Number(p.cash_vat_nondeductible) || 0);
    let lossLeft = loss;
    list.forEach((g, i) => {
      const vat = r2(g.vat);
      const part = i === list.length - 1 ? lossLeft : r2(totalVat ? loss * g.vat / totalVat : 0);
      lossLeft = r2(lossLeft - part);
      const lossHere = r2(Math.min(Math.max(0, part), Math.max(0, vat)));
      items.push({
        key: `${p.id}|${g.category}|${g.rate}`, paymentId: p.id, invoiceId: inv.id, supplierId: inv.supplier_id,
        supplierName: supplierDisplayName(supplier), supplierIf: (supplier?.if_number || '').trim(), supplierIce: (supplier?.ice || '').replace(/\s+/g, ''),
        invoiceNumber: inv.supplier_invoice_number, registerNumber: inv.number || '', invoiceDate: inv.invoice_date.slice(0, 10), paymentDate: p.payment_date.slice(0, 10),
        mode: p.mode, modeCode: PAYMENT_MODE_CODES[p.mode as SupplierPaymentMode] ?? 7,
        description: (inv.description || lines.map(l => l.label).filter(Boolean).join(', ') || '').slice(0, 200),
        category: g.category, rate: g.rate, ht: r2(g.ht), vat: r2(vat - lossHere), cashLoss: lossHere, share,
      });
    });
  }
  return { items, excludedVat: r2(excludedVat), cappedPayments, headerOnly: [...headerOnly] };
}

export function deductionsBlock(items: DeductionItem[], prorata: number, excludedVat: number): DeductionsBlock {
  const p = Math.min(100, Math.max(0, Number(prorata) || 0));
  const order: DeductionCategory[] = ['services', 'achats', 'immobilisations'];
  const byCategory = order.map(category => {
    const list = items.filter(i => i.category === category);
    const vat = r2(list.reduce((s, i) => s + i.vat, 0));
    return { category, base: r2(list.reduce((s, i) => s + i.ht, 0)), vat, vatAfterProrata: r2(vat * p / 100), items: list };
  });
  const rates = new Map<number, { rate: number; base: number; vat: number }>();
  for (const i of items) {
    const r = rates.get(i.rate) || { rate: i.rate, base: 0, vat: 0 };
    r.base = r2(r.base + i.ht); r.vat = r2(r.vat + i.vat);
    rates.set(i.rate, r);
  }
  const totalVat = r2(byCategory.reduce((s, c) => s + c.vat, 0));
  const totalAfterProrata = r2(byCategory.reduce((s, c) => s + c.vatAfterProrata, 0));
  return {
    byCategory, byRate: [...rates.values()].sort((a, b) => b.rate - a.rate),
    totalBase: r2(byCategory.reduce((s, c) => s + c.base, 0)), totalVat, prorata: p, totalAfterProrata,
    prorataLoss: r2(totalVat - totalAfterProrata), cashLoss: r2(items.reduce((s, i) => s + i.cashLoss, 0)), excludedVat, items,
  };
}

// ── Credit brought forward ──────────────────────────────────────────────────

export interface SavedDeclaration {
  period: string;
  status: 'draft' | 'filed' | string;
  credit_report?: number | string | null;
  snapshot?: unknown;
}

export interface CreditBroughtForward {
  amount: number;
  source: 'declaration' | 'opening' | 'none';
  /** Period of the declaration it comes from. */
  fromPeriod?: string;
  filed?: boolean;
  /** Periods between that declaration (or the start) and this one with no declaration saved. */
  missing: string[];
  message: string;
}

const periodsBetween = (from: VatPeriod, to: VatPeriod): VatPeriod[] => {
  // Periods strictly after `from` and strictly before `to`, in to's periodicity.
  const out: VatPeriod[] = [];
  let p = previousPeriod(to);
  while (p.end > from.end && out.length < 60) { out.unshift(p); p = previousPeriod(p); }
  return out;
};

/**
 * The credit carried into `period` (art. 101-2°): the credit of the latest
 * saved declaration before it, else the opening credit of the settings when
 * the period is the first one or later. Never read from posted ledger lines.
 */
export function creditBroughtForward(period: VatPeriod, declarations: SavedDeclaration[], settings: Pick<VatSettings, 'openingCredit' | 'startDate'>): CreditBroughtForward {
  const earlier = declarations
    .map(d => ({ d, p: parsePeriodKey(d.period) }))
    .filter((x): x is { d: SavedDeclaration; p: VatPeriod } => !!x.p && x.p.end < period.start && (!settings.startDate || x.p.start >= settings.startDate))
    .sort((a, b) => b.p.end.localeCompare(a.p.end));
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/[\u202f\u00a0]/g, ' ');
  if (earlier.length) {
    const { d, p } = earlier[0];
    const amount = r2(Number(d.credit_report) || 0);
    const missing = periodsBetween(p, period).map(x => x.key);
    const filed = d.status === 'filed';
    return {
      amount, source: 'declaration', fromPeriod: d.period, filed, missing,
      message: `Crédit de la déclaration ${p.label} (${filed ? 'déposée' : 'brouillon, non déposée'}) : ${fmt(amount)} DH.`,
    };
  }
  if (settings.startDate && period.start >= settings.startDate) {
    const start = periodContaining(period.type, settings.startDate);
    const missing = start.key === period.key ? [] : [start, ...periodsBetween(start, period)].map(x => x.key);
    return {
      amount: r2(Number(settings.openingCredit) || 0), source: 'opening', missing,
      message: `Crédit de départ des réglages TVA (au ${settings.startDate.split('-').reverse().join('/')}) : ${fmt(r2(Number(settings.openingCredit) || 0))} DH.`,
    };
  }
  return { amount: 0, source: 'none', missing: [], message: settings.startDate ? 'Période antérieure au début des déclarations dans Stocky : aucun crédit reporté.' : 'Aucune déclaration précédente et pas de crédit de départ dans les réglages TVA.' };
}

// ── The return ──────────────────────────────────────────────────────────────

export type WarningLevel = 'error' | 'warning' | 'info';
export interface VatWarning { level: WarningLevel; code: string; message: string; refs?: string[] }

export interface VatReturnInput {
  period: VatPeriod;
  settings: VatSettings;
  companyRate?: number | null;
  invoices: Quote[];
  avoirs: Quote[];
  supplierInvoices: SupplierInvoice[];
  supplierLines: Map<string, SupplierInvoiceLine[]>;
  supplierPayments: SupplierPayment[];
  suppliers: Supplier[];
  declarations: SavedDeclaration[];
  /** Supplier payments of earlier periods to deduct in this one (art. 101-3°). */
  includeLatePaymentIds?: string[];
  /** Whether supplier invoices could be read (false: migration not run). */
  suppliersAvailable?: boolean;
  today?: string;
}

export interface LatePaymentCandidate { paymentId: string; supplierName: string; invoiceNumber: string; paymentDate: string; vat: number; deadline: string; expired: boolean }

export interface VatReturnResult {
  version: 1;
  period: VatPeriod;
  deadline: { electronic: string; paper: string };
  settings: VatSettings;
  sales: SalesBlock;
  deductions: DeductionsBlock;
  credit: CreditBroughtForward;
  clientWithholdings: { total: number; items: ClientWithholdingItem[] };
  /** VAT due on sales − deductions after prorata − credit brought forward − VAT withheld by clients. */
  net: number;
  toPay: number;
  creditToCarry: number;
  /** Part of the credit the withholding created, refundable on request (art. 103-6°). */
  refundableCredit: number;
  supplierWithholdings: { total: number; items: SupplierWithholdingItem[]; byMonth: Array<{ month: string; amount: number }> };
  latePayments: LatePaymentCandidate[];
  warnings: VatWarning[];
}

/** Payment ids deducted by saved declarations (from their stored lists). */
export function deductedPaymentIds(declarations: SavedDeclaration[], exceptPeriod?: string): Set<string> {
  const out = new Set<string>();
  for (const d of declarations) {
    if (d.period === exceptPeriod) continue;
    const snap = d.snapshot as { result?: { deductions?: { items?: Array<{ paymentId?: string }> } } } | null | undefined;
    for (const i of snap?.result?.deductions?.items || []) if (i?.paymentId) out.add(i.paymentId);
  }
  return out;
}

const addMonthsDay = (day: string, months: number) => {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1 + months;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12 + 1;
  return `${ny}-${pad(nm)}-01`;
};

export function computeVatReturn(input: VatReturnInput): VatReturnResult {
  const { period, settings } = input;
  const warnings: VatWarning[] = [];
  const warn = (level: WarningLevel, code: string, message: string, refs?: string[]) => warnings.push({ level, code, message, ...(refs?.length ? { refs } : {}) });
  const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/[\u202f\u00a0]/g, ' ');

  // Sales
  const { items: saleItems, withholdings } = salesEvents({ invoices: input.invoices, avoirs: input.avoirs, regime: settings.regime, start: period.start, end: period.end, companyRate: input.companyRate });
  const sales = salesBlock(saleItems);

  // Purchases
  const suppliers = new Map(input.suppliers.map(s => [s.id, s]));
  const already = deductedPaymentIds(input.declarations, period.key);
  const late = new Set(input.includeLatePaymentIds || []);
  const startLimit = settings.startDate || '0000-00-00';
  const purchase = { supplierInvoices: input.supplierInvoices, lines: input.supplierLines, payments: input.supplierPayments, suppliers };
  const inPeriod = (p: SupplierPayment) => inRange(p.payment_date.slice(0, 10), period.start, period.end);

  // Earlier payments left out of the saved declaration of their own period
  // (recorded after it was saved): may still be deducted within a year
  // (art. 101-3°). Only declarations that keep their lists (snapshot) tell;
  // a period with no such declaration is reported as missing instead.
  const latePayments: LatePaymentCandidate[] = [];
  const listed = input.declarations.filter(d => d.period !== period.key && d.snapshot).map(d => parsePeriodKey(d.period)).filter((p): p is VatPeriod => !!p);
  if (listed.length) {
    const { items: earlier } = paymentDeductions(purchase, p => {
      const day = p.payment_date.slice(0, 10);
      return day < period.start && day >= startLimit && !already.has(p.id) && listed.some(x => inRange(day, x.start, x.end));
    });
    const byPayment = new Map<string, LatePaymentCandidate>();
    for (const i of earlier) {
      const born = periodContaining(period.type, i.paymentDate);
      // "dans un délai n'excédant pas une année, à compter du mois ou du trimestre de la naissance dudit droit".
      const deadline = addMonthsDay(born.start, 12);
      const c = byPayment.get(i.paymentId) || { paymentId: i.paymentId, supplierName: i.supplierName, invoiceNumber: i.invoiceNumber, paymentDate: i.paymentDate, vat: 0, deadline, expired: period.start >= deadline };
      c.vat = r2(c.vat + i.vat);
      byPayment.set(i.paymentId, c);
    }
    latePayments.push(...[...byPayment.values()].filter(c => c.vat > 0).sort((a, b) => a.paymentDate.localeCompare(b.paymentDate)));
  }
  const lateAllowed = new Set(latePayments.filter(c => !c.expired && late.has(c.paymentId)).map(c => c.paymentId));
  const { items: dItems, excludedVat, cappedPayments, headerOnly } = paymentDeductions(purchase, p => inPeriod(p) || lateAllowed.has(p.id));
  for (const i of dItems) if (lateAllowed.has(i.paymentId)) i.late = true;
  const deductions = deductionsBlock(dItems, settings.prorata, excludedVat);
  if (latePayments.length) {
    if (latePayments.some(c => !c.expired && !late.has(c.paymentId))) {
      warn('warning', 'late_deductions', `${latePayments.filter(c => !c.expired && !late.has(c.paymentId)).length} paiement(s) fournisseur d’une période précédente n’ont été repris dans aucune déclaration enregistrée : leur TVA peut encore être déduite dans l’année (art. 101-3° CGI). Cochez-les pour les inclure.`);
    }
    if (latePayments.some(c => c.expired)) warn('error', 'expired_deductions', 'Des paiements fournisseur de plus d’un an n’ont jamais été déduits : le délai d’un an est dépassé (art. 101-3° CGI).', latePayments.filter(c => c.expired).map(c => `${c.supplierName} ${c.invoiceNumber} (${c.paymentDate})`));
  }

  // Credit and net
  const credit = creditBroughtForward(period, input.declarations, settings);
  const withheldTotal = r2(withholdings.reduce((s, w) => s + w.amount, 0));
  const net = r2(sales.totalVat - deductions.totalAfterProrata - credit.amount - withheldTotal);
  const toPay = net > 0 ? net : 0;
  const creditToCarry = net < 0 ? r2(-net) : 0;
  const refundableCredit = r2(Math.min(creditToCarry, withheldTotal));

  // VAT withheld from suppliers: paid over the month after each payment, apart from the return.
  const invoices = new Map(input.supplierInvoices.map(i => [i.id, i]));
  const sw: SupplierWithholdingItem[] = input.supplierPayments
    .filter(p => inPeriod(p) && (Number(p.vat_withheld) || 0) > 0)
    .map(p => {
      const inv = invoices.get(p.invoice_id);
      const s = inv ? suppliers.get(inv.supplier_id) : undefined;
      return {
        paymentId: p.id, supplierName: supplierDisplayName(s), supplierIf: (s?.if_number || '').trim(), supplierIce: (s?.ice || '').replace(/\s+/g, ''),
        invoiceNumber: inv?.supplier_invoice_number || '', paymentDate: p.payment_date.slice(0, 10), rate: Number(p.vat_withholding_rate) || 0,
        amount: r2(p.vat_withheld), dueMonth: nextMonth(p.payment_date),
      };
    })
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  const months = new Map<string, number>();
  for (const i of sw) months.set(i.dueMonth, r2((months.get(i.dueMonth) || 0) + i.amount));

  // ── Warnings ──
  if (input.suppliersAvailable === false) {
    warn('error', 'suppliers_missing', 'Les factures fournisseurs ne sont pas installées (migration 20261126120000_supplier_invoices.sql) : la TVA déductible est comptée à zéro.');
  }
  const drafts = input.invoices.filter(q => (q.document_type ?? 'invoice') === 'invoice' && q.status === 'draft');
  const draftPaid = drafts.flatMap(q => invoiceSettlements(q).filter(s => s.amount > 0 && inRange(s.date, period.start, period.end)).map(s => ({ q, s })));
  if (draftPaid.length) {
    const vat = r2(draftPaid.reduce((t, { q, s }) => t + split(s.amount, documentTvaRate(q, input.companyRate)).vat, 0));
    warn('error', 'draft_paid', `${new Set(draftPaid.map(x => x.q.id)).size} facture(s) en brouillon ont reçu des règlements sur la période : elles ne sont pas comptées. Finalisez-les : la TVA de ces règlements (${fmt(vat)} DH) est due dès l’encaissement (art. 95 CGI).`, [...new Set(draftPaid.map(x => `${isProvisionalNumber(x.q.quoteNumber) ? 'Brouillon' : x.q.quoteNumber} — ${x.q.customer?.fullName || ''}`))]);
  }
  // Art. 125-III: money received from 1 January 2026 for sales fully performed
  // and invoiced before keeps the tax regime of the day they were performed,
  // so a 2025 invoice at 14 % stays at 14 % when paid in 2026 (125-IV: list of
  // debtors at 31 December to send before 1 March). A document dated in 2026
  // at a rate that no longer exists is an error.
  const REFORM_DAY = '2026-01-01';
  const oldBefore = new Set<string>(), oldAfter = new Set<string>();
  for (const i of saleItems.filter(x => !isLegalTvaRate(x.rate))) ((i.invoiceDate && i.invoiceDate < REFORM_DAY) ? oldBefore : oldAfter).add(`${i.number} (${i.rate} %)`);
  for (const i of dItems.filter(x => !isLegalTvaRate(x.rate))) (i.invoiceDate < REFORM_DAY ? oldBefore : oldAfter).add(`${i.supplierName} ${i.invoiceNumber} (${i.rate} %)`);
  if (oldBefore.size) warn('info', 'old_rate', 'Factures d’avant 2026 à un ancien taux, encaissées ou payées sur la période : comptées à leur propre taux, sur une ligne à part (art. 125-III CGI : régime applicable à la date d’exécution).', [...oldBefore]);
  if (oldAfter.size) warn('error', 'old_rate_2026', 'Documents datés de 2026 à un taux qui n’existe plus (seuls 20 % et 10 % restent, art. 99 CGI) : corrigez leur taux. Comptés pour l’instant à ce taux, sur une ligne à part.', [...oldAfter]);
  const unrated = [...new Set(saleItems.filter(i => i.kind !== 'avoir').map(i => input.invoices.find(q => q.id === i.docId)).filter((q): q is Quote => !!q && (q.tva_rate === undefined || q.tva_rate === null)).map(q => q.quoteNumber))];
  if (unrated.length) warn('warning', 'rate_not_stored', 'Factures sans taux de TVA enregistré : le taux actuel de la société a été appliqué.', unrated);
  const undated = [...new Set(saleItems.filter(i => i.kind === 'encaissement' || i.kind === 'retenue' || i.kind === 'avance').flatMap(i => {
    const q = input.invoices.find(x => x.id === i.docId);
    return q && invoiceSettlements(q).some(s => !s.dated && s.date === i.date) ? [q.quoteNumber] : [];
  }))];
  if (settings.regime === 'encaissement' && undated.length) warn('warning', 'undated_settlements', 'Règlements enregistrés sans date propre : datés du paiement de la facture, ou de la facture. Vérifiez la date réelle d’encaissement.', undated);
  const noMethod = [...new Set(saleItems.filter(i => (i.kind === 'encaissement' || i.kind === 'avance') && !(i.method || '').trim()).map(i => i.number))];
  if (noMethod.length) warn('warning', 'customer_mode_unknown', 'Règlements clients sans mode de paiement.', noMethod);
  const setOff = [...new Set(saleItems.filter(i => /compens/i.test(i.method || '')).map(i => i.number))];
  if (setOff.length && settings.regime === 'encaissement') warn('warning', 'customer_setoff', 'Règlements par compensation : la TVA est due à la livraison, ou à la date du document de compensation signé, et non à l’encaissement (art. 95 CGI). Vérifiez la période.', setOff);
  const orphanCredits = saleItems.filter(i => i.kind === 'avoir' && !i.invoiceNumber).map(i => i.number);
  if (orphanCredits.length) warn('info', 'credit_without_invoice', 'Avoirs sans facture d’origine retrouvée : déduits en totalité sur leur période.', orphanCredits);

  const missingIds = [...new Set(deductions.items.filter(i => Math.abs(i.vat) >= 0.005 && (!i.supplierIf || !i.supplierIce)).map(i => `${i.supplierName}${!i.supplierIf ? ' (IF manquant)' : ''}${!i.supplierIce ? ' (ICE manquant)' : ''}`))];
  if (missingIds.length) warn('error', 'supplier_ids', 'Fournisseurs sans identifiant fiscal ou sans ICE : le relevé de déductions les exige (art. 112-II CGI).', missingIds);
  const otherMode = [...new Set(deductions.items.filter(i => i.modeCode === 7).map(i => `${i.supplierName} ${i.invoiceNumber} (${i.mode})`))];
  if (otherMode.length) warn('warning', 'supplier_mode_other', 'Paiements fournisseur dont le mode n’a pas de code DGI (carte, versement en compte) : déclarés en « 7 – autres ». Vérifiez.', otherMode);
  if (deductions.cashLoss > 0) warn('warning', 'cash_loss', `TVA non déductible car payée hors moyens justifiés au-delà des plafonds (art. 106-II CGI) : ${fmt(deductions.cashLoss)} DH, déjà retirée des déductions.`, [...new Set(deductions.items.filter(i => i.cashLoss > 0).map(i => `${i.supplierName} ${i.invoiceNumber} (${i.paymentDate})`))]);
  if (deductions.excludedVat > 0) warn('info', 'nondeductible_lines', `TVA des lignes non déductibles (art. 106-I CGI) sur les factures payées : ${fmt(deductions.excludedVat)} DH, non déduite.`);
  if (deductions.prorata < 100) warn('info', 'prorata', `Prorata de ${deductions.prorata} % : ${fmt(deductions.prorataLoss)} DH de TVA ne sont pas déduits (art. 104 CGI) et restent une charge.`);
  if (cappedPayments.length) warn('warning', 'overpaid', 'Paiements fournisseur au-delà du total de la facture : la part en trop ne donne pas de TVA à déduire.', cappedPayments);
  if (headerOnly.length) warn('warning', 'lines_missing', 'Factures fournisseur sans lignes lues : TVA déduite d’après leur en-tête.', headerOnly.map(id => invoices.get(id)?.supplier_invoice_number || id));
  if (credit.missing.length) warn('warning', 'missing_periods', `Périodes sans déclaration enregistrée avant celle-ci : ${credit.missing.join(', ')}. Le crédit reporté suppose qu’elles n’ont rien changé.`);
  if (credit.source === 'declaration' && credit.filed === false) warn('warning', 'previous_not_filed', 'Le crédit reporté vient d’une déclaration encore en brouillon.');
  if (refundableCredit > 0) warn('info', 'refundable', `Crédit issu de la TVA retenue à la source par vos clients : ${fmt(refundableCredit)} DH remboursables sur demande (art. 103-6° CGI), à défaut reportés.`);

  return {
    version: 1, period, deadline: filingDeadline(period), settings: { ...settings },
    sales, deductions, credit,
    clientWithholdings: { total: withheldTotal, items: withholdings },
    net, toPay, creditToCarry, refundableCredit,
    supplierWithholdings: { total: r2(sw.reduce((s, i) => s + i.amount, 0)), items: sw, byMonth: [...months].map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month)) },
    latePayments, warnings,
  };
}

// ── Ledger comparison ───────────────────────────────────────────────────────

export interface LedgerLine { account_code: string; debit: number | string; credit: number | string; entry_date?: string | null; source_id?: string | null }

export interface LedgerComparison {
  /** Credit − debit on 4455… in the period (VAT invoiced as booked). */
  collected: number;
  /** Debit − credit on 34551 / 34552 / other 3455… in the period (VAT recoverable as booked). */
  recoverableAssets: number;
  recoverableCharges: number;
  recoverable: number;
  /** Debit − credit on 34581 in the period. */
  withheldByClients: number;
}

/** Movements of the VAT accounts in the period, the return's own OD entries left out. */
export function ledgerComparison(lines: LedgerLine[], period: Pick<VatPeriod, 'start' | 'end'>): LedgerComparison {
  let collected = 0, assets = 0, charges = 0, withheld = 0;
  for (const l of lines) {
    const d = String(l.entry_date || '').slice(0, 10);
    if (!d || d < period.start || d > period.end || String(l.source_id || '').startsWith('tva:')) continue;
    const code = String(l.account_code || '');
    const dr = Number(l.debit) || 0, cr = Number(l.credit) || 0;
    if (code.startsWith('4455')) collected += cr - dr;
    else if (code.startsWith('34551')) assets += dr - cr;
    else if (code.startsWith('34581')) withheld += dr - cr;
    else if (code.startsWith('3455')) charges += dr - cr;
  }
  return { collected: r2(collected), recoverableAssets: r2(assets), recoverableCharges: r2(charges), recoverable: r2(assets + charges), withheldByClients: r2(withheld) };
}

// ── OD entry ────────────────────────────────────────────────────────────────

export interface VatEntryLine { account_code: string; label: string; debit: number; credit: number }

/**
 * The OD entry of the return, to keep as a draft:
 *   D 4455  VAT due on the period's sales (C when credit notes exceed it)
 *   C 34551 deductible VAT on assets, after prorata
 *   C 34552 deductible VAT on goods and services, after prorata
 *   C 34581 VAT withheld by clients, set against the VAT due
 *   C 3456  credit brought forward from the previous return
 *   C 4456  VAT to pay   — or —   D 3456 credit to carry forward
 * On a cash basis, 4455 keeps the VAT of invoices not yet collected (it was
 * booked at invoicing); 3455 keeps the VAT of supplier invoices not yet paid
 * and the VAT the prorata or the cash limits made non-deductible, which the
 * accountant moves to a cost account by hand.
 */
export function buildVatEntryLines(r: Pick<VatReturnResult, 'sales' | 'deductions' | 'credit' | 'clientWithholdings' | 'toPay' | 'creditToCarry'>): VatEntryLine[] {
  const lines: VatEntryLine[] = [];
  const add = (account_code: string, label: string, amount: number, side: 'debit' | 'credit') => {
    const a = r2(amount);
    if (Math.abs(a) < 0.005) return;
    const pos = a > 0 ? side : side === 'debit' ? 'credit' : 'debit';
    lines.push({ account_code, label, debit: pos === 'debit' ? Math.abs(a) : 0, credit: pos === 'credit' ? Math.abs(a) : 0 });
  };
  add('4455', 'TVA exigible de la période', r.sales.totalVat, 'debit');
  const assets = r.deductions.byCategory.find(c => c.category === 'immobilisations')?.vatAfterProrata || 0;
  const others = r2(r.deductions.totalAfterProrata - assets);
  add('34551', 'TVA déductible sur immobilisations', assets, 'credit');
  add('34552', 'TVA déductible sur achats et services', others, 'credit');
  add('34581', 'TVA retenue à la source par les clients', r.clientWithholdings.total, 'credit');
  add('3456', 'Crédit de TVA reporté', r.credit.amount, 'credit');
  if (r.toPay > 0) add('4456', 'TVA due', r.toPay, 'credit');
  if (r.creditToCarry > 0) add('3456', 'Crédit de TVA à reporter', r.creditToCarry, 'debit');
  const d = r2(lines.reduce((s, l) => s + l.debit, 0)), c = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(d - c) > 0.005) throw new Error(`Écriture de TVA déséquilibrée (débit ${d}, crédit ${c}).`);
  return lines;
}
