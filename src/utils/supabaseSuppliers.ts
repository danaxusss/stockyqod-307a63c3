// Suppliers, supplier invoices and supplier payments (migration
// 20261126120000_supplier_invoices.sql). Every read is scoped to the
// signed-in company: a supplier invoice belongs to that company's books.
//
// The owner may deploy the front end before running the migration: a read of
// a table the database does not have throws SupplierSchemaMissingError, and
// the pages show "exécutez la migration" instead of an error.

import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { readAll } from './readAll';
import { isMissingDbObject } from './productCosts';
import { AccountingService } from './supabaseAccounting';
import {
  invoiceErrors, invoiceTotals, isDuplicateNumber, normalizeIce, r2, statusFromAmounts, supplierErrors,
  type Supplier, type SupplierInvoice, type SupplierInvoiceLine, type SupplierPayment,
} from '../accounting/supplierInvoices';
import { cashLimits, isUnjustifiedMode, type CashLimitResult } from '../accounting/supplierWithholding';
import {
  bookingState, buildSupplierInvoiceEntry, buildSupplierPaymentEntry, invoiceSourceId, isSupplierSourceId,
  paymentSourceId, SUPPLIER_LEDGER_ACCOUNTS,
} from '../accounting/supplierPosting';
import type { JournalEntry } from '../types';

export const SUPPLIER_MIGRATION = '20261126120000_supplier_invoices.sql';

/** The supplier tables are not in the database yet. */
export class SupplierSchemaMissingError extends Error {
  constructor() {
    super(`Les factures fournisseurs ne sont pas encore installées : exécutez la migration ${SUPPLIER_MIGRATION} dans Supabase.`);
    this.name = 'SupplierSchemaMissingError';
  }
}

// The generated Database types do not list these tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => (supabase as any).from(name);

function scoped<Q extends { eq: (c: string, v: string) => Q }>(q: Q): Q {
  const { companyId } = getCompanyContext();
  return companyId ? q.eq('company_id', companyId) : q;
}

function check(error: unknown): void {
  if (!error) return;
  if (isMissingDbObject(error)) throw new SupplierSchemaMissingError();
  const e = error as { code?: string; message?: string };
  if (e.code === '23505' && /supplier_invoices/.test(e.message || '')) throw new Error('Cette facture est déjà enregistrée pour ce fournisseur (même numéro).');
  throw error instanceof Error ? error : new Error(e.message || 'Erreur base de données');
}

async function all<T>(build: () => ReturnType<typeof table>): Promise<T[]> {
  try {
    return await readAll<T>(build);
  } catch (e) {
    check(e);
    return [];
  }
}

const num = (v: unknown) => Number(v) || 0;

function toInvoice(row: Record<string, unknown>): SupplierInvoice {
  return {
    ...(row as unknown as SupplierInvoice),
    total_ht: num(row.total_ht), total_vat: num(row.total_vat), total_ttc: num(row.total_ttc),
    total_nondeductible_vat: num(row.total_nondeductible_vat), paid_amount: num(row.paid_amount),
    ir_amount: num(row.ir_amount), ir_rate: row.ir_rate == null ? null : num(row.ir_rate),
    litigation_amount: row.litigation_amount == null ? null : num(row.litigation_amount),
    judgment_amount: row.judgment_amount == null ? null : num(row.judgment_amount),
    is_works: !!row.is_works, cash_over_limit: !!row.cash_over_limit,
    due_kind: (row.due_kind as SupplierInvoice['due_kind']) || 'legal',
  };
}

function toLine(row: Record<string, unknown>): SupplierInvoiceLine {
  return {
    ...(row as unknown as SupplierInvoiceLine),
    amount_ht: num(row.amount_ht), vat_rate: num(row.vat_rate), vat_amount: num(row.vat_amount),
    quantity: row.quantity == null ? null : num(row.quantity), position: num(row.position), vat_nondeductible: !!row.vat_nondeductible,
  };
}

