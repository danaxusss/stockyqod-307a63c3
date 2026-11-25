// Supplier invoices (factures fournisseurs): the data model and the pure rules
// the pages, the ledger and the declarations share. No database access here.
//
// Amounts: every line is entered EXCLUDING VAT (HT) with its own rate, as the
// supplier's invoice prints it. Purchase costs elsewhere in Stocky
// (products.buyprice, reception unit costs, purchase order lines) are stored
// INCLUDING VAT, so lines prefilled from a purchase order or a reception are
// converted with ttcToHt().
//
// A line booked to a goods purchase account (6111…) must name the product
// (barcode) and the quantity: the quantities bought on invoices can then be
// counted per product (the "invoiced stock").

export type SupplierLegalType = 'societe' | 'personne_physique';

export interface Supplier {
  id: string;
  company_id: string | null;
  /** Company name, or the family name of a person (personne physique). */
  name: string;
  /** First name of a person; empty for a company. */
  first_name?: string | null;
  legal_type: SupplierLegalType;
  ice?: string | null;
  if_number?: string | null;
  rc?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Agreed payment delay in days (loi 69-21: 60 when nothing is agreed, 120 at most). */
  payment_days: number;
  /** Date of the attestation de régularité fiscale (valid six months, CGI art. 117-IV). */
  tax_certificate_date?: string | null;
  notes?: string | null;
  provider_id?: string | null;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type SupplierInvoiceNature = 'marchandises' | 'immobilisation' | 'services';
export type SupplierInvoiceStatus = 'draft' | 'validated' | 'partial' | 'paid';
/** 'legal': no delay agreed, 60 days; 'agreed': delay agreed in writing, 120 days at most. */
export type DueKind = 'legal' | 'agreed';

export interface SupplierInvoiceLine {
  id?: string;
  invoice_id?: string;
  position: number;
  label: string;
  barcode: string | null;
  quantity: number | null;
  amount_ht: number;
  vat_rate: number;
  vat_amount: number;
  account_code: string;
  /** VAT that may not be deducted (passenger cars, gifts, receptions…): it joins the cost. */
  vat_nondeductible: boolean;
}

export interface SupplierInvoice {
  id: string;
  company_id: string | null;
  supplier_id: string;
  /** Internal register number (FF-2026-0001), given at validation. */
  number: string | null;
  supplier_invoice_number: string;
  invoice_date: string;
  reception_date: string | null;
  /** Delivery of the goods or end of the work (loi 69-21: invoiced late, the delay runs from the end of that month). */
  delivery_date: string | null;
  due_date: string;
  due_kind: DueKind;
  nature: SupplierInvoiceNature;
  /** Works (travaux): VAT withheld like equipment goods when the attestation is missing (art. 117-IV). */
  is_works: boolean;
  description: string | null;
  status: SupplierInvoiceStatus;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  total_nondeductible_vat: number;
  /** Settled so far: cash paid plus VAT and IR/IS withheld (maintained by the database). */
  paid_amount: number;
  /** IR/IS withheld at source on fees (art. 15 bis, 73-II-B-8°, 19-IV-A): rate in %, decided by the accountant. */
  ir_rate: number | null;
  ir_amount: number;
  /** Part of the invoice in a court dispute (loi 69-21: no fine on it while the case runs). */
  litigation_amount: number | null;
  litigation_date: string | null;
  judgment_amount: number | null;
  judgment_date: string | null;
  /** Some cash payment of this invoice is above the legal cash limits (art. 11-II, 106-II). */
  cash_over_limit: boolean;
  source_po_id: string | null;
  source_receipt_id: string | null;
  notes: string | null;
  created_by: string | null;
  validated_by?: string | null;
  validated_at?: string | null;
  created_at?: string;
  updated_at?: string;
  lines?: SupplierInvoiceLine[];
}

export type SupplierPaymentMode = 'virement' | 'cheque' | 'effet' | 'carte' | 'especes' | 'versement' | 'compensation';

export interface SupplierPayment {
  id: string;
  company_id: string | null;
  invoice_id: string;
  supplier_id: string;
  payment_date: string;
  /** Money actually paid to the supplier (net of what was withheld). */
  amount: number;
  mode: SupplierPaymentMode;
  reference: string | null;
  bank: string | null;
  /** 0, 75 or 100 % of the VAT of the part settled (art. 117-IV and V). */
  vat_withholding_rate: number;
  vat_withheld: number;
  ir_withheld: number;
  /** VAT of this payment lost because of the cash limits (art. 106-II). */
  cash_vat_nondeductible: number;
  /** Part of this payment not deductible from the taxable result (art. 11-II). */
  cash_expense_nondeductible: number;
  notes: string | null;
  created_by: string | null;
  created_at?: string;
}

export const NATURE_LABELS: Record<SupplierInvoiceNature, string> = {
  marchandises: 'Marchandises',
  immobilisation: 'Immobilisation',
  services: 'Services et charges',
};

export const STATUS_LABELS: Record<SupplierInvoiceStatus, string> = {
  draft: 'Brouillon',
  validated: 'Validée',
  partial: 'Partiellement payée',
  paid: 'Payée',
};

export const PAYMENT_MODE_LABELS: Record<SupplierPaymentMode, string> = {
  virement: 'Virement',
  cheque: 'Chèque',
  effet: 'Effet (LCN)',
  carte: 'Carte bancaire',
  especes: 'Espèces',
  versement: 'Versement en compte',
  compensation: 'Compensation',
};

/** Rates of the VAT reform (LF 2024): 20 % and 10 % since 2026, plus exempt / 0 %. */
export const VAT_RATES = [20, 10, 0] as const;
/** Rates that still appear on invoices dated before 2026. */
export const LEGACY_VAT_RATES = [14, 7] as const;
export const ALLOWED_VAT_RATES: number[] = [...VAT_RATES, ...LEGACY_VAT_RATES];

export const DEFAULT_PAYMENT_DAYS = 60;
export const MAX_PAYMENT_DAYS = 120;
/** The attestation de régularité fiscale counts when issued less than six months before (art. 117-IV). */
export const CERTIFICATE_VALID_MONTHS = 6;

/** Default expense or asset account by nature (CGNC). */
export const DEFAULT_ACCOUNT: Record<SupplierInvoiceNature, string> = {
  marchandises: '6111', // Achats de marchandises
  immobilisation: '2332', // Matériel et outillage
  services: '6136', // Rémunérations d'intermédiaires et honoraires
};

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// ── Dates (YYYY-MM-DD strings, calendar arithmetic, no time zone drift) ──
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parts = (day: string) => day.slice(0, 10).split('-').map(Number);

export function today(): string { return ymd(new Date()); }

export function addDays(day: string, days: number): string {
  const [y, m, d] = parts(day);
  return ymd(new Date(y, m - 1, d + days));
}

/** Same day `months` later; the 31st becomes the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = parts(day);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  return ymd(new Date(y, m - 1 + months, Math.min(d, last)));
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function endOfMonth(day: string): string {
  const [y, m] = parts(day);
  return ymd(new Date(y, m, 0));
}

export function frDay(day: string | null | undefined): string {
  if (!day) return '—';
  const [y, m, d] = day.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : day;
}

export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

// ── Amounts ─────────────────────────────────────────────────────────────
/** VAT of an amount excluding VAT, rounded to the centime. */
export function vatOf(amountHt: number, rate: number): number {
  return r2(r2(amountHt) * (Number(rate) || 0) / 100);
}

/** A price including VAT brought back to excluding VAT. */
export function ttcToHt(ttc: number, rate: number): number {
  return r2((Number(ttc) || 0) / (1 + (Number(rate) || 0) / 100));
}

export interface RateTotal { rate: number; base: number; vat: number; ttc: number; nonDeductibleVat: number }
export interface InvoiceTotals {
  byRate: RateTotal[];
  ht: number;
  vat: number;
  ttc: number;
  /** VAT that joins the cost (non-deductible lines). */
  nonDeductibleVat: number;
  /** VAT the buyer may recover, before the cash-payment rule of art. 106-II. */
  deductibleVat: number;
}

/** Totals by rate (base HT, VAT, TTC), highest rate first, and overall. */
export function invoiceTotals(lines: Pick<SupplierInvoiceLine, 'amount_ht' | 'vat_rate' | 'vat_amount' | 'vat_nondeductible'>[]): InvoiceTotals {
  const map = new Map<number, RateTotal>();
  for (const l of lines) {
    const rate = Number(l.vat_rate) || 0;
    const t = map.get(rate) || { rate, base: 0, vat: 0, ttc: 0, nonDeductibleVat: 0 };
    t.base = r2(t.base + (Number(l.amount_ht) || 0));
    t.vat = r2(t.vat + (Number(l.vat_amount) || 0));
    if (l.vat_nondeductible) t.nonDeductibleVat = r2(t.nonDeductibleVat + (Number(l.vat_amount) || 0));
    t.ttc = r2(t.base + t.vat);
    map.set(rate, t);
  }
  const byRate = [...map.values()].sort((a, b) => b.rate - a.rate);
  const ht = r2(byRate.reduce((s, t) => s + t.base, 0));
  const vat = r2(byRate.reduce((s, t) => s + t.vat, 0));
  const nonDeductibleVat = r2(byRate.reduce((s, t) => s + t.nonDeductibleVat, 0));
  return { byRate, ht, vat, ttc: r2(ht + vat), nonDeductibleVat, deductibleVat: r2(vat - nonDeductibleVat) };
}

/** What remains to settle on an invoice. */
export function remainingOf(inv: Pick<SupplierInvoice, 'total_ttc' | 'paid_amount'>): number {
  return r2(Math.max(0, (Number(inv.total_ttc) || 0) - (Number(inv.paid_amount) || 0)));
}

/** Status from the amounts (the database keeps the same rule in a trigger). */
export function statusFromAmounts(draft: boolean, ttc: number, settled: number): SupplierInvoiceStatus {
  if (draft) return 'draft';
  if (r2(settled) > 0 && r2(settled) >= r2(ttc) - 0.005) return 'paid';
  if (r2(settled) > 0) return 'partial';
  return 'validated';
}

// ── Accounts ────────────────────────────────────────────────────────────
/** A goods purchase line (needs product and quantity). 6119 (rebates) is not one. */
export const isGoodsAccount = (code: string) => /^6111/.test((code || '').trim());
/** An asset line: its VAT is recovered on 34551, not 34552. */
export const isAssetAccount = (code: string) => /^2/.test((code || '').trim());

/** Accounts the line picker offers for a nature: goods 611x, assets class 2, services and charges 61x/62x… */
export function accountsForNature<T extends { code: string }>(accounts: T[], nature: SupplierInvoiceNature): T[] {
  const re = nature === 'immobilisation' ? /^2[1-3]/ : nature === 'marchandises' ? /^61[12]/ : /^6[1-8]/;
  return accounts.filter(a => re.test(a.code));
}

// ── Due date (loi 69-21) ────────────────────────────────────────────────
export function paymentDaysError(days: number): string | null {
  if (!Number.isInteger(days) || days < 0) return 'Le délai de paiement est un nombre de jours entier (0 à 120).';
  if (days > MAX_PAYMENT_DAYS) return 'Le délai de paiement ne peut pas dépasser 120 jours (maximum légal, loi 69-21).';
  return null;
}

/**
 * The day the payment delay starts: the invoice date, or the end of the
 * month of delivery when the invoice was issued after that month (an invoice
 * must be issued by the end of the month of delivery).
 */
export function delayStart(inv: Pick<SupplierInvoice, 'invoice_date' | 'delivery_date'>): string {
  const issued = inv.invoice_date.slice(0, 10);
  if (isDay(inv.delivery_date)) {
    const limit = endOfMonth(inv.delivery_date);
    if (issued > limit) return limit;
  }
  return issued;
}

/** Due date proposed for a supplier's delay (60 days when nothing is agreed). */
export function defaultDueDate(inv: Pick<SupplierInvoice, 'invoice_date' | 'delivery_date'>, supplierDays?: number | null): string {
  const days = supplierDays == null || Number.isNaN(Number(supplierDays)) ? DEFAULT_PAYMENT_DAYS : Math.min(MAX_PAYMENT_DAYS, Math.max(0, Math.round(Number(supplierDays))));
  return addDays(delayStart(inv), days);
}

/** Why a due date is refused, or null. 60 days when nothing is agreed, 120 at most when agreed. */
export function dueDateError(inv: Pick<SupplierInvoice, 'invoice_date' | 'delivery_date' | 'due_date' | 'due_kind'>): string | null {
  if (!isDay(inv.due_date)) return 'Indiquez la date d’échéance.';
  if (inv.due_date < inv.invoice_date) return 'L’échéance ne peut pas précéder la date de la facture.';
  const start = delayStart(inv);
  const max = inv.due_kind === 'agreed' ? MAX_PAYMENT_DAYS : DEFAULT_PAYMENT_DAYS;
  if (daysBetween(start, inv.due_date) > max) {
    return inv.due_kind === 'agreed'
      ? `Un délai convenu ne peut pas dépasser 120 jours (échéance au plus tard le ${frDay(addDays(start, max))}, loi 69-21).`
      : `Sans délai convenu par écrit, l’échéance est à 60 jours au plus (le ${frDay(addDays(start, max))}). Choisissez « délai convenu » si un contrat prévoit plus, 120 jours au maximum.`;
  }
  return null;
}

// ── Checks before saving / validating ───────────────────────────────────
export interface InvoiceDraft {
  supplier_id: string;
  supplier_invoice_number: string;
  invoice_date: string;
  delivery_date: string | null;
  due_date: string;
  due_kind: DueKind;
  nature: SupplierInvoiceNature;
  ir_rate?: number | null;
  ir_amount?: number | null;
}

/** Problems of one line, in French, or an empty list. */
export function lineErrors(l: SupplierInvoiceLine, index: number): string[] {
  const n = `Ligne ${index + 1}`;
  const out: string[] = [];
  if (!(l.label || '').trim()) out.push(`${n} : indiquez le libellé.`);
  if (!(Number(l.amount_ht) !== 0)) out.push(`${n} : montant HT manquant.`);
  if (!ALLOWED_VAT_RATES.includes(Number(l.vat_rate))) out.push(`${n} : taux de TVA invalide (20 %, 10 % ou 0 %).`);
  if (!(l.account_code || '').trim()) out.push(`${n} : choisissez le compte.`);
  if (Math.abs(r2(l.vat_amount) - vatOf(l.amount_ht, l.vat_rate)) > 1) out.push(`${n} : la TVA s’écarte de plus d’1 DH du taux appliqué au montant HT.`);
  if (isGoodsAccount(l.account_code)) {
    if (!(l.barcode || '').trim()) out.push(`${n} : une ligne de marchandises doit indiquer l’article.`);
    if (!(Number(l.quantity) > 0)) out.push(`${n} : une ligne de marchandises doit indiquer la quantité.`);
  }
  return out;
}

/** Problems of a whole invoice (header and lines). */
export function invoiceErrors(inv: InvoiceDraft, lines: SupplierInvoiceLine[]): string[] {
  const out: string[] = [];
  if (!inv.supplier_id) out.push('Choisissez le fournisseur.');
  if (!(inv.supplier_invoice_number || '').trim()) out.push('Indiquez le numéro de la facture du fournisseur.');
  if (!isDay(inv.invoice_date)) out.push('Indiquez la date de la facture.');
  else {
    const due = dueDateError(inv);
    if (due) out.push(due);
  }
  if (lines.length === 0) out.push('Ajoutez au moins une ligne.');
  lines.forEach((l, i) => out.push(...lineErrors(l, i)));
  const ir = Number(inv.ir_amount) || 0;
  if (ir < 0) out.push('La retenue IR/IS ne peut pas être négative.');
  if (ir > 0 && inv.nature !== 'services') out.push('La retenue IR/IS ne concerne que les services (honoraires, commissions…).');
  if (ir > invoiceTotals(lines).ht + 0.005) out.push('La retenue IR/IS dépasse le montant HT.');
  return out;
}

/** The supplier invoice number as compared for duplicates (case and spaces ignored). */
export function normalizeInvoiceNumber(n: string | null | undefined): string {
  return (n || '').replace(/\s+/g, '').toUpperCase();
}

export function isDuplicateNumber(
  candidate: { id?: string | null; supplier_id: string; supplier_invoice_number: string },
  existing: Array<Pick<SupplierInvoice, 'id' | 'supplier_id' | 'supplier_invoice_number'>>,
): boolean {
  const key = normalizeInvoiceNumber(candidate.supplier_invoice_number);
  return !!key && existing.some(e => e.id !== candidate.id && e.supplier_id === candidate.supplier_id && normalizeInvoiceNumber(e.supplier_invoice_number) === key);
}

// ── Supplier record ─────────────────────────────────────────────────────
/** The ICE as stored: digits only (people type it with spaces). */
export const normalizeIce = (v: string | null | undefined) => (v || '').replace(/\s+/g, '');

export function supplierErrors(s: Partial<Supplier>): string[] {
  const out: string[] = [];
  if (!(s.name || '').trim()) out.push(s.legal_type === 'personne_physique' ? 'Indiquez le nom.' : 'Indiquez la raison sociale.');
  const ice = normalizeIce(s.ice);
  if (ice && !/^\d{15}$/.test(ice)) out.push(`L’ICE doit comporter exactement 15 chiffres (${ice.replace(/\D/g, '').length} saisis).`);
  const ifn = (s.if_number || '').trim();
  if (ifn && !/^\d+$/.test(ifn)) out.push('L’identifiant fiscal (IF) ne contient que des chiffres.');
  const days = Number(s.payment_days ?? DEFAULT_PAYMENT_DAYS);
  const daysErr = paymentDaysError(days);
  if (daysErr) out.push(daysErr);
  if ((s.email || '').trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s.email || '').trim())) out.push('Adresse e-mail invalide.');
  if (s.tax_certificate_date && !isDay(s.tax_certificate_date)) out.push('Date d’attestation invalide.');
  return out;
}

