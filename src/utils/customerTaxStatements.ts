import type { Quote } from '../types';
import { documentDay, documentTvaRate, formatDay, invoiceSettlements, withholdingBase } from './documentLines';

// Statements the accountant needs from the customer settlements:
// - VAT withheld at source by clients (CGI art. 117-IV), for the VAT return
//   (art. 111: "relevé détaillé de la retenue à la source") and to claim the
//   credit (art. 103-6°);
// - stamp duty collected on cash settlements (art. 252-I-B), declared and
//   paid before the end of the following month (art. 254-II).
// Both read each settlement at its own date.

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WithholdingRow {
  date: string;
  client: string;
  ice: string;
  invoice: string;
  invoiceDate: string;
  tvaRate: number;
  share: number;
  base: number;
  withheld: number;
  reference: string;
}

/** VAT withheld by clients between `from` and `to` (YYYY-MM-DD, inclusive), oldest first. */
export function withholdingStatement(invoices: Quote[], from: string, to: string, companyRate?: number | null): WithholdingRow[] {
  const rows: WithholdingRow[] = [];
  for (const inv of invoices) {
    if (inv.document_type && inv.document_type !== 'invoice') continue;
    const rate = documentTvaRate(inv, companyRate);
    for (const s of invoiceSettlements(inv)) {
      if (s.kind !== 'vat_withholding' || s.amount <= 0 || s.date < from || s.date > to) continue;
      const share = s.withholdingRate || 100;
      rows.push({
        date: s.date, client: inv.customer?.fullName || '', ice: inv.customer?.ice || '', invoice: inv.quoteNumber,
        invoiceDate: documentDay(inv), tvaRate: rate, share, base: withholdingBase(s.amount, rate, share), withheld: s.amount, reference: s.reference,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice));
}

export interface StampDutyRow {
  date: string;
  client: string;
  invoice: string;
  cash: number;
  duty: number;
  reference: string;
}

/** Stamp duty collected in one month (YYYY-MM), oldest first. */
export function stampDutyStatement(invoices: Quote[], month: string): StampDutyRow[] {
  const rows: StampDutyRow[] = [];
  for (const inv of invoices) {
    if (inv.document_type && inv.document_type !== 'invoice') continue;
    for (const s of invoiceSettlements(inv)) {
      if (s.kind !== 'payment' || s.stampDuty <= 0 || s.date.slice(0, 7) !== month) continue;
      rows.push({ date: s.date, client: inv.customer?.fullName || '', invoice: inv.quoteNumber, cash: s.amount, duty: s.stampDuty, reference: s.reference });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice));
}

export const sumBy = <T,>(rows: T[], f: (r: T) => number) => round2(rows.reduce((t, r) => t + f(r), 0));

/** CSV rows (French headers) of the withholding statement, with a total line. */
export function withholdingCsvRows(rows: WithholdingRow[]): Record<string, string | number>[] {
  const out: Record<string, string | number>[] = rows.map(r => ({
    'Date de la retenue': formatDay(r.date),
    'Client': r.client,
    'ICE client': r.ice,
    'N° facture': r.invoice,
    'Date facture': formatDay(r.invoiceDate),
    'Base HT': r.base,
    'Taux TVA %': r.tvaRate,
    'Part retenue %': r.share,
    'TVA retenue': r.withheld,
    'Référence': r.reference,
  }));
  out.push({ 'Date de la retenue': 'TOTAL', 'Client': '', 'ICE client': '', 'N° facture': '', 'Date facture': '', 'Base HT': sumBy(rows, r => r.base), 'Taux TVA %': '', 'Part retenue %': '', 'TVA retenue': sumBy(rows, r => r.withheld), 'Référence': '' });
  return out;
}

/** CSV rows (French headers) of the stamp-duty statement, with a total line. */
export function stampDutyCsvRows(rows: StampDutyRow[]): Record<string, string | number>[] {
  const out: Record<string, string | number>[] = rows.map(r => ({
    'Date': formatDay(r.date), 'Client': r.client, 'N° facture': r.invoice, 'Encaissé en espèces': r.cash, 'Droit de timbre 0,25 %': r.duty, 'Référence': r.reference,
  }));
  out.push({ 'Date': 'TOTAL', 'Client': '', 'N° facture': '', 'Encaissé en espèces': sumBy(rows, r => r.cash), 'Droit de timbre 0,25 %': sumBy(rows, r => r.duty), 'Référence': '' });
  return out;
}
