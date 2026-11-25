// Withholdings and cash rules on supplier payments. Pure functions.
//
// VAT withheld at source by the buyer (CGI art. 117, as amended by LF 2024 and LF 2026):
//  IV  equipment goods and works, from a VAT-registered supplier who does not
//      hand over an attestation de régularité fiscale issued less than six
//      months ago: the client withholds the VAT (all of it).
//  V   services of art. 89-I (5°, 10°, 12°) listed by decree (liste B of
//      décret 2-06-574):
//      b) a private company (or a person on RNR/RNS) paying a PERSON subject to
//         VAT withholds 75 % of the VAT with the attestation, 100 % without;
//      c) banks, insurers and companies whose turnover reaches the LF 2026
//         thresholds (500 M MAD from 1 July 2026, 350 M from 2027, 200 M from
//         2028, art. 247-XXXXVI) also withhold on services from COMPANIES:
//         75 % with the attestation, 100 % without.
//      Not withheld: services of 5,000 DH or less, within 50,000 DH a month
//      per supplier; electricity and water sold to the networks, sanitation,
//      telecoms, insurance brokers.
//  The withheld VAT is paid to the tax office during the month after each
//  payment, with a bordereau-avis.
// Nothing here blocks: the accountant decides, the app only suggests.
//
// Cash limits (CGI art. 11-II for the expense, art. 106-II for the VAT): a
// purchase settled otherwise than by crossed non-endorsable cheque, bill of
// exchange, card ("moyen magnétique"), bank transfer, electronic means or
// documented set-off is:
//  - deductible from the result only up to 5,000 DH a day and 50,000 DH a
//    month per supplier (11-II: "ne sont déductibles … que dans la limite de");
//  - without VAT deduction when it exceeds 5,000 DH a day per supplier,
//    within 50,000 DH a month (106-II: "n'est pas déductible la taxe ayant
//    grevé les achats … dont le montant dépasse …"): the whole VAT of that
//    day's cash payments is lost, and above 50,000 DH in the month the VAT
//    of the part beyond it.

import { addMonths, certificateValidOn, r2, type SupplierInvoiceNature, type SupplierLegalType, type SupplierPaymentMode } from './supplierInvoices';

export const VAT_WITHHOLDING_RATES = [0, 75, 100] as const;
export type VatWithholdingRate = typeof VAT_WITHHOLDING_RATES[number];

/** Services of this amount or less are not withheld (art. 117-V, last paragraph), within the monthly cap. */
export const SERVICE_EXCLUSION_AMOUNT = 5000;
export const SERVICE_EXCLUSION_MONTHLY = 50000;

export interface VatWithholdingInput {
  legalType: SupplierLegalType;
  nature: SupplierInvoiceNature;
  isWorks: boolean;
  certificateDate: string | null | undefined;
  paymentDate: string;
  /** Amount of the invoice (TTC), for the 5,000 DH exclusion of services. */
  invoiceTtc: number;
  /** Services invoiced by this supplier in the month of the payment, this invoice included. */
  supplierMonthServicesTtc?: number;
  /** The buyer is a bank, an insurer or a company above the LF 2026 turnover threshold. */
  buyerWithholdsOnCompanies?: boolean;
}

export interface VatWithholdingSuggestion { rate: VatWithholdingRate; reason: string }

/** The withholding the texts point to, with the reason in one sentence. */
export function suggestVatWithholding(i: VatWithholdingInput): VatWithholdingSuggestion {
  const valid = certificateValidOn(i.certificateDate, i.paymentDate);
  const certText = i.certificateDate
    ? (valid ? 'attestation de régularité fiscale de moins de 6 mois' : `attestation du ${i.certificateDate.split('-').reverse().join('/')} expirée (plus de 6 mois)`)
    : 'pas d’attestation de régularité fiscale enregistrée';
  if (i.nature === 'immobilisation' || i.isWorks) {
    const what = i.nature === 'immobilisation' ? 'Bien d’équipement' : 'Travaux';
    return valid
      ? { rate: 0, reason: `${what}, ${certText} : pas de retenue (art. 117-IV).` }
      : { rate: 100, reason: `${what}, ${certText} : la TVA est retenue en totalité et versée à l’administration le mois suivant (art. 117-IV).` };
  }
  if (i.nature === 'services') {
    const month = i.supplierMonthServicesTtc ?? i.invoiceTtc;
    if (i.invoiceTtc <= SERVICE_EXCLUSION_AMOUNT && month <= SERVICE_EXCLUSION_MONTHLY) {
      return { rate: 0, reason: 'Prestation de 5 000 DH ou moins (dans la limite de 50 000 DH par mois et par fournisseur) : exclue de la retenue (art. 117-V).' };
    }
    const listed = 'si la prestation figure sur la liste B du décret 2-06-574 (art. 89-I-5°, 10°, 12°)';
    if (i.legalType === 'personne_physique') {
      return valid
        ? { rate: 75, reason: `Prestataire personne physique, ${certText} : 75 % de la TVA retenus ${listed} (art. 117-V-b).` }
        : { rate: 100, reason: `Prestataire personne physique, ${certText} : 100 % de la TVA retenus ${listed} (art. 117-V-b).` };
    }
    if (i.buyerWithholdsOnCompanies) {
      return valid
        ? { rate: 75, reason: `Prestataire société, votre entreprise retient sur les sociétés, ${certText} : 75 % ${listed} (art. 117-V-c).` }
        : { rate: 100, reason: `Prestataire société, votre entreprise retient sur les sociétés, ${certText} : 100 % ${listed} (art. 117-V-c).` };
    }
    return { rate: 0, reason: 'Prestataire société : retenue seulement par les banques, assurances et entreprises au-delà du seuil de chiffre d’affaires de la LF 2026 (art. 117-V-c).' };
  }
  return { rate: 0, reason: 'Achat de marchandises : pas de retenue de TVA.' };
}