function toPayment(row: Record<string, unknown>): SupplierPayment {
  return {
    ...(row as unknown as SupplierPayment),
    amount: num(row.amount), vat_withheld: num(row.vat_withheld), ir_withheld: num(row.ir_withheld),
    vat_withholding_rate: num(row.vat_withholding_rate), cash_vat_nondeductible: num(row.cash_vat_nondeductible),
    cash_expense_nondeductible: num(row.cash_expense_nondeductible),
  };
}

// ── Suppliers ─────────────────────────────────────────────────────────────
export class SuppliersService {
  static async list(): Promise<Supplier[]> {
    const rows = await all<Supplier>(() => scoped(table('suppliers').select('*')));
    return rows.map(s => ({ ...s, payment_days: s.payment_days == null ? 60 : num(s.payment_days) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  /** Whether the migration was run (the suppliers table exists). */
  static async available(): Promise<boolean> {
    const { error } = await table('suppliers').select('id').limit(1);
    if (!error) return true;
    if (isMissingDbObject(error)) return false;
    throw error;
  }

  static async save(s: Partial<Supplier> & { name: string }, user?: string | null): Promise<Supplier> {
    const errors = supplierErrors(s);
    if (errors.length) throw new Error(errors.join(' '));
    const { companyId } = getCompanyContext();
    const payload: Record<string, unknown> = {
      name: s.name.trim(), first_name: (s.first_name || '').trim() || null,
      legal_type: s.legal_type || 'societe', ice: normalizeIce(s.ice) || null,
      if_number: (s.if_number || '').trim() || null, rc: (s.rc || '').trim() || null,
      address: (s.address || '').trim() || null, city: (s.city || '').trim() || null,
      phone: (s.phone || '').trim() || null, email: (s.email || '').trim() || null,
      payment_days: s.payment_days == null ? 60 : Math.round(Number(s.payment_days)),
      tax_certificate_date: s.tax_certificate_date || null, notes: (s.notes || '').trim() || null,
      provider_id: s.provider_id || null, active: s.active !== false,
    };
    if (s.id) {
      const { data, error } = await table('suppliers').update(payload).eq('id', s.id).select().single();
      check(error);
      return data as Supplier;
    }
    const { data, error } = await table('suppliers').insert({ ...payload, company_id: s.company_id ?? companyId, created_by: user ?? null }).select().single();
    check(error);
    return data as Supplier;
  }

  static async remove(id: string): Promise<void> {
    const { error } = await table('suppliers').delete().eq('id', id);
    if (error && ((error as { code?: string }).code === '23503' || /foreign key/i.test(error.message || ''))) {
      throw new Error('Ce fournisseur a des factures : il ne peut pas être supprimé (désactivez-le).');
    }
    check(error);
  }

  /**
   * Names already used on purchase orders and in the provider list, for the
   * "create from existing names" offer. Read only.
   */
  static async usedNames(): Promise<{ poNames: string[]; providerNames: string[] }> {
    const { companyId } = getCompanyContext();
    const q = (t: string, cols: string) => {
      let b = table(t).select(cols);
      if (companyId) b = b.eq('company_id', companyId);
      return b;
    };
    const [pos, providers] = await Promise.all([
      readAll<{ id: string; provider_name: string | null }>(() => q('purchase_orders', 'id, provider_name')).catch(() => []),
      readAll<{ id: string; name: string }>(() => q('providers', 'id, name')).catch(() => []),
    ]);
    return { poNames: pos.map(p => p.provider_name || ''), providerNames: providers.map(p => p.name) };
  }

  /** Link a purchase order to a supplier record (its text name is kept). */
  static async linkPurchaseOrder(poId: string, supplier: Supplier): Promise<void> {
    const { error } = await table('purchase_orders').update({ supplier_id: supplier.id }).eq('id', poId);
    check(error);
  }
}

// ── Invoices ──────────────────────────────────────────────────────────────
export interface InvoiceInput extends Partial<SupplierInvoice> {
  supplier_id: string;
  supplier_invoice_number: string;
  invoice_date: string;
  due_date: string;
}

/** Columns the app writes; number, status and paid amount belong to the database. */
const WRITABLE = [
  'supplier_id', 'supplier_invoice_number', 'invoice_date', 'reception_date', 'delivery_date', 'due_date', 'due_kind',
  'nature', 'is_works', 'description', 'ir_rate', 'ir_amount', 'litigation_amount', 'litigation_date',
  'judgment_amount', 'judgment_date', 'source_po_id', 'source_receipt_id', 'notes',
] as const;

export class SupplierInvoicesService {
  static async list(): Promise<SupplierInvoice[]> {
    const rows = await all<Record<string, unknown>>(() => scoped(table('supplier_invoices').select('*')));
    return rows.map(toInvoice).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  static async get(id: string): Promise<SupplierInvoice | null> {
    const { data, error } = await table('supplier_invoices').select('*').eq('id', id).maybeSingle();
    check(error);
    if (!data) return null;
    const inv = toInvoice(data);
    inv.lines = await this.lines([id]);
    return inv;
  }

  /** Lines of the given invoices, in order (all invoices when `ids` is omitted). */
  static async lines(ids?: string[]): Promise<SupplierInvoiceLine[]> {
    if (ids && ids.length === 0) return [];
    const out: SupplierInvoiceLine[] = [];
    if (!ids) {
      out.push(...(await all<Record<string, unknown>>(() => table('supplier_invoice_lines').select('*'))).map(toLine));
    } else {
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        out.push(...(await all<Record<string, unknown>>(() => table('supplier_invoice_lines').select('*').in('invoice_id', batch))).map(toLine));
      }
    }
    return out.sort((a, b) => a.position - b.position);
  }

  /**
   * Create or update a draft (or a validated invoice not yet booked: the
   * database refuses a booked one). Lines are replaced as a whole. A second
   * invoice with the same supplier and number is refused.
   */
  static async save(input: InvoiceInput, lines: SupplierInvoiceLine[], user?: string | null): Promise<SupplierInvoice> {
    const errors = invoiceErrors({ ...input, delivery_date: input.delivery_date ?? null, nature: input.nature || 'marchandises', due_kind: input.due_kind || 'legal' }, lines);
    if (errors.length) throw new Error(errors.join(' '));
    const existing = await all<SupplierInvoice>(() => scoped(table('supplier_invoices').select('id, supplier_id, supplier_invoice_number').eq('supplier_id', input.supplier_id)));
    if (isDuplicateNumber({ id: input.id, supplier_id: input.supplier_id, supplier_invoice_number: input.supplier_invoice_number }, existing)) {
      throw new Error(`La facture n° ${input.supplier_invoice_number.trim()} de ce fournisseur est déjà enregistrée.`);
    }
    const totals = invoiceTotals(lines);
    const payload: Record<string, unknown> = {};
    for (const k of WRITABLE) if (k in input) payload[k] = (input as unknown as Record<string, unknown>)[k] ?? null;
    payload.supplier_invoice_number = input.supplier_invoice_number.trim();
    payload.nature = input.nature || 'marchandises';
    payload.due_kind = input.due_kind || 'legal';
    payload.is_works = !!input.is_works;
    payload.ir_amount = r2(Number(input.ir_amount) || 0);
    Object.assign(payload, { total_ht: totals.ht, total_vat: totals.vat, total_ttc: totals.ttc, total_nondeductible_vat: totals.nonDeductibleVat });
    let id = input.id;
    if (id) {
      const { error } = await table('supplier_invoices').update(payload).eq('id', id);
      check(error);
    } else {
      const { companyId } = getCompanyContext();
      const { data, error } = await table('supplier_invoices').insert({ ...payload, company_id: input.company_id ?? companyId, status: 'draft', created_by: user ?? null }).select().single();
      check(error);
      id = (data as { id: string }).id;
    }
    // Replace the lines: removed first, so a refused insert leaves the
    // invoice without lines rather than with both sets (validation then refuses it).
    const del = await table('supplier_invoice_lines').delete().eq('invoice_id', id);
    check(del.error);
    if (lines.length) {
      const rows = lines.map((l, i) => ({
        invoice_id: id, position: i, label: l.label.trim(), barcode: (l.barcode || '').trim() || null,
        quantity: l.quantity == null || l.quantity === ('' as unknown) ? null : Number(l.quantity),
        amount_ht: r2(l.amount_ht), vat_rate: Number(l.vat_rate), vat_amount: r2(l.vat_amount),
        account_code: l.account_code.trim(), vat_nondeductible: !!l.vat_nondeductible,
      }));
      const ins = await table('supplier_invoice_lines').insert(rows);
      check(ins.error);
    }
    return (await this.get(id!))!;
  }

  /** Validate a draft: the database checks it, numbers it (FF-2026-0001) and locks the number. */
  static async validate(id: string): Promise<string> {
    const { data, error } = await (supabase as unknown as { rpc: (f: string, a: unknown) => PromiseLike<{ data: unknown; error: { message?: string } | null }> })
      .rpc('validate_supplier_invoice', { p_invoice_id: id });
    check(error);
    return String((data as { number?: string } | null)?.number || data || '');
  }

  /** Delete an invoice without payments that is not booked (the database checks both). */
  static async remove(id: string): Promise<void> {
    const { error } = await table('supplier_invoices').delete().eq('id', id);
    check(error);
  }

  // ── Payments ────────────────────────────────────────────────────────────
  static async payments(invoiceId?: string): Promise<SupplierPayment[]> {
    const rows = await all<Record<string, unknown>>(() => {
      const q = scoped(table('supplier_payments').select('*'));
      return invoiceId ? q.eq('invoice_id', invoiceId) : q;
    });
    return rows.map(toPayment).sort((a, b) => a.payment_date.localeCompare(b.payment_date) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  /**
   * The cash-limit result a new payment would get, with the supplier's other
   * payments of the month (for the warning while it is typed).
   */
  static async previewCashLimits(draft: Pick<SupplierPayment, 'supplier_id' | 'payment_date' | 'amount' | 'mode'>, vatRatio: number): Promise<CashLimitResult | undefined> {
    if (!isUnjustifiedMode(draft.mode) || !draft.payment_date) return undefined;
    const month = await this.monthPayments(draft.supplier_id, draft.payment_date);
    const results = cashLimits([...month.inputs, { id: '__new__', supplier_id: draft.supplier_id, payment_date: draft.payment_date, amount: Number(draft.amount) || 0, mode: draft.mode, vatRatio, created_at: '9999' }]);
    return results.get('__new__');
  }

  private static async monthPayments(supplierId: string, day: string) {
    const prefix = day.slice(0, 7);
    const payments = (await all<Record<string, unknown>>(() => scoped(table('supplier_payments').select('*').eq('supplier_id', supplierId)))).map(toPayment)
      .filter(p => p.payment_date.slice(0, 7) === prefix);
    const invoiceIds = [...new Set(payments.map(p => p.invoice_id))];
    const invoices = new Map<string, SupplierInvoice>();
    for (const id of invoiceIds) { const inv = await this.getHeader(id); if (inv) invoices.set(id, inv); }
    const ratio = (inv?: SupplierInvoice) => inv && inv.total_ttc > 0 ? (inv.total_vat - inv.total_nondeductible_vat) / inv.total_ttc : 0;
    return {
      payments, invoices,
      inputs: payments.map(p => ({ id: p.id, supplier_id: p.supplier_id, payment_date: p.payment_date, amount: p.amount, mode: p.mode, vatRatio: ratio(invoices.get(p.invoice_id)), created_at: p.created_at })),
    };
  }

  private static async getHeader(id: string): Promise<SupplierInvoice | null> {
    const { data, error } = await table('supplier_invoices').select('*').eq('id', id).maybeSingle();
    check(error);
    return data ? toInvoice(data) : null;
  }

  /**
   * Recompute the cash-limit amounts of a supplier's payments in a month and
   * flag their invoices, after a payment was added or removed there.
   */
  static async refreshCashLimits(supplierId: string, day: string): Promise<void> {
    const { payments, inputs } = await this.monthPayments(supplierId, day);
    const results = cashLimits(inputs);
    const touched = new Set<string>();
    for (const p of payments) {
      const r = results.get(p.id)!;
      touched.add(p.invoice_id);
      if (r2(r.vatNonDeductible) !== r2(p.cash_vat_nondeductible) || r2(r.expenseNonDeductible) !== r2(p.cash_expense_nondeductible)) {
        const { error } = await table('supplier_payments').update({ cash_vat_nondeductible: r.vatNonDeductible, cash_expense_nondeductible: r.expenseNonDeductible }).eq('id', p.id);
        check(error);
      }
    }
    for (const invoiceId of touched) {
      const all2 = await this.payments(invoiceId);
      const over = all2.some(p => p.cash_vat_nondeductible > 0 || p.cash_expense_nondeductible > 0);
      const { error } = await table('supplier_invoices').update({ cash_over_limit: over }).eq('id', invoiceId);
      check(error);
    }
  }

  static async addPayment(p: Omit<SupplierPayment, 'id' | 'company_id' | 'cash_vat_nondeductible' | 'cash_expense_nondeductible' | 'created_at'>, invoice: SupplierInvoice): Promise<SupplierPayment> {
    if (invoice.status === 'draft') throw new Error('Validez la facture avant d’enregistrer un règlement.');
    const settled = r2(num(p.amount) + num(p.vat_withheld) + num(p.ir_withheld));
    if (!(settled > 0)) throw new Error('Indiquez le montant réglé.');
    const left = r2(invoice.total_ttc - invoice.paid_amount);
    if (settled > left + 0.01) throw new Error(`Le règlement (${settled.toFixed(2)}) dépasse le reste à payer (${left.toFixed(2)}).`);
    if (num(p.amount) < 0 || num(p.vat_withheld) < 0 || num(p.ir_withheld) < 0) throw new Error('Montants négatifs refusés.');
    const { data, error } = await table('supplier_payments').insert({
      company_id: invoice.company_id, invoice_id: invoice.id, supplier_id: invoice.supplier_id,
      payment_date: p.payment_date, amount: r2(p.amount), mode: p.mode, reference: (p.reference || '').trim() || null,
      bank: (p.bank || '').trim() || null, vat_withholding_rate: num(p.vat_withholding_rate), vat_withheld: r2(p.vat_withheld),
      ir_withheld: r2(p.ir_withheld), notes: (p.notes || '').trim() || null, created_by: p.created_by ?? null,
    }).select().single();
    check(error);
    await this.refreshCashLimits(invoice.supplier_id, p.payment_date);
    await this.syncPaidAmount(invoice.id);
    return toPayment(data);
  }

  static async removePayment(p: SupplierPayment): Promise<void> {
    const { error } = await table('supplier_payments').delete().eq('id', p.id);
    check(error);
    await this.refreshCashLimits(p.supplier_id, p.payment_date);
    await this.syncPaidAmount(p.invoice_id);
  }

  /**
   * The database keeps paid_amount and the status in step with the payments
   * (trigger). Read back here so the page shows the result; on a database
   * without the trigger (tests), write it.
   */
  private static async syncPaidAmount(invoiceId: string): Promise<void> {
    const inv = await this.getHeader(invoiceId);
    if (!inv) return;
    const settled = r2((await this.payments(invoiceId)).reduce((s, p) => s + p.amount + p.vat_withheld + p.ir_withheld, 0));
    if (r2(inv.paid_amount) === settled) return;
    const status = statusFromAmounts(inv.status === 'draft', inv.total_ttc, settled);
    await table('supplier_invoices').update({ paid_amount: settled, status }).eq('id', invoiceId);
  }

  // ── Ledger ──────────────────────────────────────────────────────────────
  /** Entries generated from supplier documents (any status), by source id. */
  static async ledgerEntries(): Promise<Array<{ id: string; source_id: string | null; status: string; entry_number?: number | null }>> {
    const rows = await readAll<{ id: string; source_id: string | null; status: string; entry_number?: number | null }>(() => scoped(table('journal_entries')
      .select('id, source_id, status, entry_number').in('source_type', ['invoice', 'payment']))).catch(() => []);
    return rows.filter(r => isSupplierSourceId(r.source_id));
  }

  static bookingOf(entries: Array<{ source_id: string | null; status: string }>, kind: 'invoice' | 'payment', id: string) {
    return bookingState(entries, kind === 'invoice' ? invoiceSourceId(id) : paymentSourceId(id));
  }

  /** Draft (or posted, with autoPost) entry of a validated invoice. Refused when one exists. */
  static async postInvoice(inv: SupplierInvoice, supplier: Supplier | undefined, opts: { post?: boolean; createdBy?: string | null } = {}): Promise<JournalEntry> {
    const entries = await this.ledgerEntries();
    if (this.bookingOf(entries, 'invoice', inv.id) !== 'none') throw new Error('Cette facture a déjà une écriture (Saisie / journaux, journal AC).');
    const lines = inv.lines || await this.lines([inv.id]);
    const draft = buildSupplierInvoiceEntry(inv, lines, supplier);
    await AccountingService.ensureSeedAccounts([...SUPPLIER_LEDGER_ACCOUNTS, ...new Set(lines.map(l => l.account_code))]);
    const journals = await AccountingService.listJournals();
    return AccountingService.createFromDraft(draft, journals, opts);
  }

  static async postPayment(p: SupplierPayment, inv: SupplierInvoice, supplier: Supplier | undefined, opts: { post?: boolean; createdBy?: string | null } = {}): Promise<JournalEntry> {
    const entries = await this.ledgerEntries();
    if (this.bookingOf(entries, 'payment', p.id) !== 'none') throw new Error('Ce règlement a déjà une écriture.');
    const draft = buildSupplierPaymentEntry(p, inv, supplier);
    await AccountingService.ensureSeedAccounts([...SUPPLIER_LEDGER_ACCOUNTS]);
    const journals = await AccountingService.listJournals();
    return AccountingService.createFromDraft(draft, journals, opts);
  }
}

// ── Sources to prefill an invoice ─────────────────────────────────────────
export interface ReceptionSummary { sourceId: string; date: string; reason: string; lines: Array<{ barcode: string; quantity: number; unitCost: number }> }

export class PurchaseSourcesService {
  /** A purchase order with its lines (read apart: no embedded select). */
  static async purchaseOrder(id: string): Promise<{ id: string; po_number: string; supplier_id?: string | null; provider_id: string | null; provider_name: string | null; order_date: string; items: Array<{ barcode: string; label: string; qty_ordered: number; qty_received: number; unit_cost: number }> } | null> {
    const { data, error } = await table('purchase_orders').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const items = await readAll<Record<string, unknown>>(() => table('purchase_order_items').select('*').eq('po_id', id));
    return {
      ...data,
      items: items.sort((a, b) => num(a.sort_order) - num(b.sort_order)).map(i => ({
        barcode: String(i.barcode), label: String(i.label || i.barcode), qty_ordered: num(i.qty_ordered), qty_received: num(i.qty_received), unit_cost: num(i.unit_cost),
      })),
    };
  }

  /** Receptions (stock entries from a purchase order or a free reception), newest first. */
  static async receptions(limitDays = 180): Promise<ReceptionSummary[]> {
    const since = new Date(Date.now() - limitDays * 86_400_000).toISOString();
    const rows = await readAll<{ id: string; source_id: string | null; created_at: string; reason: string | null; barcode: string; quantity: number; unit_cost: number | null; company_id?: string | null }>(() => {
      const { companyId } = getCompanyContext();
      let q = table('stock_movements').select('id, source_id, created_at, reason, barcode, quantity, unit_cost, company_id').eq('source_type', 'receipt').gte('created_at', since);
      if (companyId) q = q.eq('company_id', companyId);
      return q;
    });
    const groups = new Map<string, ReceptionSummary>();
    for (const m of rows) {
      if (!m.source_id || !(num(m.quantity) > 0)) continue;
      const g = groups.get(m.source_id) || { sourceId: m.source_id, date: m.created_at, reason: m.reason || 'Réception', lines: [] };
      if (m.created_at > g.date) g.date = m.created_at;
      g.lines.push({ barcode: m.barcode, quantity: num(m.quantity), unitCost: num(m.unit_cost) });
      groups.set(m.source_id, g);
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Product names by barcode, for labels and the article picker. */
  static async productNames(): Promise<Map<string, string>> {
    type Row = { barcode: string; name: string };
    const rows = await readAll<Row>(() => table('products').select('barcode, name'), 'barcode').catch((): Row[] => []);
    return new Map(rows.map(r => [r.barcode, r.name]));
  }
}
