// What the invoiced stock (src/inventory/lib/invoicedStock.ts) is computed
// from: the company's opening (migration 20261127130000_invoiced_stock.sql),
// its supplier invoices with their goods lines, the sales invoices and credit
// notes it issued, and which credit notes were put back in stock.
//
// Everything is read page by page (readAll: the server returns 1,000 rows at
// most) once per company; the page then computes for any date without
// reading again.
//
// The owner may deploy the front end before running the migration: the
// opening then reads as "none" (installed: false) and saving it throws
// InvoicedStockSchemaMissingError, whose message says which script to run.

import { supabase } from './supabaseClient';
import { readAll, type Pageable } from './readAll';
import { isMissingDbObject } from './productCosts';
import { SupabaseDocumentsService } from './supabaseDocuments';
import { SUPPLIER_MIGRATION } from './supabaseSuppliers';
import { supplierDisplayName, type Supplier } from '../accounting/supplierInvoices';
import { returnKey, type InvoicedOpening, type OpeningLine, type PurchaseInvoiceInput, type SalesDocInput } from '../inventory/lib/invoicedStock';

export const INVOICED_STOCK_MIGRATION = '20261127130000_invoiced_stock.sql';

export class InvoicedStockSchemaMissingError extends Error {
  constructor() {
    super(`L’ouverture du stock facturé n’est pas encore installée : exécutez la migration ${INVOICED_STOCK_MIGRATION} dans Supabase.`);
    this.name = 'InvoicedStockSchemaMissingError';
  }
}

type DbError = { code?: string; message?: string };
// The generated Database types do not list these tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => (supabase as any).from(name);
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }> }).rpc(fn, args);

const num = (v: unknown) => Number(v) || 0;
// Requests of `in()` batches running at once: enough to keep a few thousand
// invoices quick without flooding the server.
const PARALLEL = 4;
const BATCH = 200;

async function inBatches<T>(ids: string[], read: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  const out: T[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const wave = await Promise.all(batches.slice(i, i + PARALLEL).map(read));
    for (const rows of wave) out.push(...rows);
  }
  return out;
}

export interface OpeningState { opening: InvoicedOpening | null; installed: boolean }

export interface PurchasesState {
  invoices: PurchaseInvoiceInput[];
  /** False when the supplier invoices migration was not run. */
  installed: boolean;
}

export class InvoicedStockService {
  /** The company's opening, or null; installed is false before the migration. */
  static async opening(companyId: string): Promise<OpeningState> {
    const { data, error } = await table('invoiced_stock_openings')
      .select('id, as_of, saved_by, updated_at').eq('company_id', companyId).maybeSingle();
    if (error) {
      if (isMissingDbObject(error)) return { opening: null, installed: false };
      throw new Error(`Ouverture du stock facturé : ${error.message}`);
    }
    if (!data) return { opening: null, installed: true };
    const head = data as { id: string; as_of: string; saved_by: string | null; updated_at: string | null };
    const lines = await readAll<{ id: string; barcode: string; quantity: number | string }>(
      () => table('invoiced_stock_opening_lines').select('id, barcode, quantity').eq('opening_id', head.id) as Pageable<{ id: string; barcode: string; quantity: number | string }>,
    );
    return {
      installed: true,
      opening: {
        asOf: String(head.as_of).slice(0, 10),
        quantities: new Map(lines.map(l => [l.barcode, num(l.quantity)])),
        savedAt: head.updated_at, savedBy: head.saved_by,
      },
    };
  }

  /**
   * Replace the company's opening (date and every line) in one transaction.
   * Zero quantities are not stored.
   */
  static async saveOpening(companyId: string, asOf: string, lines: OpeningLine[]): Promise<number> {
    const payload = lines.filter(l => Number(l.quantity) !== 0).map(l => ({ barcode: l.barcode.trim(), quantity: Number(l.quantity) }));
    const { data, error } = await rpc('replace_invoiced_stock_opening', { p_company_id: companyId, p_as_of: asOf, p_lines: payload });
    if (error) {
      if (isMissingDbObject(error)) throw new InvoicedStockSchemaMissingError();
      throw new Error(error.message || 'Enregistrement de l’ouverture impossible');
    }
    return num((data as { lines?: number } | null)?.lines ?? payload.length);
  }

