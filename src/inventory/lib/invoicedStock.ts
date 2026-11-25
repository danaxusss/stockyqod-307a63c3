// Invoiced stock (stock facturé): the stock a company's invoices give, per
// product, at the end of a day. Pure functions, no database access.
//
//     invoiced = opening
//              + quantities on the supplier invoices (validated, goods lines)
//              − quantities on the sales invoices the company issued
//              + quantities the company's credit notes take back as goods
//
// counting only documents dated after the opening date and on or before the
// day. It is set next to the real stock at that day (stockValuation.ts, the
// company's locations) and the gap is
//
//     gap = real − invoiced
//
// so a POSITIVE gap means goods in the warehouse that the invoices do not
// show: received but not (yet) on a validated supplier invoice, or already
// invoiced to a client but not delivered yet. A NEGATIVE gap is the reverse:
// on a supplier invoice but not received yet, or delivered to a client but
// not invoiced yet. Stock counts and adjustments move the real stock only,
// so they show up in the gap too.
//
// SALES are attributed to the company that ISSUED the invoice
// (issuing_company_id, else the owning company), as the ledger does
// (SupabaseDocumentsService.getForLedger): it is that company's turnover and
// its books. Drafts (status 'draft', number BROUILLON-…) were never issued.
//
// CREDIT NOTES. A credit note created from an invoice copies the invoice
// lines with the quantities credited; nothing in the credit note itself says
// whether the goods came back or the client was only given a price
// reduction (both are typed the same way, the reason is free text). The one
// fact the data holds is whether the credit note was put back in stock
// ("Remettre en stock": a 'return' stock movement whose source is the credit
// note, per product). So:
//   • a line whose product was put back in stock by that credit note counts
//     as goods returned;
//   • a credit note without lines (a standalone credit note, an amount
//     only) is a price reduction: never counted;
//   • product lines not put back in stock are ambiguous (a price reduction,
//     or a return whose goods have not been put back yet): listed apart and
//     left out, unless the caller asks to count them as returns.
//
// Lines without a catalogue product (typed by hand) cannot be counted: they
// are totalled apart. Supplier credit notes (returns to a supplier) do not
// exist in Stocky yet: nothing reduces the quantities bought.

import { documentDay, documentTvaRate, isProvisionalNumber, toHT } from '../../utils/documentLines';
import { isGoodsAccount } from '../../accounting/supplierInvoices';
import type { StockLine } from './stockValuation';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
// Quantities are summed with a little care for 0.1 + 0.2.
const clean = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Inputs ───────────────────────────────────────────────────────────────

/** The starting point of the count: quantities per product at the end of `asOf`. */
export interface InvoicedOpening {
  asOf: string;
  quantities: Map<string, number>;
  savedAt?: string | null;
  savedBy?: string | null;
}

export interface PurchaseLineInput {
  barcode: string | null;
  quantity: number | null;
  amount_ht?: number;
  account_code: string;
  label?: string;
}

export interface PurchaseInvoiceInput {
  id: string;
  company_id: string | null;
  /** Internal register number (FF-2026-0001), null for a draft. */
  number: string | null;
  supplier_invoice_number: string;
  supplierName?: string;
  invoice_date: string;
  status: string;
  lines: PurchaseLineInput[];
}

export interface SalesItemInput {
  id?: string;
  quantity: number;
  subtotal: number;
  quoteBarcode?: string;
  quoteName?: string;
  product?: { barcode?: string | null; name?: string | null } | null;
}

/** An invoice or a credit note (rows of `quotes`). */
export interface SalesDocInput {
  id: string;
  quoteNumber: string;
  document_type?: string;
  status: string;
  issuing_company_id?: string | null;
  company_id?: string | null;
  quote_date?: string;
  createdAt: Date | string;
  customer?: { fullName?: string } | null;
  tva_rate?: number | string | null;
  parent_document_id?: string | null;
  /** Total including VAT (a credit note without lines has only this). */
  totalAmount?: number;
  items: SalesItemInput[];
}

