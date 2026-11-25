// Ledger entries of supplier invoices and payments (CGNC). Pure functions,
// in the style of postingRules.ts; the entries are drafts the accountant
// checks and validates in "À comptabiliser".
//
//   Invoice (journal AC, at the invoice date):
//     D  line accounts (6111, 61xx, 2xxx…)   HT, plus the VAT that may not be deducted
//     D  34552 TVA récupérable sur charges    (goods and charges)
//     D  34551 TVA récupérable sur immobilisations (class 2 lines)
//     C  4411  Fournisseurs                   TTC
//   Payment (journal BQ, CS for cash; OD for a set-off):
//     D  4411  Fournisseurs                   what the payment settles
//     C  5141 Banque / 5161 Caisse / 3421 Clients (set-off)   what is paid
//     C  44581 État – TVA retenue à la source (art. 117)
//     C  44525 État – IR/IS retenus à la source sur rémunérations de tiers
//
// Source ids keep the entries idempotent and let the database lock a booked
// invoice: "sinv:<invoice id>" and "spay:<payment id>". The journal_entries
// source_type stays within its existing values ('invoice', 'payment'); the
// prefixes tell supplier documents from customer ones (customer payments use
// "<invoice id>:pay…").

import type { JournalEntryLine } from '../types';
import type { EntryDraft } from './postingRules';
import { isAssetAccount, r2, supplierDisplayName, type Supplier, type SupplierInvoice, type SupplierInvoiceLine, type SupplierPayment } from './supplierInvoices';

export const SUPPLIER_ACCOUNTS = {
  fournisseurs: '4411',
  tvaRecupCharges: '34552',
  tvaRecupImmo: '34551',
  banque: '5141',
  caisse: '5161',
  clients: '3421',
  tvaRetenue: '44581',
  irRetenu: '44525',
} as const;

/** Accounts the supplier entries need; added to charts that lack them. */
export const SUPPLIER_LEDGER_ACCOUNTS = Object.values(SUPPLIER_ACCOUNTS);

export const invoiceSourceId = (invoiceId: string) => `sinv:${invoiceId}`;
export const paymentSourceId = (paymentId: string) => `spay:${paymentId}`;
export const isSupplierSourceId = (sourceId: string | null | undefined) => /^s(inv|pay):/.test(sourceId || '');

/** Balanced, or throws: a wrong entry must never reach the books. */
function assertBalanced(lines: JournalEntryLine[], what: string): void {
  const d = r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const c = r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  if (Math.abs(d - c) > 0.005) throw new Error(`${what} : écriture déséquilibrée (débit ${d}, crédit ${c}).`);
}