  /** Validated supplier invoices of the company with their lines and supplier names. */
  static async purchases(companyId: string): Promise<PurchasesState> {
    type Head = { id: string; company_id: string | null; number: string | null; supplier_invoice_number: string; supplier_id: string; invoice_date: string; status: string };
    type Line = { id: string; invoice_id: string; barcode: string | null; quantity: number | string | null; amount_ht: number | string; account_code: string; label: string };
    let heads: Head[];
    try {
      heads = await readAll<Head>(() => table('supplier_invoices')
        .select('id, company_id, number, supplier_invoice_number, supplier_id, invoice_date, status')
        .eq('company_id', companyId).neq('status', 'draft'));
    } catch (e) {
      if (isMissingDbObject(e)) return { invoices: [], installed: false };
      throw new Error(`Factures fournisseurs : ${(e as DbError)?.message || e}`);
    }
    const [lines, suppliers] = await Promise.all([
      inBatches(heads.map(h => h.id), batch => readAll<Line>(() => table('supplier_invoice_lines')
        .select('id, invoice_id, barcode, quantity, amount_ht, account_code, label').in('invoice_id', batch))),
      readAll<Supplier>(() => table('suppliers').select('id, name, first_name, legal_type').eq('company_id', companyId)).catch((): Supplier[] => []),
    ]);
    const names = new Map(suppliers.map(s => [s.id, supplierDisplayName(s)]));
    const byInvoice = new Map<string, Line[]>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id);
      if (list) list.push(l); else byInvoice.set(l.invoice_id, [l]);
    }
    return {
      installed: true,
      invoices: heads.map(h => ({
        ...h,
        supplierName: names.get(h.supplier_id) || '',
        lines: (byInvoice.get(h.id) || []).map(l => ({
          barcode: l.barcode, quantity: l.quantity == null ? null : num(l.quantity), amount_ht: num(l.amount_ht), account_code: l.account_code, label: l.label,
        })),
      })),
    };
  }

  /** Issued sales invoices and credit notes of the company (it is their issuer). */
  static async sales(companyId: string): Promise<SalesDocInput[]> {
    const [invoices, credits] = await Promise.all([
      SupabaseDocumentsService.getForLedger('invoice', companyId),
      SupabaseDocumentsService.getForLedger('avoir', companyId),
    ]);
    return [...invoices, ...credits].map(d => ({
      id: d.id, quoteNumber: d.quoteNumber, document_type: d.document_type, status: d.status,
      issuing_company_id: d.issuing_company_id ?? null, company_id: d.company_id ?? null,
      quote_date: d.quote_date, createdAt: d.createdAt, customer: d.customer, tva_rate: d.tva_rate ?? null,
      parent_document_id: d.parent_document_id ?? null, totalAmount: d.totalAmount, items: d.items,
    }));
  }

  /**
   * `returnKey(creditNote, barcode)` of the products the given credit notes
   * put back in stock ("Remettre en stock" posts 'return' movements whose
   * source is the credit note).
   */
  static async returnedToStock(creditNoteIds: string[]): Promise<Set<string>> {
    const wanted = new Set(creditNoteIds);
    if (wanted.size === 0) return new Set();
    type Row = { id: string; source_id: string | null; barcode: string; quantity: number | string };
    const rows = await readAll<Row>(() => table('stock_movements').select('id, source_id, barcode, quantity').eq('source_type', 'return'));
    const out = new Set<string>();
    for (const r of rows) if (r.source_id && wanted.has(r.source_id) && num(r.quantity) > 0) out.add(returnKey(r.source_id, r.barcode));
    return out;
  }
}

export { SUPPLIER_MIGRATION };