export interface ReconcileInput {
  companyId: string;
  /** End of this day (YYYY-MM-DD). */
  day: string;
  opening: InvoicedOpening | null;
  purchases: PurchaseInvoiceInput[];
  /** Sales invoices and credit notes; other documents are ignored. */
  sales: SalesDocInput[];
  /** `returnKey(creditNoteId, barcode)` of the products each credit note put back in stock. */
  returnedToStock: Set<string>;
  /** Count the product lines of credit notes not put back in stock as returns too. */
  countUnreturnedCredits?: boolean;
  /** Real stock at the day over the company's locations (stockValuation.buildStockStatement). */
  real: StockLine[];
  /** VAT rate of documents saved before the rate was frozen on them. */
  companyVatRate?: number;
}

export const returnKey = (creditNoteId: string, barcode: string) => `${creditNoteId}|${barcode}`;

// ── Output ───────────────────────────────────────────────────────────────

export interface ReconLine {
  barcode: string;
  name: string;
  brand: string;
  opening: number;
  bought: number;
  sold: number;
  returned: number;
  /** opening + bought − sold + returned. */
  invoiced: number;
  real: number;
  /** real − invoiced. */
  gap: number;
  /** Unit cost excluding VAT at the day (the Stock comptable cost). */
  unitCost: number;
  /** Values are signed (a negative quantity gives a negative value). */
  invoicedValue: number;
  realValue: number;
  gapValue: number;
  /** The unit cost at the day could not be rebuilt: current average cost. */
  currentCost: boolean;
  /** The reference is not (any more) in the catalogue. */
  inCatalogue: boolean;
}

export type DocKind = 'purchase' | 'sale' | 'return';

export interface DocRef {
  kind: DocKind;
  id: string;
  number: string;
  date: string;
  /** Supplier or client. */
  party: string;
  /** Always positive; the kind gives the direction. */
  quantity: number;
}

export interface UncountedLine {
  kind: 'sale' | 'credit';
  documentId: string;
  number: string;
  date: string;
  label: string;
  quantity: number;
  amountHt: number;
}

export interface CreditNoteNote {
  id: string;
  number: string;
  date: string;
  party: string;
  /** Product lines of the note that were not put back in stock. */
  lines: number;
  quantity: number;
  amountHt: number;
}

export interface Reconciliation {
  lines: ReconLine[];
  /** Documents counted, per barcode, oldest first. */
  docs: Map<string, DocRef[]>;
  uncounted: {
    saleLines: number;
    saleAmountHt: number;
    creditLines: number;
    creditAmountHt: number;
    items: UncountedLine[];
  };
  creditNotes: {
    /** Credit notes with at least one line counted as goods returned. */
    counted: number;
    /** Product lines not put back in stock (left out unless countUnreturnedCredits). */
    unreturned: CreditNoteNote[];
    /** Credit notes without any line (an amount only): price reductions, never counted. */
    withoutGoods: CreditNoteNote[];
  };
  /** Documents that entered the count. */
  counted: { purchaseInvoices: number; salesInvoices: number; creditNotes: number };
  /** The opening applies (the day is on or after its date). */
  hasOpening: boolean;
  /** The day is before the opening date: the count is not defined there. */
  beforeOpening: boolean;
}

/** Barcode of a sales line: the one printed, else the product's (documentLines' rule). */
export function salesLineBarcode(item: SalesItemInput): string {
  return (item.quoteBarcode || item.product?.barcode || '').trim();
}

/** The company whose books the document belongs to. */
export function issuerOf(doc: Pick<SalesDocInput, 'issuing_company_id' | 'company_id'>): string | null {
  return doc.issuing_company_id || doc.company_id || null;
}

/** An issued sales invoice (finalised or settled), not a draft. */
export function isIssuedInvoice(doc: Pick<SalesDocInput, 'document_type' | 'status' | 'quoteNumber'>): boolean {
  return doc.document_type === 'invoice' && doc.status !== 'draft' && !isProvisionalNumber(doc.quoteNumber);
}

const salesDay = (doc: SalesDocInput) => documentDay({ quote_date: doc.quote_date, createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt) });

/**
 * The reconciliation at the end of `day`: one line per product that has an
 * opening, a document, or real stock.
 */