/** Name as printed: "Raison sociale" or "Nom Prénom". */
export function supplierDisplayName(s: Pick<Supplier, 'name' | 'first_name' | 'legal_type'> | null | undefined): string {
  if (!s) return '—';
  return s.legal_type === 'personne_physique' && (s.first_name || '').trim() ? `${s.name} ${s.first_name}`.trim() : s.name;
}

/**
 * Whether the attestation de régularité fiscale counts on `day`: issued on
 * or before it and less than six months earlier (art. 117-IV).
 */
export function certificateValidOn(certificateDate: string | null | undefined, day: string): boolean {
  if (!isDay(certificateDate)) return false;
  const d = certificateDate.slice(0, 10);
  return d <= day && day < addMonths(d, CERTIFICATE_VALID_MONTHS);
}

/**
 * Names used on purchase orders and in the provider list that no supplier
 * record carries yet (case and spaces ignored), with how many orders use
 * each. Nothing is rewritten: the page only offers to create the records.
 */
export function supplierNameCandidates(
  poNames: Array<string | null | undefined>,
  providerNames: Array<string | null | undefined>,
  suppliers: Array<Pick<Supplier, 'name'>>,
): Array<{ name: string; orders: number }> {
  const key = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
  const known = new Set(suppliers.map(s => key(s.name || '')));
  const found = new Map<string, { name: string; orders: number }>();
  const add = (raw: string | null | undefined, order: boolean) => {
    const name = (raw || '').trim().replace(/\s+/g, ' ');
    if (!name || known.has(key(name))) return;
    const cur = found.get(key(name)) || { name, orders: 0 };
    if (order) cur.orders += 1;
    found.set(key(name), cur);
  };
  poNames.forEach(n => add(n, true));
  providerNames.forEach(n => add(n, false));
  return [...found.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name, 'fr'));
}

