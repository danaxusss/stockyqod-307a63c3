import type { Quote, Payslip, JournalType, JournalEntryLine, PaymentEntry } from '../types';
import { DEFAULT_ACCOUNTS } from './pcmSeed';

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

/** Facture de vente: D 3421 (TTC) / C 7111 (HT) / C 4455 (TVA). */
export function buildInvoiceEntry(q: Quote, tvaRate: number): EntryDraft {
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

/** Avoir: contre-passation de la vente. C 3421 / D 7111 / D 4455. */
export function buildAvoirEntry(q: Quote, tvaRate: number): EntryDraft {
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

export interface InvoicePaymentLine { amount: number; method: string; reference: string; date: string }

/** Money received on an invoice, one line per payment: the advance, then each recorded payment. */
export function invoicePaymentLines(q: Quote): InvoicePaymentLine[] {
  const date = toDate(q.payment_date || q.quote_date || q.createdAt);
  const out: InvoicePaymentLine[] = [];
  if ((q.avance_amount || 0) > 0) out.push({ amount: r2(q.avance_amount || 0), method: q.payment_method || '', reference: q.payment_reference || '', date });
  for (const e of (q.payment_methods_json || []) as PaymentEntry[]) {
    if ((Number(e.amount) || 0) > 0) out.push({ amount: r2(e.amount), method: e.method || q.payment_method || '', reference: e.reference || '', date });
  }
  return out;
}

/**
 * Encaissements not yet booked: D 5141/5161 / C 3421 for each payment beyond
 * the `alreadyPosted` amount, so a second payment on an invoice is booked too.
 * `existing` is how many payment entries the invoice already has.
 */
export function buildPaymentEntries(q: Quote, alreadyPosted: number, existing: number): EntryDraft[] {
  let covered = r2(alreadyPosted);
  const out: EntryDraft[] = [];
  for (const p of invoicePaymentLines(q)) {
    const amount = r2(p.amount - Math.min(p.amount, covered));
    covered = r2(Math.max(0, covered - p.amount));
    if (amount <= 0.005) continue;
    const isCash = /esp[eè]ce|cash|caisse|liquide/i.test(p.method);
    const n = existing + out.length;
    const label = `Règlement ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
    out.push({
      journalType: isCash ? 'caisse' : 'banque',
      date: p.date,
      reference: p.reference || q.quoteNumber,
      label,
      sourceType: 'payment',
      sourceId: n === 0 ? `${q.id}:pay` : `${q.id}:pay:${n}`,
      lines: [
        { account_code: isCash ? DEFAULT_ACCOUNTS.caisse : DEFAULT_ACCOUNTS.banque, label, debit: amount, credit: 0 },
        { account_code: DEFAULT_ACCOUNTS.clients, label: q.customer?.fullName || 'Client', debit: 0, credit: amount },
      ],
    });
  }
  return out;
}

/** Écriture de paie (journal PAIE) pour un bulletin. */
export function buildPayslipEntry(p: Payslip, employeeName?: string, loanRepaid = 0): EntryDraft {
  const tfp = p.tfp_employer || 0;
  const employer = r2((p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + tfp);
  const cnssTotal = r2((p.cnss_employee || 0) + (p.amo_employee || 0) + (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0) + tfp);
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
  if ((p.cimr_employee || 0) > 0) lines.push({ account_code: '4443', label: 'CIMR', debit: 0, credit: r2(p.cimr_employee) });
  if ((p.ir_amount || 0) > 0) lines.push({ account_code: DEFAULT_ACCOUNTS.irRetenue, label: 'IR retenue', debit: 0, credit: r2(p.ir_amount) });
  // Repaid advances clear the receivable they were booked to.
  if (loans > 0) lines.push({ account_code: '3488', label: 'Remboursement avances / prêts', debit: 0, credit: loans });
  if (other > 0) lines.push({ account_code: '4488', label: 'Autres retenues', debit: 0, credit: other });
  return { journalType: 'paie', date: localDay(new Date(p.period_year, p.period_month, 0)), reference: p.payslip_number, label, sourceType: 'payslip', sourceId: p.id, lines };
}