export function buildInvoicedStock(input: ReconcileInput): Reconciliation {
  const { companyId, day, opening } = input;
  const beforeOpening = !!opening && day < opening.asOf;
  const hasOpening = !!opening && !beforeOpening;
  const from = hasOpening ? opening!.asOf : null; // documents dated on or before it are in the opening
  const inWindow = (d: string) => !!d && d <= day && (from === null || d > from);

  const realBy = new Map(input.real.map(l => [l.barcode, l]));
  const acc = new Map<string, { opening: number; bought: number; sold: number; returned: number; label?: string }>();
  const get = (barcode: string) => {
    let a = acc.get(barcode);
    if (!a) { a = { opening: 0, bought: 0, sold: 0, returned: 0 }; acc.set(barcode, a); }
    return a;
  };
  const docs = new Map<string, DocRef[]>();
  const addDoc = (barcode: string, ref: DocRef) => {
    const list = docs.get(barcode);
    const same = list?.find(d => d.kind === ref.kind && d.id === ref.id);
    if (same) same.quantity = clean(same.quantity + ref.quantity);
    else if (list) list.push(ref); else docs.set(barcode, [ref]);
  };
  const counted = { purchaseInvoices: 0, salesInvoices: 0, creditNotes: 0 };
  const uncounted: Reconciliation['uncounted'] = { saleLines: 0, saleAmountHt: 0, creditLines: 0, creditAmountHt: 0, items: [] };
  const unreturned: CreditNoteNote[] = [];
  const withoutGoods: CreditNoteNote[] = [];

  if (hasOpening) for (const [barcode, q] of opening!.quantities) if (num(q) !== 0) get(barcode).opening = clean(num(q));

  if (!beforeOpening) {
    for (const inv of input.purchases) {
      if (inv.status === 'draft' || inv.company_id !== companyId) continue;
      const date = (inv.invoice_date || '').slice(0, 10);
      if (!inWindow(date)) continue;
      let any = false;
      for (const l of inv.lines || []) {
        const barcode = (l.barcode || '').trim();
        const q = num(l.quantity);
        if (!isGoodsAccount(l.account_code) || !barcode || q === 0) continue;
        const a = get(barcode);
        a.bought = clean(a.bought + q);
        a.label ??= l.label;
        addDoc(barcode, { kind: 'purchase', id: inv.id, number: inv.number || inv.supplier_invoice_number, date, party: inv.supplierName || '', quantity: q });
        any = true;
      }
      if (any) counted.purchaseInvoices += 1;
    }

    for (const doc of input.sales) {
      if (issuerOf(doc) !== companyId) continue;
      const isInvoice = isIssuedInvoice(doc);
      const isCredit = doc.document_type === 'avoir' && doc.status !== 'draft';
      if (!isInvoice && !isCredit) continue;
      const date = salesDay(doc);
      if (!inWindow(date)) continue;
      const rate = documentTvaRate(doc, input.companyVatRate);
      const party = doc.customer?.fullName || '';
      const ht = (item: SalesItemInput) => r2(toHT(num(item.subtotal), rate));
      let any = false;
      const left: CreditNoteNote = { id: doc.id, number: doc.quoteNumber, date, party, lines: 0, quantity: 0, amountHt: 0 };
      let productLines = 0;
      let otherLines = 0;
      for (const item of doc.items || []) {
        const q = num(item.quantity);
        const barcode = salesLineBarcode(item);
        if (!barcode || !realBy.has(barcode)) {
          // Typed by hand (or a code that is not in the catalogue): no product to count.
          if (q === 0 && num(item.subtotal) === 0) continue;
          otherLines += 1;
          const line: UncountedLine = { kind: isInvoice ? 'sale' : 'credit', documentId: doc.id, number: doc.quoteNumber, date, label: item.quoteName || item.product?.name || barcode || 'Ligne libre', quantity: q, amountHt: ht(item) };
          uncounted.items.push(line);
          if (isInvoice) { uncounted.saleLines += 1; uncounted.saleAmountHt = r2(uncounted.saleAmountHt + line.amountHt); }
          else { uncounted.creditLines += 1; uncounted.creditAmountHt = r2(uncounted.creditAmountHt + line.amountHt); }
          continue;
        }
        if (q === 0) continue;
        productLines += 1;
        if (isInvoice) {
          const a = get(barcode);
          a.sold = clean(a.sold + q);
          addDoc(barcode, { kind: 'sale', id: doc.id, number: doc.quoteNumber, date, party, quantity: q });
          any = true;
          continue;
        }
        const back = input.returnedToStock.has(returnKey(doc.id, barcode));
        if (!back) { left.lines += 1; left.quantity = clean(left.quantity + q); left.amountHt = r2(left.amountHt + ht(item)); }
        if (back || input.countUnreturnedCredits) {
          const a = get(barcode);
          a.returned = clean(a.returned + q);
          addDoc(barcode, { kind: 'return', id: doc.id, number: doc.quoteNumber, date, party, quantity: q });
          any = true;
        }
      }
      if (isCredit) {
        // No line at all: an amount credited, i.e. a price reduction.
        if (productLines === 0 && otherLines === 0) withoutGoods.push({ ...left, amountHt: r2(toHT(num(doc.totalAmount), rate)) });
        else if (left.lines > 0) unreturned.push(left);
      }
      if (any) counted[isInvoice ? 'salesInvoices' : 'creditNotes'] += 1;
    }
  }

  // Every product of the catalogue with stock or a document, plus references
  // that appear on documents only (deleted from the catalogue since).
  const barcodes = new Set<string>([...acc.keys()]);
  for (const l of input.real) if (l.quantity !== 0) barcodes.add(l.barcode);
  const lines: ReconLine[] = [];
  for (const barcode of barcodes) {
    const a = acc.get(barcode) || { opening: 0, bought: 0, sold: 0, returned: 0 };
    const r = realBy.get(barcode);
    const invoiced = clean(a.opening + a.bought - a.sold + a.returned);
    const real = r ? r.quantity : 0;
    const gap = clean(real - invoiced);
    const unitCost = r ? r.unitCost : 0;
    lines.push({
      barcode,
      name: r?.name || a.label || barcode,
      brand: r?.brand || '',
      opening: a.opening, bought: a.bought, sold: a.sold, returned: a.returned,
      invoiced, real, gap, unitCost,
      invoicedValue: r2(invoiced * unitCost),
      realValue: r2(real * unitCost),
      gapValue: r2(gap * unitCost),
      currentCost: !!r?.currentCost,
      inCatalogue: !!r,
    });
  }
  lines.sort((x, y) => x.name.localeCompare(y.name, 'fr') || x.barcode.localeCompare(y.barcode));
  for (const list of docs.values()) list.sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));
  uncounted.items.sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));

  return { lines, docs, uncounted, creditNotes: { counted: counted.creditNotes, unreturned, withoutGoods }, counted, hasOpening, beforeOpening };
}