/** The supplier record matching a purchase order: by id, else by name. */
export function matchSupplier<T extends Pick<Supplier, 'id' | 'name' | 'provider_id'>>(
  suppliers: T[], po: { supplier_id?: string | null; provider_id?: string | null; provider_name?: string | null },
): T | undefined {
  if (po.supplier_id) { const s = suppliers.find(x => x.id === po.supplier_id); if (s) return s; }
  if (po.provider_id) { const s = suppliers.find(x => x.provider_id === po.provider_id); if (s) return s; }
  const name = (po.provider_name || '').trim().toLowerCase();
  return name ? suppliers.find(x => (x.name || '').trim().toLowerCase() === name) : undefined;
}

// ── Prefill from a purchase order or a reception ─────────────────────────
export interface CostLine { barcode: string; label: string; quantity: number; unitCostTtc: number }

/**
 * Invoice lines from purchase order or reception lines. Stocky stores those
 * costs including VAT: each line's amount is brought back to HT at `vatRate`.
 * Lines of the same product are merged.
 */
export function linesFromCosts(source: CostLine[], vatRate: number): SupplierInvoiceLine[] {
  const merged = new Map<string, CostLine>();
  for (const s of source) {
    if (!(Number(s.quantity) > 0)) continue;
    const cur = merged.get(s.barcode);
    if (cur) {
      // Weighted unit cost when the product appears twice.
      const total = cur.quantity * cur.unitCostTtc + s.quantity * s.unitCostTtc;
      cur.quantity += s.quantity;
      cur.unitCostTtc = cur.quantity > 0 ? total / cur.quantity : 0;
    } else merged.set(s.barcode, { ...s });
  }
  return [...merged.values()].map((s, i) => {
    const amount = ttcToHt(s.quantity * (Number(s.unitCostTtc) || 0), vatRate);
    return {
      position: i, label: s.label || s.barcode, barcode: s.barcode, quantity: s.quantity,
      amount_ht: amount, vat_rate: vatRate, vat_amount: vatOf(amount, vatRate),
      account_code: DEFAULT_ACCOUNT.marchandises, vat_nondeductible: false,
    };
  });
}

