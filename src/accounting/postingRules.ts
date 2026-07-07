import type { Quote, Payslip, JournalType, JournalEntryLine } from '../types';
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

function toDate(v: string | Date | undefined): string {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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

/** Encaissement client: D 5141/5161 / C 3421. */
export function buildPaymentEntry(q: Quote): EntryDraft | null {
  const amount = r2(q.paid_amount || 0) || r2(q.totalAmount);
  if (amount <= 0) return null;
  const method = (q.payment_method || '').toLowerCase();
  const isCash = /esp[eè]ce|cash|caisse|liquide/.test(method);
  const treasury = isCash ? DEFAULT_ACCOUNTS.caisse : DEFAULT_ACCOUNTS.banque;
  const label = `Règlement ${q.quoteNumber} - ${q.customer?.fullName || ''}`.trim();
  return {
    journalType: isCash ? 'caisse' : 'banque',
    date: toDate(q.payment_date || q.quote_date || q.createdAt),
    reference: q.payment_reference || q.quoteNumber,
    label,
    sourceType: 'payment',
    sourceId: `${q.id}:pay`,
    lines: [
      { account_code: treasury, label: label, debit: amount, credit: 0 },
      { account_code: DEFAULT_ACCOUNTS.clients, label: q.customer?.fullName || 'Client', debit: 0, credit: amount },
    ],
  };
}

/** Écriture de paie (journal PAIE) pour un bulletin. */
export function buildPayslipEntry(p: Payslip, employeeName?: string): EntryDraft {
  const employer = r2((p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0));
  const cnssTotal = r2((p.cnss_employee || 0) + (p.amo_employee || 0) + (p.cnss_employer || 0) + (p.amo_employer || 0) + (p.alloc_familiales || 0));
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
  if ((p.other_deductions || 0) > 0) lines.push({ account_code: '4488', label: 'Autres retenues', debit: 0, credit: r2(p.other_deductions) });
  return { journalType: 'paie', date: `${p.period_year}-${String(p.period_month).padStart(2, '0')}-28`, reference: p.payslip_number, label, sourceType: 'payslip', sourceId: p.id, lines };
}