/** IR/IS withheld on fees, as listed to the accountant (no automatic guess). */
export const IR_WITHHOLDING_HELP = [
  '10 % du HT : honoraires, commissions, courtages versés à une personne physique au résultat net réel ou simplifié, par une société (art. 73-II-B-8°, 157-I).',
  '5 % du HT : mêmes rémunérations versées à une société soumise à l’IS, retenus seulement par l’État, les banques, les assurances et les entreprises au-delà du seuil de CA de la LF 2026 (art. 19-IV-A, 157-I).',
  '30 % : part du chiffre d’affaires d’un auto-entrepreneur ou d’un contribuable à la CPU au-delà de 80 000 DH par an pour un même client (art. 45 bis-II, 73-II-G-8°, 157-II).',
  'La retenue est versée le mois suivant le paiement (art. 171-I-A).',
];

/** Settling `settled` (TTC) of an invoice: what is withheld and what is paid. */
export function splitPayment(input: {
  settled: number;
  invoiceTtc: number;
  invoiceVat: number;
  vatRate: VatWithholdingRate | number;
  /** IR/IS decided on the invoice, and what earlier payments already withheld. */
  invoiceIr: number;
  irAlreadyWithheld: number;
  /** The invoice is fully settled by this payment: withhold all that remains of the IR. */
  closesInvoice: boolean;
}): { vatWithheld: number; irWithheld: number; cash: number } {
  const ttc = Number(input.invoiceTtc) || 0;
  const share = ttc > 0 ? Math.min(1, Math.max(0, (Number(input.settled) || 0) / ttc)) : 0;
  const vatWithheld = r2((Number(input.invoiceVat) || 0) * share * (Number(input.vatRate) || 0) / 100);
  const irLeft = r2(Math.max(0, (Number(input.invoiceIr) || 0) - (Number(input.irAlreadyWithheld) || 0)));
  const irWithheld = input.closesInvoice ? irLeft : Math.min(irLeft, r2((Number(input.invoiceIr) || 0) * share));
  return { vatWithheld, irWithheld, cash: r2((Number(input.settled) || 0) - vatWithheld - irWithheld) };
}

// ── Cash limits ─────────────────────────────────────────────────────────
export const CASH_DAY_LIMIT = 5000;
export const CASH_MONTH_LIMIT = 50000;

/** Modes art. 11-II and 106-II do not accept as proof of payment. */
export function isUnjustifiedMode(mode: SupplierPaymentMode | string): boolean {
  return mode === 'especes' || mode === 'versement';
}

export interface CashPaymentInput {
  id: string;
  supplier_id: string;
  payment_date: string;
  /** Money paid in this payment. */
  amount: number;
  mode: SupplierPaymentMode | string;
  /** Deductible VAT ÷ TTC of the invoice paid (the VAT this payment carries). */
  vatRatio: number;
  created_at?: string;
}

export interface CashLimitResult {
  overDay: boolean;
  overMonth: boolean;
  /** VAT lost on this payment (art. 106-II). */
  vatNonDeductible: number;
  /** Part of this payment not deductible from the result (art. 11-II). */
  expenseNonDeductible: number;
}

/**
 * Apply the cash limits to every payment of the list, per supplier, per day
 * and per month. Payments in accepted modes get zeros.
 */