export function buildSupplierInvoiceEntry(inv: SupplierInvoice, lines: SupplierInvoiceLine[], supplier: Pick<Supplier, 'name' | 'first_name' | 'legal_type'> | null | undefined): EntryDraft {
  if (inv.status === 'draft') throw new Error('Une facture fournisseur en brouillon ne se comptabilise pas : validez-la d’abord.');
  const name = supplierDisplayName(supplier);
  const ref = inv.supplier_invoice_number;
  const out: JournalEntryLine[] = [];
  // One debit per account (amounts HT, plus the VAT that joins the cost).
  const byAccount = new Map<string, number>();
  const vat = new Map<string, number>(); // key: "account|rate"
  for (const l of lines) {
    const amount = Number(l.amount_ht) || 0;
    const tva = Number(l.vat_amount) || 0;
    byAccount.set(l.account_code, r2((byAccount.get(l.account_code) || 0) + amount + (l.vat_nondeductible ? tva : 0)));
    if (!l.vat_nondeductible && tva !== 0) {
      const acc = isAssetAccount(l.account_code) ? SUPPLIER_ACCOUNTS.tvaRecupImmo : SUPPLIER_ACCOUNTS.tvaRecupCharges;
      const k = `${acc}|${Number(l.vat_rate) || 0}`;
      vat.set(k, r2((vat.get(k) || 0) + tva));
    }
  }
  const debit = (account: string, amount: number, label: string, vatRate?: number) => {
    if (amount > 0) out.push({ account_code: account, label, debit: r2(amount), credit: 0, ...(vatRate != null ? { vat_rate: vatRate } : {}) });
    else if (amount < 0) out.push({ account_code: account, label, debit: 0, credit: r2(-amount), ...(vatRate != null ? { vat_rate: vatRate } : {}) });
  };
  for (const [account, amount] of byAccount) debit(account, amount, `${ref} - ${name}`);
  for (const [k, amount] of [...vat].sort()) {
    const [account, rate] = k.split('|');
    debit(account, amount, `TVA ${rate} % ${ref}`, Number(rate));
  }
  const ttc = r2(lines.reduce((s, l) => s + (Number(l.amount_ht) || 0) + (Number(l.vat_amount) || 0), 0));
  if (ttc >= 0) out.push({ account_code: SUPPLIER_ACCOUNTS.fournisseurs, label: name, debit: 0, credit: ttc });
  else out.push({ account_code: SUPPLIER_ACCOUNTS.fournisseurs, label: name, debit: -ttc, credit: 0 });
  assertBalanced(out, `Facture ${ref}`);
  return {
    journalType: 'achat', date: inv.invoice_date.slice(0, 10), reference: ref,
    label: `Facture fournisseur ${ref} - ${name}`.slice(0, 200),
    sourceType: 'invoice', sourceId: invoiceSourceId(inv.id), lines: out,
  };
}

export function buildSupplierPaymentEntry(p: SupplierPayment, inv: Pick<SupplierInvoice, 'supplier_invoice_number'>, supplier: Pick<Supplier, 'name' | 'first_name' | 'legal_type'> | null | undefined): EntryDraft {
  const name = supplierDisplayName(supplier);
  const ref = inv.supplier_invoice_number;
  const cash = r2(p.amount);
  const vatW = r2(p.vat_withheld);
  const irW = r2(p.ir_withheld);
  const settled = r2(cash + vatW + irW);
  if (!(settled > 0)) throw new Error('Règlement nul : rien à comptabiliser.');
  const isCash = p.mode === 'especes' || p.mode === 'versement';
  const isSetOff = p.mode === 'compensation';
  const label = `Règlement ${ref} - ${name}`.slice(0, 200);
  const lines: JournalEntryLine[] = [
    { account_code: SUPPLIER_ACCOUNTS.fournisseurs, label: name, debit: settled, credit: 0 },
  ];
  if (cash > 0) lines.push({ account_code: isSetOff ? SUPPLIER_ACCOUNTS.clients : isCash ? SUPPLIER_ACCOUNTS.caisse : SUPPLIER_ACCOUNTS.banque, label, debit: 0, credit: cash });
  if (vatW > 0) lines.push({ account_code: SUPPLIER_ACCOUNTS.tvaRetenue, label: `TVA retenue à la source ${ref}`, debit: 0, credit: vatW });
  if (irW > 0) lines.push({ account_code: SUPPLIER_ACCOUNTS.irRetenu, label: `Retenue IR/IS ${ref}`, debit: 0, credit: irW });
  assertBalanced(lines, `Règlement ${ref}`);
  return {
    journalType: isSetOff ? 'od' : isCash ? 'caisse' : 'banque',
    date: p.payment_date.slice(0, 10), reference: p.reference || ref, label,
    sourceType: 'payment', sourceId: paymentSourceId(p.id), lines,
  };
}

/**
 * Where a source stands in the books, from the entries carrying its id:
 * 'posted', 'draft', or 'none' (never booked, or booked then reversed: it may
 * be generated again).
 */
export function bookingState(entries: Array<{ source_id: string | null; status: string }>, sourceId: string): 'posted' | 'draft' | 'none' {
  const mine = entries.filter(e => e.source_id === sourceId);
  if (mine.some(e => e.status === 'posted')) return 'posted';
  if (mine.some(e => e.status === 'draft')) return 'draft';
  return 'none';
}