/**
 * Who may see the invoiced stock: those who read supplier invoices (the
 * database's stocky_is_purchase_staff). Resellers are refused before this,
 * with every purchase price.
 */
export function canSeeInvoicedStock(a: { isSuperAdmin?: boolean; isAdmin?: boolean; isCompta?: boolean; isFacturation?: boolean }): boolean {
  return !!(a.isSuperAdmin || a.isAdmin || a.isCompta || a.isFacturation);
}

// ── Totals and filters ───────────────────────────────────────────────────

export interface ReconTotals {
  references: number;
  gapLines: number;
  opening: number;
  bought: number;
  sold: number;
  returned: number;
  invoiced: number;
  real: number;
  gap: number;
  invoicedValue: number;
  realValue: number;
  gapValue: number;
}

export function reconTotals(lines: ReconLine[]): ReconTotals {
  const t: ReconTotals = { references: lines.length, gapLines: 0, opening: 0, bought: 0, sold: 0, returned: 0, invoiced: 0, real: 0, gap: 0, invoicedValue: 0, realValue: 0, gapValue: 0 };
  for (const l of lines) {
    if (l.gap !== 0) t.gapLines += 1;
    t.opening += l.opening; t.bought += l.bought; t.sold += l.sold; t.returned += l.returned;
    t.invoiced += l.invoiced; t.real += l.real; t.gap += l.gap;
    t.invoicedValue += l.invoicedValue; t.realValue += l.realValue; t.gapValue += l.gapValue;
  }
  for (const k of ['opening', 'bought', 'sold', 'returned', 'invoiced', 'real', 'gap'] as const) t[k] = clean(t[k]);
  for (const k of ['invoicedValue', 'realValue', 'gapValue'] as const) t[k] = r2(t[k]);
  return t;
}