export function cashLimits(payments: CashPaymentInput[]): Map<string, CashLimitResult> {
  const out = new Map<string, CashLimitResult>();
  for (const p of payments) out.set(p.id, { overDay: false, overMonth: false, vatNonDeductible: 0, expenseNonDeductible: 0 });
  const cash = payments.filter(p => isUnjustifiedMode(p.mode) && (Number(p.amount) || 0) > 0)
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
  const groups = new Map<string, CashPaymentInput[]>();
  for (const p of cash) {
    const k = `${p.supplier_id}|${p.payment_date.slice(0, 7)}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(p);
  }
  for (const list of groups.values()) {
    const byDay = new Map<string, number>();
    for (const p of list) byDay.set(p.payment_date, r2((byDay.get(p.payment_date) || 0) + Number(p.amount)));
    // VAT: whole VAT of a day above 5,000; then, on the days within it, the
    // part of the month beyond 50,000 (chronological).
    let monthCum = 0;
    // Expense: allowance 5,000 a day, 50,000 a month in all.
    let allowanceLeft = CASH_MONTH_LIMIT;
    const dayAllowanceLeft = new Map<string, number>();
    for (const p of list) {
      const r = out.get(p.id)!;
      const amount = Number(p.amount) || 0;
      const dayTotal = byDay.get(p.payment_date) || 0;
      const before = monthCum;
      monthCum = r2(monthCum + amount);
      if (dayTotal > CASH_DAY_LIMIT) {
        r.overDay = true;
        r.vatNonDeductible = r2(amount * p.vatRatio);
      }
      if (monthCum > CASH_MONTH_LIMIT) {
        r.overMonth = true;
        if (!r.overDay) r.vatNonDeductible = r2(Math.min(amount, monthCum - Math.max(before, CASH_MONTH_LIMIT)) * p.vatRatio);
      }
      if (!dayAllowanceLeft.has(p.payment_date)) dayAllowanceLeft.set(p.payment_date, CASH_DAY_LIMIT);
      const allowed = Math.min(amount, dayAllowanceLeft.get(p.payment_date)!, allowanceLeft);
      dayAllowanceLeft.set(p.payment_date, r2(dayAllowanceLeft.get(p.payment_date)! - allowed));
      allowanceLeft = r2(allowanceLeft - allowed);
      r.expenseNonDeductible = r2(amount - allowed);
    }
  }
  return out;
}

/** The warning shown when a cash payment is entered, or null. */
export function cashWarning(r: CashLimitResult | undefined): string | null {
  if (!r || (!r.overDay && !r.overMonth)) return null;
  const why = r.overDay ? 'plus de 5 000 DH en espèces le même jour chez ce fournisseur' : 'plus de 50 000 DH en espèces ce mois chez ce fournisseur';
  const parts = [];
  if (r.vatNonDeductible > 0) parts.push(`TVA non récupérable : ${fmt(r.vatNonDeductible)} (art. 106-II)`);
  if (r.expenseNonDeductible > 0) parts.push(`charge non déductible du résultat : ${fmt(r.expenseNonDeductible)} (art. 11-II)`);
  return `Paiement hors moyens justifiés : ${why}. ${parts.join(' ; ')}. Payez par virement, chèque barré ou effet pour garder la déduction.`;
}

const fmt = (n: number) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} DH`;

/** The month after a payment, when the withheld amounts must be paid (YYYY-MM). */
export function remittanceMonth(paymentDate: string): string {
  return addMonths(paymentDate.slice(0, 7) + '-01', 1).slice(0, 7);
}

export interface WithholdingRow {
  kind: 'TVA' | 'IR/IS';
  supplier: string;
  if_number: string;
  ice: string;
  invoice_number: string;
  invoice_date: string;
  payment_date: string;
  /** Base: HT of the part settled (IR) or the VAT of the part settled (VAT). */
  base: number;
  rate: number;
  amount: number;
}

/**
 * The month's withholdings, VAT and IR/IS apart, for the bordereau-avis:
 * payments dated in `month` (YYYY-MM).
 */
export function withholdingStatement(
  month: string,
  payments: Array<{ payment_date: string; amount: number; vat_withheld: number; ir_withheld: number; vat_withholding_rate: number; invoice_id: string }>,
  invoices: Map<string, { supplier_invoice_number: string; invoice_date: string; total_ttc: number; total_ht: number; total_vat: number; ir_rate: number | null; supplier: { name: string; if_number?: string | null; ice?: string | null } }>,
): { vat: WithholdingRow[]; ir: WithholdingRow[]; totalVat: number; totalIr: number } {
  const vat: WithholdingRow[] = [];
  const ir: WithholdingRow[] = [];
  for (const p of payments) {
    if (p.payment_date.slice(0, 7) !== month) continue;
    const inv = invoices.get(p.invoice_id);
    if (!inv) continue;
    const settled = (Number(p.amount) || 0) + (Number(p.vat_withheld) || 0) + (Number(p.ir_withheld) || 0);
    const share = inv.total_ttc > 0 ? Math.min(1, settled / inv.total_ttc) : 0;
    const head = {
      supplier: inv.supplier.name, if_number: inv.supplier.if_number || '', ice: inv.supplier.ice || '',
      invoice_number: inv.supplier_invoice_number, invoice_date: inv.invoice_date, payment_date: p.payment_date,
    };
    if ((Number(p.vat_withheld) || 0) > 0) vat.push({ kind: 'TVA', ...head, base: r2(inv.total_vat * share), rate: Number(p.vat_withholding_rate) || 0, amount: r2(p.vat_withheld) });
    if ((Number(p.ir_withheld) || 0) > 0) ir.push({ kind: 'IR/IS', ...head, base: r2(inv.total_ht * share), rate: Number(inv.ir_rate) || 0, amount: r2(p.ir_withheld) });
  }
  const sort = (a: WithholdingRow, b: WithholdingRow) => a.supplier.localeCompare(b.supplier, 'fr') || a.payment_date.localeCompare(b.payment_date);
  vat.sort(sort); ir.sort(sort);
  return { vat, ir, totalVat: r2(vat.reduce((s, r) => s + r.amount, 0)), totalIr: r2(ir.reduce((s, r) => s + r.amount, 0)) };
}