/** An empty line for a nature. */
export function blankLine(nature: SupplierInvoiceNature, position: number, vatRate = 20): SupplierInvoiceLine {
  return { position, label: '', barcode: null, quantity: nature === 'marchandises' ? 1 : null, amount_ht: 0, vat_rate: vatRate, vat_amount: 0, account_code: DEFAULT_ACCOUNT[nature], vat_nondeductible: false };
}

/**
 * Quantities bought on invoices, per product: validated invoices only (a
 * draft is not a purchase yet), goods lines only. For the "invoiced stock".
 */
export function invoicedQuantities(invoices: Array<Pick<SupplierInvoice, 'status' | 'lines'>>): Map<string, { quantity: number; amountHt: number }> {
  const out = new Map<string, { quantity: number; amountHt: number }>();
  for (const inv of invoices) {
    if (inv.status === 'draft') continue;
    for (const l of inv.lines || []) {
      if (!isGoodsAccount(l.account_code) || !l.barcode) continue;
      const cur = out.get(l.barcode) || { quantity: 0, amountHt: 0 };
      cur.quantity += Number(l.quantity) || 0;
      cur.amountHt = r2(cur.amountHt + (Number(l.amount_ht) || 0));
      out.set(l.barcode, cur);
    }
  }
  return out;
}

/** Overdue: validated, not fully settled, due date passed. Days late counted from the day after the due date. */
export function overdueDays(inv: Pick<SupplierInvoice, 'status' | 'due_date' | 'total_ttc' | 'paid_amount'>, day = today()): number {
  if (inv.status === 'draft' || remainingOf(inv) <= 0.005 || !isDay(inv.due_date)) return 0;
  return Math.max(0, daysBetween(inv.due_date, day));
}