export interface ReconFilter { onlyGaps?: boolean; search?: string; brand?: string }

export function filterRecon(lines: ReconLine[], f: ReconFilter): ReconLine[] {
  const terms = (f.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return lines.filter(l => (!f.onlyGaps || l.gap !== 0)
    && (!f.brand || l.brand === f.brand)
    && terms.every(t => `${l.barcode} ${l.name} ${l.brand}`.toLowerCase().includes(t)));
}

export function brandsOf(lines: ReconLine[]): string[] {
  return [...new Set(lines.map(l => l.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}

// ── Opening ──────────────────────────────────────────────────────────────

export interface OpeningLine { barcode: string; quantity: number }

/** The real stock at the opening date, proposed as the opening: every non-zero quantity. */
export function proposeOpening(real: Pick<StockLine, 'barcode' | 'quantity'>[]): OpeningLine[] {
  return real.filter(l => l.quantity !== 0).map(l => ({ barcode: l.barcode, quantity: clean(l.quantity) }))
    .sort((a, b) => a.barcode.localeCompare(b.barcode));
}

/** Problems that stop an opening from being saved, in French. */
export function openingErrors(asOf: string, lines: OpeningLine[], today?: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) out.push('Indiquez la date de l’ouverture.');
  else if (today && asOf > today) out.push('La date de l’ouverture ne peut pas être dans le futur.');
  const seen = new Set<string>();
  for (const l of lines) {
    const b = (l.barcode || '').trim();
    if (!b) { out.push('Une ligne n’a pas de référence.'); continue; }
    if (!Number.isFinite(Number(l.quantity))) out.push(`${b} : quantité invalide.`);
    if (seen.has(b)) out.push(`${b} : référence en double.`);
    seen.add(b);
  }
  return out;
}

/** The lines to save: trimmed, zero quantities dropped (no opening means zero). */
export function openingPayload(lines: OpeningLine[]): OpeningLine[] {
  return lines.map(l => ({ barcode: l.barcode.trim(), quantity: clean(Number(l.quantity)) })).filter(l => l.barcode && l.quantity !== 0);
}

export interface CsvProblem { line: number; text: string; reason: string }

/**
 * An opening typed in a spreadsheet: one "reference;quantity" per line
 * (tab also accepted, decimal comma or point, a header line skipped).
 * Lines that cannot be read are reported with their line number and not
 * imported; the first line of a reference wins over a repeat.
 */
export function parseOpeningCsv(text: string, known?: Set<string>): { lines: OpeningLine[]; problems: CsvProblem[] } {
  const lines: OpeningLine[] = [];
  const problems: CsvProblem[] = [];
  const seen = new Set<string>();
  const unquote = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"').trim();
  const rows = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  rows.forEach((raw, i) => {
    const n = i + 1;
    if (!raw.trim()) return;
    const sep = raw.includes(';') ? ';' : raw.includes('\t') ? '\t' : null;
    if (!sep) { problems.push({ line: n, text: raw, reason: 'séparateur « ; » manquant' }); return; }
    const cells = raw.split(sep).map(unquote);
    const barcode = cells[0] || '';
    const qtyText = (cells[1] || '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    const isNumber = /^-?\d+(\.\d+)?$/.test(qtyText);
    if (lines.length === 0 && problems.length === 0 && !isNumber && /r[ée]f|code|article|quantit|qt/i.test(raw)) return; // header
    if (!barcode) { problems.push({ line: n, text: raw, reason: 'référence vide' }); return; }
    if (!isNumber) { problems.push({ line: n, text: raw, reason: 'quantité illisible' }); return; }
    if (cells.slice(2).some(c => c !== '')) { problems.push({ line: n, text: raw, reason: 'plus de deux colonnes' }); return; }
    if (known && !known.has(barcode)) { problems.push({ line: n, text: raw, reason: 'référence inconnue du catalogue' }); return; }
    if (seen.has(barcode)) { problems.push({ line: n, text: raw, reason: 'référence déjà importée plus haut' }); return; }
    seen.add(barcode);
    lines.push({ barcode, quantity: clean(Number(qtyText)) });
  });
  return { lines, problems };
}
