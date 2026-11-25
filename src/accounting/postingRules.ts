import type { Quote, Payslip, JournalType, JournalEntryLine } from '../types';
import { DEFAULT_ACCOUNTS, CUSTOMER_TAX_ACCOUNTS } from './pcmSeed';
import { documentTvaRate, invoiceSettlements, isCashMethod } from '../utils/documentLines';

export interface EntryDraft {
  journalType: JournalType;
  date: string;            // YYYY-MM-DD
  reference: string;
  label: string;
  sourceType: string;
  sourceId: string;
  lines: JournalEntryLine[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Local calendar day: a document made at 00:30 in Morocco is dated that day.
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function toDate(v: string | Date | undefined): string {
  if (!v) return localDay(new Date());
  if (v instanceof Date) return localDay(v);
  return String(v).slice(0, 10);
}

/**
 * Facture de vente: D 3421 (TTC) / C 7111 (HT) / C 4455 (TVA). The VAT is
 * split at the rate frozen on the invoice; `companyRate` only serves invoices
 * from before rates were stored.
 */
export function buildInvoiceEntry(q: Quote, companyRate: number): EntryDraft {
  const tvaRate = documentTvaRate(q, companyRate);
  const ttc = r2(q.totalAmount);
  const ht = r2(ttc / (1 + (tvaRate || 0) / 100));
  const tva = r2(ttc - ht);
  const label = `Facture ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
  const lines: JournalEntryLine[] = [
    { account_code: DEFAULT_ACCOUNTS.clients, label: q.customer?.fullName || 'Client', debit: ttc, credit: 0 },
    { account_code: DEFAULT_ACCOUNTS.ventesMarchandises, label: 'Ventes', debit: 0, credit: ht },
  ];
  if (tva > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.tvaFacturee, label: 'TVA facturée', debit: 0, credit: tva, vat_rate: tvaRate });
  return { journalType: 'vente', date: toDate(q.quote_date || q.createdAt), reference: q.quoteNumber, label, sourceType: 'invoice', sourceId: q.id, lines };
}

/** Avoir: contre-passation de la vente. C 3421 / D 7111 / D 4455, at the credit note's own rate. */
export function buildAvoirEntry(q: Quote, companyRate: number): EntryDraft {
  const tvaRate = documentTvaRate(q, companyRate);
  const ttc = r2(q.totalAmount);
  const ht = r2(ttc / (1 + (tvaRate || 0) / 100));
  const tva = r2(ttc - ht);
  const label = `Avoir ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
  const lines: JournalEntryLine[] = [
    { account_code: DEFAULT_ACCOUNTS.ventesMarchandises, label: 'Annulation ventes', debit: ht, credit: 0 },
  ];
  if (tva > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.tvaFacturee, label: 'TVA sur avoir', debit: tva, credit: 0, vat_rate: tvaRate });
  lines.push({ account_code: DEFAULT_ACCOUNTS.clients, label: q.customer?.fullName || 'Client', debit: 0, credit: ttc });
  return { journalType: 'vente', date: toDate(q.quote_date || q.createdAt), reference: q.quoteNumber, label, sourceType: 'invoice', sourceId: q.id, lines };
}

export interface InvoicePaymentLine {
  amount: number;
  method: string;
  reference: string;
  /** The settlement's own date (undated older entries: the invoice's payment date, else its date). */
  date: string;
  kind: 'payment' | 'vat_withholding';
  /** Stamp duty collected on top of a cash payment (booked apart, see buildStampDutyEntries). */
  stampDuty: number;
  /** Stable key of the settlement ('avance', entry id, or '#index'). */
  key: string;
}

/**
 * What settled an invoice, one line per settlement: the advance, then each
 * recorded payment or VAT withholding, each at its own date.
 */
export function invoicePaymentLines(q: Quote): InvoicePaymentLine[] {
  return invoiceSettlements(q)
    .filter(s => s.amount > 0)
    .map(s => ({
      amount: r2(s.amount), method: s.method || (s.kind === 'payment' ? q.payment_method || '' : ''), reference: s.reference,
      date: toDate(s.date), kind: s.kind, stampDuty: s.stampDuty, key: s.key,
    }));
}

/**
 * Settlements not yet booked, each on its own date, beyond the
 * `alreadyPosted` amount (so a second payment on an invoice is booked too):
 * - money: D 5161 (cash) or 5141 (bank) / C 3421;
 * - VAT withheld by the client (CGI art. 117-IV): no money comes in and the
 *   State owes the amount back: D 34581 / C 3421, in the OD journal.
 * `existing` is how many settlement entries the invoice already has.
 */
export function buildPaymentEntries(q: Quote, alreadyPosted: number, existing: number): EntryDraft[] {
  let covered = r2(alreadyPosted);
  const out: EntryDraft[] = [];
  for (const p of invoicePaymentLines(q)) {
    const amount = r2(p.amount - Math.min(p.amount, covered));
    covered = r2(Math.max(0, covered - p.amount));
    if (amount <= 0.005) continue;
    const n = existing + out.length;
    const sourceId = n === 0 ? `${q.id}:pay` : `${q.id}:pay:${n}`;
    const client: JournalEntryLine = { account_code: DEFAULT_ACCOUNTS.clients, label: q.customer?.fullName || 'Client', debit: 0, credit: amount };
    if (p.kind === 'vat_withholding') {
      const label = `TVA retenue à la source ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
      out.push({
        journalType: 'od', date: p.date, reference: p.reference || q.quoteNumber, label, sourceType: 'payment', sourceId,
        lines: [{ account_code: CUSTOMER_TAX_ACCOUNTS.tvaRetenueClients, label, debit: amount, credit: 0 }, client],
      });
      continue;
    }
    const isCash = isCashMethod(p.method);
    const label = `Règlement ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
    out.push({
      journalType: isCash ? 'caisse' : 'banque',
      date: p.date,
      reference: p.reference || q.quoteNumber,
      label,
      sourceType: 'payment',
      sourceId,
      lines: [
        { account_code: isCash ? DEFAULT_ACCOUNTS.caisse : DEFAULT_ACCOUNTS.banque, label, debit: amount, credit: 0 },
        client,
      ],
    });
  }
  return out;
}

/** Source id of the stamp-duty entry of one settlement. */
export const stampDutySourceId = (invoiceId: string, key: string) => `${invoiceId}:timbre:${key}`;

/**
 * Stamp duty collected on cash payments (CGI art. 252-I-B): the cash came in
 * with the payment, but the duty belongs to the State, not to sales and not to
 * the client account: D 5161 / C 44578, on the payment's date. One entry per
 * settlement, skipped once `generated` holds its source id. Kept apart from
 * the payment entries so their amounts stay what settles the invoice.
 */
export function buildStampDutyEntries(q: Quote, generated: Set<string>): EntryDraft[] {
  return invoicePaymentLines(q)
    .filter(p => p.kind === 'payment' && p.stampDuty > 0 && !generated.has(stampDutySourceId(q.id, p.key)))
    .map(p => {
      const label = `Droit de timbre ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
      return {
        journalType: 'caisse' as JournalType, date: p.date, reference: p.reference || q.quoteNumber, label,
        sourceType: 'stamp_duty', sourceId: stampDutySourceId(q.id, p.key),
        lines: [
          { account_code: DEFAULT_ACCOUNTS.caisse, label, debit: r2(p.stampDuty), credit: 0 },
          { account_code: CUSTOMER_TAX_ACCOUNTS.droitsTimbre, label: 'Droit de timbre 0,25 %', debit: 0, credit: r2(p.stampDuty) },
        ],
      };
    });
}

/** Écriture de paie (journal PAIE) pour un bulletin. */
export function buildPayslipEntry(p: Payslip, employeeName?: string, loanRepaid = 0): EntryDraft {
  const tfp = p.tfp_employer || 0;
  const cimrEmployer = p.cimr_employer || 0;
  // Employer charges: CNSS, AMO, family allowances, training tax and the
  // employer CIMR share, all on 6174 with the other social charges.
  const employer = r2((p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + tfp + cimrEmployer);
  const cnssTotal = r2((p.cnss_employee || 0) + (p.amo_employee || 0) + (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + tfp);
  const cimr = r2((p.cimr_employee || 0) + cimrEmployer);
  const loans = r2(Math.min(loanRepaid, p.other_deductions || 0));
  const other = r2((p.other_deductions || 0) - loans);
  const period = `${String(p.period_month).padStart(2, '0')}/${p.period_year}`;
  const label = `Paie ${period}${employeeName ? ' - ' + employeeName : ''}`;
  const lines: JournalEntryLine[] = [
    { account_code: DEFAULT_ACCOUNTS.chargesPersonnel, label: 'Salaires bruts', debit: r2(p.total_gross), credit: 0 },
  ];
  if (employer > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.chargesSociales, label: 'Charges patronales', debit: employer, credit: 0 });
  lines.push({ account_code: DEFAULT_ACCOUNTS.remunerationsDues, label: 'Net à payer', debit: 0, credit: r2(p.net_salary) });
  if (cnssTotal > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.cnss, label: 'CNSS/AMO', debit: 0, credit: cnssTotal });
  // Employee and employer CIMR shares are both owed to the fund.
  if (cimr > 0) lines.push({ account_code: '4443', label: 'CIMR', debit: 0, credit: cimr });
  // ir_amount is the IR actually withheld, net of any regularisation.
  if ((p.ir_amount || 0) > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.irRetenue, label: 'IR retenue', debit: 0, credit: r2(p.ir_amount) });
  // Repaid advances clear the receivable they were booked to.
  if (loans > 0) lines.push({ account_code: '3488', label: 'Remboursement avances / prêts', debit: 0, credit: loans });
  if (other > 0) lines.push({ account_code: '4488', label: 'Autres retenues', debit: 0, credit: other });
  return { journalType: 'paie', date: localDay(new Date(p.period_year, p.period_month, 0)), reference: p.payslip_number, label, sourceType: 'payslip', sourceId: p.id, lines };
}
