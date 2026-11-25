import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { Quote, QuoteItem, CustomerInfo } from '../types';
import { addDays, daysBetween, documentDay, documentTotal, dueDateError, invoicePayment, isProvisionalNumber, localDay, mergeLines, provisionalNumber, recomputeLine, sameCustomer, DEFAULT_PAYMENT_DAYS } from './documentLines';
import { readAll, type Pageable } from './readAll';
import { writeTolerant, type DbResult } from './schemaFallback';

const round2 = (n: number) => Math.round(n * 100) / 100;

// Columns added by 20261125120000_billing_compliance.sql. Until the owner runs
// it, writes retry without them and reads see them as null.
const NEW_DOC_COLUMNS = ['tva_rate', 'due_date'];

// The few query-builder calls the new code uses, typed loosely like
// homeData's looseDb() (the generated types do not know these columns).
interface LooseQuery extends PromiseLike<DbResult<unknown>> {
  select(columns?: string): LooseQuery;
  insert(values: unknown): LooseQuery;
  update(values: unknown): LooseQuery;
  delete(): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  neq(column: string, value: unknown): LooseQuery;
  gt(column: string, value: unknown): LooseQuery;
  or(filter: string): LooseQuery;
  order(column: string, options?: { ascending?: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
  single(): LooseQuery;
  maybeSingle(): LooseQuery;
}
const table = (name: string) => (supabase as unknown as { from(t: string): LooseQuery }).from(name);
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<DbResult<unknown>> }).rpc(fn, args);

/** What a user sees when a booked invoice or credit note would change. */
export const POSTED_INVOICE_MESSAGE = 'Cette facture est comptabilisée. Extournez son écriture dans Comptabilité ou établissez un avoir.';
export const POSTED_AVOIR_MESSAGE = 'Cet avoir est comptabilisé. Extournez son écriture dans Comptabilité pour le modifier.';
const postedMessage = (type: string | null | undefined) => (type === 'avoir' ? POSTED_AVOIR_MESSAGE : POSTED_INVOICE_MESSAGE);

/** "FAC2611-12" → { prefix: "FAC", ym: "2611", n: 12 }; null for a number typed by hand. */
export function parseInvoiceNumber(number: string): { prefix: string; ym: string; n: number } | null {
  const m = /^(.*?)(\d{2}(?:0[1-9]|1[0-2]))-(\d+)$/.exec((number || '').trim());
  return m ? { prefix: m[1], ym: m[2], n: Number(m[3]) } : null;
}

/** YYMM of a YYYY-MM-DD day. */
const yearMonthOfDay = (day: string) => `${day.slice(2, 4)}${day.slice(5, 7)}`;

/** A call to a database function that does not exist yet (migration not run). */
function isMissingFunction(error: { code?: string; message?: string } | null | undefined, name: string): boolean {
  if (!error) return false;
  const message = error.message || '';
  return error.code === 'PGRST202' || error.code === '42883'
    || new RegExp(`(function|rpc)\\s+(public\\.)?${name}\\b.*(does not exist|missing)|could not find the function[^\\n]*${name}`, 'i').test(message);
}

/** Shown when a draft is finalised by someone else at the same moment. */
export const ALREADY_FINALISED_MESSAGE = 'Cette facture vient d’être finalisée par quelqu’un d’autre : rechargez la page.';

/** Why a draft invoice cannot be finalised yet, or null. */
export function finaliseError(doc: { customer?: { fullName?: string } | null; items?: unknown[] | null }): string | null {
  if (!doc.customer?.fullName?.trim()) return 'Indiquez le client avant de finaliser la facture.';
  if (!doc.items?.length) return 'Ajoutez au moins une ligne avant de finaliser la facture.';
  return null;
}

// Customer fields a booked invoice can still receive: completing the buyer's
// ICE or address (mandatory mentions) changes neither who was invoiced nor
// any amount in the books. The database trigger ignores the same keys.
const CUSTOMER_FILLABLE = new Set(['ice', 'address', 'isIndividual']);
function customerIdentity(c: unknown): string {
  const entries = Object.entries((c || {}) as Record<string, unknown>)
    .filter(([k]) => !CUSTOMER_FILLABLE.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

// What a line contributes to the books and to the printed invoice.
const lineKey = (i: QuoteItem) => JSON.stringify([i.id, Number(i.quantity) || 0, Number(i.unitPrice) || 0, Number(i.discount) || 0, Number(i.subtotal) || 0,
  i.quoteName ?? i.product?.name ?? '', i.quoteBrand ?? i.product?.brand ?? '', i.quoteBarcode ?? i.product?.barcode ?? '']);
const sameLines = (a: QuoteItem[], b: QuoteItem[]) => a.length === b.length && a.every((item, i) => lineKey(item) === lineKey(b[i]));

// Extended row type with financial pipeline columns
type DocRow = {
  id: string;
  quote_number: string;
  command_number: string | null;
  created_at: string;
  updated_at: string;
  status: string;
  customer_info: unknown;
  items: unknown;
  total_amount: number;
  notes: string | null;
  notes2: string | null;
  created_by: string | null;
  document_type: string | null;
  parent_document_id: string | null;
  source_bl_ids: string[] | null;
  paid_amount: number | null;
  issuing_company_id: string | null;
  company_id: string | null;
  payment_date: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  payment_bank: string | null;
  is_locked: boolean | null;
  avance_amount: number | null;
  payment_methods_json: unknown;
  quote_date: string | null;
  // Absent before the billing compliance migration.
  tva_rate?: number | string | null;
  due_date?: string | null;
};

function mapDocRow(row: DocRow): Quote {
  const items = (Array.isArray(row.items) ? row.items : []) as QuoteItem[];
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    commandNumber: row.command_number || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: (row.status || 'draft') as Quote['status'],
    customer: row.customer_info as CustomerInfo,
    items: items.map((item: QuoteItem) => ({
      ...item,
      addedAt: new Date(item.addedAt),
    })),
    totalAmount: Number(row.total_amount),
    notes: row.notes || undefined,
    notes2: row.notes2 || undefined,
    createdBy: row.created_by || undefined,
    document_type: (row.document_type || 'quote') as Quote['document_type'],
    parent_document_id: row.parent_document_id || undefined,
    source_bl_ids: row.source_bl_ids || [],
    paid_amount: Number(row.paid_amount || 0),
    issuing_company_id: row.issuing_company_id || undefined,
    company_id: row.company_id || undefined,
    payment_date: row.payment_date || undefined,
    payment_method: row.payment_method || undefined,
    payment_reference: row.payment_reference || undefined,
    payment_bank: row.payment_bank || undefined,
    is_locked: row.is_locked ?? false,
    avance_amount: Number(row.avance_amount || 0),
    payment_methods_json: (Array.isArray(row.payment_methods_json) ? row.payment_methods_json : []) as Quote['payment_methods_json'],
    quote_date: row.quote_date || undefined,
    tva_rate: row.tva_rate !== null && row.tva_rate !== undefined && row.tva_rate !== '' ? Number(row.tva_rate) : undefined,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : undefined,
  };
}

export interface ClientFinancialRow {
  clientId?: string;       // id from clients table — undefined for legacy quote-only customers
  clientName: string;
  fullName: string;
  phoneNumber: string;
  clientCode?: string;
  totalAmount: number;
  /** Settled: money received plus VAT withheld by the client. */
  paidAmount: number;
  /** Part of paidAmount the client withheld as VAT (art. 117-IV), not money received. */
  withheldAmount: number;
  remaining: number;
  proformaCount: number;
  invoiceCount: number;
  /**
   * Lower-case name whose documents without a phone belong to this client too
   * (a registered client without a phone, or whose old documents had none).
   * The statement uses the same rule, so it always matches the balance.
   */
  nameMatch?: string;
}

const nameKey = (name: string | null | undefined) => (name || '').trim().toLowerCase();

export interface DocumentUpdates {
  quoteNumber?: string;
  customer?: CustomerInfo;
  items?: QuoteItem[];
  notes?: string | null;
  notes2?: string | null;
  status?: string;
  payment_date?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_bank?: string | null;
  is_locked?: boolean;
  avance_amount?: number | null;
  payment_methods_json?: unknown;
  quote_date?: string | null;
  paid_amount?: number;
  /** Invoices: YYYY-MM-DD, between the invoice date and 120 days after it. */
  due_date?: string | null;
}

export class SupabaseDocumentsService {
  // Format a sequential counter.
  // BL/Proforma: "BL-0001", "PRO-0042"
  // Invoice: "{prefix}{YYMM}-{n}" e.g. "CM2601-7" (monthly reset, no zero-padding)
  static formatDocNumber(
    type: 'bl' | 'proforma' | 'invoice' | 'bon_commande',
    n: number,
    companyPrefix?: string,
    yearMonth?: string
  ): string {
    if (type === 'invoice') {
      const pfx = companyPrefix || 'FAC';
      const ym = yearMonth || this.currentYearMonth();
      return `${pfx}${ym}-${n}`;
    }
    const prefix: Record<string, string> = { bl: 'BL', proforma: 'PRO', bon_commande: 'BC' };
    return `${prefix[type]}-${String(n).padStart(4, '0')}`;
  }

  static currentYearMonth(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${yy}${mm}`;
  }

  // Atomically increment the per-company counter and return the formatted string.
  // For invoices: uses monthly doc_type key (e.g. "invoice_2601") and fetches company doc_prefix.
  // The month is the invoice's own date (`invoiceDay`, YYYY-MM-DD), today by default.
  static async nextNumber(companyId: string, type: 'bl' | 'proforma' | 'invoice' | 'bon_commande', invoiceDay?: string): Promise<string> {
    if (type === 'invoice') {
      const ym = invoiceDay ? yearMonthOfDay(invoiceDay) : this.currentYearMonth();
      const docTypeKey = `invoice_${ym}`;
      const { data, error } = await (supabase.rpc as any)('next_document_number', {
        p_company_id: companyId,
        p_doc_type: docTypeKey,
      });
      if (error) throw new Error(`Erreur numérotation: ${error.message}`);

      // Fetch company doc_prefix
      const { data: company } = await (supabase.from('companies') as any)
        .select('doc_prefix')
        .eq('id', companyId)
        .maybeSingle();
      const prefix = (company?.doc_prefix as string) || 'FAC';
      return this.formatDocNumber('invoice', data as number, prefix, ym);
    }

    const { data, error } = await (supabase.rpc as any)('next_document_number', {
      p_company_id: companyId,
      p_doc_type: type,
    });
    if (error) throw new Error(`Erreur numérotation: ${error.message}`);
    return this.formatDocNumber(type as 'bl' | 'proforma' | 'bon_commande', data as number);
  }

  /**
   * The billing settings of the company issuing a document: its VAT rate now
   * and its payment delay. Read with select('*'), so a database without the
   * payment_terms_days column still answers (60 days then).
   */
  static async companyBilling(companyId: string | null | undefined): Promise<{ tvaRate: number; paymentDays: number }> {
    const fallback = { tvaRate: 20, paymentDays: DEFAULT_PAYMENT_DAYS };
    if (!companyId) return fallback;
    const { data } = await table('companies').select('*').eq('id', companyId).maybeSingle();
    const row = data as { tva_rate?: number | string | null; payment_terms_days?: number | null } | null;
    if (!row) return fallback;
    const rate = Number(row.tva_rate);
    const days = Number(row.payment_terms_days);
    return {
      tvaRate: row.tva_rate !== null && row.tva_rate !== undefined && Number.isFinite(rate) ? rate : 20,
      paymentDays: row.payment_terms_days !== null && row.payment_terms_days !== undefined && Number.isFinite(days) ? days : DEFAULT_PAYMENT_DAYS,
    };
  }

  /** The rate a new document takes: its source document's, else the issuing company's current rate. */
  private static async rateFor(source: { tva_rate?: number | string | null } | null | undefined, companyId: string | null | undefined): Promise<number> {
    const stored = source?.tva_rate;
    if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) return Number(stored);
    return (await this.companyBilling(companyId)).tvaRate;
  }

  /** Insert a document; on a database without the new columns, insert it without them. */
  private static async insertDoc(row: Record<string, unknown>, errorPrefix: string): Promise<Quote> {
    const { data, error } = await writeTolerant(row, NEW_DOC_COLUMNS, payload => table('quotes').insert(payload).select('*').single());
    if (error) throw new Error(`${errorPrefix}: ${error.message}`);
    return mapDocRow(data as DocRow);
  }

  /**
   * Whether a document has a validated (not reversed) journal entry: its
   * entry carries the document id as source_id. Payment entries use derived
   * ids ("<id>:pay…") and do not count: payments can still be recorded.
   * The database function sees every company's books (a billing user may
   * edit another company's invoice); before the migration, the entries the
   * user can read are checked directly, and no accounting tables means no
   * entries.
   */
  static async isPosted(documentId: string): Promise<boolean> {
    const viaFunction = await rpc('stocky_document_is_posted', { p_document_id: documentId });
    if (!viaFunction.error) return viaFunction.data === true;
    const { data, error } = await table('journal_entries').select('id').eq('source_id', documentId).eq('status', 'posted').limit(1);
    if (error) return false;
    return ((data as unknown[]) || []).length > 0;
  }

  // Create a BL copy from an existing quote.
  // Original quote status is set to 'final'. Returns the new BL.
  static async createBLFromQuote(quoteId: string): Promise<Quote> {
    // Fetch the source quote
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', quoteId)
      .single();
    if (srcErr || !srcData) throw new Error('Devis introuvable');

    const src = mapDocRow(srcData as DocRow);
    const companyId = (srcData as DocRow).company_id || getCompanyContext().companyId;
    if (!companyId) throw new Error('Le devis ne possède pas de société associée');

    // A quote is delivered once: a second BL would ship (and invoice) the goods twice.
    const { data: existingBL } = await (supabase.from('quotes') as any)
      .select('quote_number')
      .eq('parent_document_id', quoteId)
      .eq('document_type', 'bl')
      .limit(1);
    if ((existingBL as any[])?.length) {
      throw new Error(`Ce devis a déjà un BL (${(existingBL as any[])[0].quote_number}).`);
    }

    // Get next BL number
    const blNumber = await this.nextNumber(companyId, 'bl');
    const now = new Date().toISOString();

    // Insert new BL document
    const newId = crypto.randomUUID();
    const blData: Record<string, unknown> = {
      id: newId,
      quote_number: blNumber,
      created_at: now,
      updated_at: now,
      status: 'draft',
      customer_info: src.customer,
      items: src.items,
      total_amount: src.totalAmount,
      notes: src.notes || null,
      created_by: src.createdBy || null,
      document_type: 'bl',
      parent_document_id: quoteId,
      source_bl_ids: [],
      paid_amount: 0,
      company_id: companyId,
      // The delivery note keeps the quote's VAT rate.
      tva_rate: await this.rateFor(srcData as DocRow, (srcData as DocRow).issuing_company_id || companyId),
    };

    const bl = await this.insertDoc(blData, 'Erreur création BL');

    // Mark the original quote as final
    await (supabase.from('quotes') as any)
      .update({ status: 'final', updated_at: now })
      .eq('id', quoteId);

    return bl;
  }

  // Merge multiple BLs into a single Proforma.
  // Items from all BLs are flattened (same barcode = sum quantities).
  // Source BL status is set to 'final'. Returns the new Proforma.
  static async createProformaFromBLs(blIds: string[], targetCompanyId: string): Promise<Quote> {
    const ids = Array.from(new Set(blIds));
    if (ids.length === 0) throw new Error('Aucun BL sélectionné');
    const { data: blRows, error: blErr } = await (supabase.from('quotes') as any)
      .select('*')
      .in('id', ids);
    if (blErr || !blRows || (blRows as any[]).length !== ids.length) throw new Error('BLs introuvables');

    const bls = (blRows as DocRow[])
      .filter(r => r.document_type === 'bl')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(mapDocRow);
    if (bls.length !== ids.length) throw new Error('Seuls des BL peuvent être fusionnés');

    const customer = bls[0].customer;
    if (!bls.every(bl => sameCustomer(bl.customer, customer))) {
      throw new Error('Les BL sélectionnés concernent des clients différents : fusionnez uniquement les BL d\'un même client.');
    }
    const converted = bls.filter(bl => bl.status === 'final');
    if (converted.length) {
      throw new Error(`Déjà transformé en proforma : ${converted.map(b => b.quoteNumber).join(', ')}`);
    }
    // Lines are stored TTC: lines taxed at different rates cannot share the
    // single rate of one proforma.
    const rates = [...new Set(bls.map(bl => bl.tva_rate).filter((r): r is number => r !== undefined))];
    if (rates.length > 1) {
      throw new Error(`Ces BL ont des taux de TVA différents (${rates.join(' %, ')} %) : faites un proforma par taux.`);
    }
    const { data: holders } = await (supabase.from('quotes') as any)
      .select('quote_number')
      .eq('document_type', 'proforma')
      .overlaps('source_bl_ids', ids)
      .limit(1);
    if ((holders as any[])?.length) {
      throw new Error(`Ces BL figurent déjà dans le proforma ${(holders as any[])[0].quote_number}.`);
    }

    // Claim the BLs before creating the proforma: of two people merging the
    // same BL at once, only one gets it.
    const now = new Date().toISOString();
    const { data: claimed, error: claimErr } = await (supabase.from('quotes') as any)
      .update({ status: 'final', updated_at: now })
      .in('id', ids)
      .neq('status', 'final')
      .select('id');
    if (claimErr) throw new Error(`Erreur création Proforma: ${claimErr.message}`);
    const claimedIds = ((claimed as { id: string }[]) || []).map(r => r.id);
    const release = () => claimedIds.length
      ? (supabase.from('quotes') as any).update({ status: 'draft', updated_at: new Date().toISOString() }).in('id', claimedIds)
      : Promise.resolve();
    if (claimedIds.length !== ids.length) {
      await release();
      throw new Error('Un de ces BL vient d\'être transformé par quelqu\'un d\'autre. Rechargez la page.');
    }

    try {
      const mergedItems = mergeLines(bls.flatMap(bl => bl.items))
        .map(item => ({ ...item, is_billed: false, billed_by_company_id: undefined, billed_invoice_id: undefined }));
      const blNums = bls.map(b => b.quoteNumber).join(', ');
      const proformaNumber = await this.nextNumber(targetCompanyId, 'proforma');

      const proformaData: Record<string, unknown> = {
        id: crypto.randomUUID(),
        quote_number: proformaNumber,
        created_at: now,
        updated_at: now,
        status: 'draft',
        customer_info: customer,
        items: mergedItems,
        total_amount: documentTotal(mergedItems),
        notes: `Proforma créé depuis les BL : ${blNums}`,
        created_by: null,
        document_type: 'proforma',
        parent_document_id: null,
        source_bl_ids: bls.map(b => b.id),
        paid_amount: 0,
        company_id: targetCompanyId,
        tva_rate: rates.length ? rates[0] : (await this.companyBilling(targetCompanyId)).tvaRate,
      };

      return await this.insertDoc(proformaData, 'Erreur création Proforma');
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** The proforma a BL was merged into, if any. */
  static async findProformaForBL(blId: string): Promise<{ id: string; quoteNumber: string } | null> {
    const { data } = await (supabase.from('quotes') as any)
      .select('id, quote_number')
      .eq('document_type', 'proforma')
      .contains('source_bl_ids', [blId])
      .limit(1);
    const row = (data as { id: string; quote_number: string }[] | null)?.[0];
    return row ? { id: row.id, quoteNumber: row.quote_number } : null;
  }

  // Billed amount of a proforma and its status, from its lines.
  private static proformaBilling(items: QuoteItem[]) {
    const billed = documentTotal(items.filter(i => i.is_billed === true));
    const allBilled = items.length > 0 && items.every(i => i.is_billed === true);
    const anyBilled = items.some(i => i.is_billed === true);
    return { paid_amount: billed, status: allBilled ? 'solde' : anyBilled ? 'pending' : 'draft' };
  }

  // Write a proforma's lines only if nobody changed it since `updatedAt`.
  private static async swapProformaItems(proformaId: string, updatedAt: string, items: QuoteItem[]): Promise<boolean> {
    const { data, error } = await (supabase.from('quotes') as any)
      .update({ items, ...this.proformaBilling(items), updated_at: new Date().toISOString() })
      .eq('id', proformaId)
      .eq('updated_at', updatedAt)
      .select('id');
    if (error) throw new Error(`Erreur mise à jour proforma: ${error.message}`);
    return ((data as unknown[]) || []).length === 1;
  }

  /**
   * Lines to save from a proforma edit. Billing state comes from the database,
   * not from the edit: a line billed since the edit started stays billed, and
   * one freed by a deleted invoice stays free.
   */
  static async keepBilledLines(proformaId: string, draft: QuoteItem[]): Promise<QuoteItem[]> {
    const { data } = await (supabase.from('quotes') as any).select('items').eq('id', proformaId).maybeSingle();
    const current = (Array.isArray(data?.items) ? data.items : []) as QuoteItem[];
    const currentById = new Map(current.map(i => [i.id, i]));
    const kept = draft.map(item => {
      const now = currentById.get(item.id);
      return now && (now.is_billed || item.is_billed) ? now : item;
    });
    const draftIds = new Set(draft.map(i => i.id));
    return [...kept, ...current.filter(i => i.is_billed && !draftIds.has(i.id))];
  }

  // Generate an Invoice from selected Proforma items (by item id).
  // The lines are claimed on the proforma first (compare-and-swap), so the
  // same line can never end up on two invoices.
  static async createInvoiceFromProforma(
    proformaId: string,
    selectedItemIds: string[],
    issuingCompanyId: string
  ): Promise<Quote> {
    const { data: proformaData, error: pfErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', proformaId)
      .single();
    if (pfErr || !proformaData) throw new Error('Proforma introuvable');

    const row = proformaData as DocRow;
    const proforma = mapDocRow(row);
    const selectedItems = proforma.items.filter(item => selectedItemIds.includes(item.id));
    if (selectedItems.length === 0) throw new Error('Aucun article sélectionné');
    const alreadyBilled = selectedItems.filter(i => i.is_billed === true);
    if (alreadyBilled.length) {
      throw new Error(`Déjà facturé : ${alreadyBilled.map(i => i.quoteName || i.product?.name || i.id).join(', ')}. Rechargez la page.`);
    }

    const invoiceId = crypto.randomUUID();
    const mark = (i: QuoteItem): QuoteItem => ({ ...i, is_billed: true, billed_by_company_id: issuingCompanyId, billed_invoice_id: invoiceId });
    const claimedItems = proforma.items.map(item => selectedItemIds.includes(item.id) ? mark(item) : item);
    if (!await this.swapProformaItems(proformaId, row.updated_at, claimedItems)) {
      throw new Error('Le proforma a été modifié entre-temps (autre onglet ou utilisateur). Rechargez la page et recommencez.');
    }

    let inserted = false;
    try {
      const today = localDay();
      const billing = await this.companyBilling(issuingCompanyId);
      const now = new Date().toISOString();
      const invoiceItems = selectedItems.map(mark);
      // Saved as a draft first, then finalised: the number is taken in the
      // same step that issues the invoice, so a failed save burns no number.
      const invoiceData: Record<string, unknown> = {
        id: invoiceId,
        quote_number: provisionalNumber(invoiceId),
        created_at: now,
        updated_at: now,
        status: 'draft',
        customer_info: proforma.customer,
        items: invoiceItems,
        total_amount: documentTotal(invoiceItems),
        notes: `Facture générée depuis ${proforma.quoteNumber}`,
        created_by: null,
        document_type: 'invoice',
        parent_document_id: proformaId,
        source_bl_ids: [],
        paid_amount: 0,
        issuing_company_id: issuingCompanyId,
        company_id: row.company_id || null,
        // The proforma's rate (the lines were priced with it); due date from
        // the issuing company's payment delay.
        tva_rate: await this.rateFor(row, issuingCompanyId),
        due_date: addDays(today, billing.paymentDays),
      };
      const draft = await this.insertDoc(invoiceData, 'Erreur création Facture');
      inserted = true;
      // A proforma without a client gives a draft to complete, finalised later.
      if (finaliseError(draft)) return draft;
      return await this.finalizeInvoice(invoiceId);
    } catch (e) {
      if (inserted) await table('quotes').delete().eq('id', invoiceId).eq('status', 'draft').then(() => undefined, () => undefined);
      await this.releaseInvoiceLines(proformaId, invoiceId, selectedItemIds).catch(() => {});
      throw e;
    }
  }

  /**
   * Issue a draft invoice: it takes the next number of its issuer's series
   * for the month of its date (CGI art. 145-III, continuous series) and
   * becomes final, in one step.
   *
   * The database function stocky_finalize_invoice (migration
   * 20261126130000) does it in one transaction: the row is locked, the
   * series of that company and month is serialised, the counter is advanced
   * through next_document_number and a number already used is skipped; if
   * anything fails the counter goes back with the rest. Two people
   * finalising at once get two different numbers, in the order they finalise.
   *
   * Before the migration, the same is done from here: the number is taken,
   * then written only if the invoice is still the same draft. A failure
   * between the two leaves that number unused (a gap), as before.
   *
   * A draft that already holds a series number (created before numbering at
   * finalisation) keeps it.
   */
  static async finalizeInvoice(id: string): Promise<Quote> {
    const { data: current, error: readError } = await table('quotes').select('*').eq('id', id).maybeSingle();
    if (readError) throw new Error(`Erreur finalisation: ${readError.message}`);
    const row = current as DocRow | null;
    if (!row) throw new Error('Facture introuvable');
    if (row.document_type !== 'invoice') throw new Error('Seule une facture se finalise.');
    if (row.status !== 'draft') return mapDocRow(row);
    const problem = finaliseError(mapDocRow(row));
    if (problem) throw new Error(problem);

    const viaFunction = await rpc('stocky_finalize_invoice', { p_invoice_id: id });
    if (!viaFunction.error) {
      const { data: saved } = await table('quotes').select('*').eq('id', id).maybeSingle();
      if (!saved) throw new Error('Facture introuvable');
      return mapDocRow(saved as DocRow);
    }
    if (!isMissingFunction(viaFunction.error, 'stocky_finalize_invoice')) {
      throw new Error(viaFunction.error.message || 'Erreur finalisation');
    }

    const now = new Date().toISOString();
    if (!isProvisionalNumber(row.quote_number)) {
      const { data, error } = await table('quotes').update({ status: 'final', updated_at: now }).eq('id', id).eq('status', 'draft').select('*');
      if (error) throw new Error(`Erreur finalisation: ${error.message}`);
      const rows = (data as DocRow[]) || [];
      if (rows.length !== 1) throw new Error(ALREADY_FINALISED_MESSAGE);
      return mapDocRow(rows[0]);
    }
    const issuer = row.issuing_company_id || row.company_id || getCompanyContext().companyId;
    if (!issuer) throw new Error('Société émettrice inconnue : impossible de numéroter la facture.');
    const day = row.quote_date ? String(row.quote_date).slice(0, 10) : localDay(new Date(row.created_at));
    let number = await this.nextNumber(issuer, 'invoice', day);
    // A number already in the series (typed by hand, or a counter behind the
    // data) is skipped rather than given twice.
    for (let guard = 0; guard < 20 && await this.invoiceNumberTaken(issuer, number, id); guard++) {
      number = await this.nextNumber(issuer, 'invoice', day);
    }
    const { data, error } = await table('quotes')
      .update({ quote_number: number, status: 'final', updated_at: now })
      .eq('id', id).eq('status', 'draft').eq('quote_number', row.quote_number)
      .select('*');
    if (error) throw new Error(`Erreur finalisation: ${error.message}`);
    const rows = (data as DocRow[]) || [];
    if (rows.length !== 1) throw new Error(ALREADY_FINALISED_MESSAGE);
    return mapDocRow(rows[0]);
  }

  /** Whether another invoice of the issuer already carries this number. */
  private static async invoiceNumberTaken(issuer: string, number: string, exceptId: string): Promise<boolean> {
    const { data, error } = await table('quotes')
      .select('id, issuing_company_id, company_id')
      .eq('document_type', 'invoice')
      .eq('quote_number', number)
      .limit(5);
    if (error) return false;
    return ((data as DocRow[]) || []).some(r => r.id !== exceptId && (r.issuing_company_id || r.company_id) === issuer);
  }

  // Put a proforma's lines back to "not billed" after their invoice is gone.
  // Lines billed before `billed_invoice_id` existed are matched by id.
  private static async releaseInvoiceLines(proformaId: string, invoiceId: string, itemIds: string[]): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await (supabase.from('quotes') as any)
        .select('items, updated_at')
        .eq('id', proformaId)
        .maybeSingle();
      if (!data) return;
      const items = (Array.isArray(data.items) ? data.items : []) as QuoteItem[];
      const released = items.map(item => {
        const ofThisInvoice = item.billed_invoice_id
          ? item.billed_invoice_id === invoiceId
          : itemIds.includes(item.id);
        if (!item.is_billed || !ofThisInvoice) return item;
        const { billed_by_company_id: _b, billed_invoice_id: _i, ...rest } = item;
        return { ...rest, is_billed: false } as QuoteItem;
      });
      if (released.every((item, i) => item === items[i])) return;
      if (await this.swapProformaItems(proformaId, data.updated_at, released)) return;
    }
    throw new Error('Le proforma est modifié en ce moment : impossible de remettre ses lignes à facturer.');
  }

  // Every page: the server returns at most 1,000 rows per request, and a
  // list cut there silently drops the oldest documents.
  private static async readDocs(build: () => unknown, what = 'documents'): Promise<Quote[]> {
    try {
      return (await readAll<DocRow>(() => build() as Pageable<DocRow>, 'id')).map(mapDocRow);
    } catch (error) {
      throw new Error(`Erreur chargement ${what}: ${(error as { message?: string })?.message || error}`);
    }
  }

  static async getAllByType(type: 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande'): Promise<Quote[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    return this.readDocs(() => {
      let q = (supabase.from('quotes') as any)
        .select('*')
        .eq('document_type', type)
        .order('created_at', { ascending: false });
      if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
      return q;
    });
  }

  /**
   * Invoices or credit notes for one company's books: those it issued
   * (documents without an issuer belong to their owning company). Drafts are
   * left out: an invoice is booked once it is issued (finalised, or settled
   * for imported ones), never while it can still change.
   */
  static async getForLedger(type: 'invoice' | 'avoir', companyId: string): Promise<Quote[]> {
    return this.readDocs(() => (supabase.from('quotes') as any)
      .select('*')
      .eq('document_type', type)
      .neq('status', 'draft')
      .or(`issuing_company_id.eq.${companyId},and(issuing_company_id.is.null,company_id.eq.${companyId})`)
      .order('created_at', { ascending: false }));
  }

  /**
   * Every invoice one company issued, drafts included, for the statements of
   * VAT withheld by clients and of stamp duty: duty collected in cash on a
   * draft is owed all the same.
   */
  static async getIssuedInvoicesWithDrafts(companyId: string): Promise<Quote[]> {
    return this.readDocs(() => table('quotes')
      .select('*')
      .eq('document_type', 'invoice')
      .or(`issuing_company_id.eq.${companyId},and(issuing_company_id.is.null,company_id.eq.${companyId})`)
      .order('created_at', { ascending: true }), 'factures');
  }

  static async getById(id: string): Promise<Quote | null> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase.from('quotes') as any).select('*').eq('id', id);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Erreur chargement document: ${error.message}`);
    }
    return data ? mapDocRow(data as DocRow) : null;
  }

  /**
   * Invoices of the same issuing company created after `doc` that hold a
   * number of the series: finalised ones, and drafts created before numbering
   * at finalisation (they already hold the next numbers). Drafts with a
   * provisional reference hold none and do not count.
   */
  private static async laterInvoices(doc: Pick<DocRow, 'created_at' | 'issuing_company_id' | 'company_id'>, exceptId: string): Promise<Array<Pick<DocRow, 'id' | 'quote_number'>>> {
    const issuer = doc.issuing_company_id || doc.company_id;
    if (!issuer || !doc.created_at) return [];
    const { data, error } = await table('quotes')
      .select('id, quote_number, created_at, issuing_company_id, company_id')
      .eq('document_type', 'invoice')
      .or(`issuing_company_id.eq.${issuer},company_id.eq.${issuer}`)
      .gt('created_at', doc.created_at)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Erreur vérification de la série de factures: ${error.message}`);
    return ((data as DocRow[]) || [])
      .filter(r => r.id !== exceptId && (r.issuing_company_id || r.company_id) === issuer && !isProvisionalNumber(r.quote_number));
  }

  /**
   * What the deletion confirmation of an invoice must say. A finalised
   * invoice's number is not given back: next_document_number is not defined
   * in this repository's migrations, so whether its counter can be moved back
   * without handing the same number to an invoice finalised meanwhile cannot
   * be checked, and a number the client may have received must not name a
   * different invoice later.
   */
  static deletionNotice(doc: Pick<Quote, 'status' | 'quoteNumber' | 'document_type'>): string {
    if (doc.document_type !== 'invoice') return '';
    if (doc.status === 'draft') {
      return isProvisionalNumber(doc.quoteNumber)
        ? 'Brouillon sans numéro : sa suppression ne laisse aucun trou dans la série.'
        : `Ce brouillon porte déjà le numéro ${doc.quoteNumber} : ce numéro ne sera pas réutilisé.`;
    }
    return `Seule la dernière facture émise peut être supprimée. Le numéro ${doc.quoteNumber} ne sera pas réutilisé : la série gardera ce trou, à justifier. Pour annuler une facture, préférez un avoir.`;
  }

  static async deleteDocument(id: string): Promise<void> {
    const { companyId, bypassFilter } = getCompanyContext();
    const { data: doc } = await (supabase.from('quotes') as any)
      .select('document_type, parent_document_id, source_bl_ids, items, quote_number, status, created_at, issuing_company_id, company_id')
      .eq('id', id)
      .maybeSingle();
    // A credit note cancels part of its invoice: without the invoice it would
    // still lower the client's balance and the books.
    if (doc?.document_type === 'invoice') {
      const avoirs = await this.getAvoirsForInvoice(id);
      if (avoirs.length) {
        throw new Error(`Cette facture a des avoirs (${avoirs.map(a => a.quoteNumber).join(', ')}) : supprimez-les d'abord.`);
      }
    }
    // A booked invoice or credit note stays: its entry would point to nothing.
    if ((doc?.document_type === 'invoice' || doc?.document_type === 'avoir') && await this.isPosted(id)) {
      throw new Error(postedMessage(doc.document_type));
    }
    // Invoice numbers form one continuous series (CGI art. 145-III): an issued
    // invoice can only go if it is the last one of its company, else its
    // number would be missing. Drafts were never issued.
    if (doc?.document_type === 'invoice' && doc.status !== 'draft') {
      const later = await this.laterInvoices(doc as DocRow, id);
      if (later.length) {
        throw new Error(`Seule la dernière facture émise peut être supprimée (sinon son numéro manquerait dans la série ; ${later[0].quote_number} a été émise après). Établissez un avoir pour annuler ${doc.quote_number}.`);
      }
    }
    let q = (supabase.from('quotes') as any).delete().eq('id', id);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { error } = await q;
    if (error) throw new Error(`Erreur suppression: ${error.message}`);
    if (!doc) return;

    // A delivery note took stock out, a credit note put it back: deleting the
    // document undoes that, once (reverse_document_stock is idempotent).
    if (doc.document_type === 'bl' || doc.document_type === 'avoir') {
      const { error: stockError } = await (supabase.rpc as any)('reverse_document_stock', { p_document_id: id, p_reference: doc.quote_number || null });
      if (stockError && !/function .*reverse_document_stock|schema cache/i.test(stockError.message)) {
        throw new Error(`Document supprimé, mais le stock n'a pas pu être remis : ${stockError.message}`);
      }
    }

    // What the document had consumed becomes available again.
    if (doc.document_type === 'invoice' && doc.parent_document_id) {
      const itemIds = ((Array.isArray(doc.items) ? doc.items : []) as QuoteItem[]).map(i => i.id);
      await this.releaseInvoiceLines(doc.parent_document_id, id, itemIds);
    }
    const blIds = (doc.source_bl_ids || []) as string[];
    if (doc.document_type === 'proforma' && blIds.length) {
      const { data: others } = await (supabase.from('quotes') as any)
        .select('source_bl_ids')
        .eq('document_type', 'proforma')
        .overlaps('source_bl_ids', blIds);
      const stillUsed = new Set(((others as { source_bl_ids: string[] }[]) || []).flatMap(o => o.source_bl_ids || []));
      const free = blIds.filter(b => !stillUsed.has(b));
      if (free.length) {
        await (supabase.from('quotes') as any)
          .update({ status: 'draft', updated_at: new Date().toISOString() })
          .in('id', free)
          .eq('document_type', 'bl');
      }
    }
  }

  // Returns document counts per type for a client identified by phone number.
  // Used to enforce deletion rules: block if invoices/BLs/proformas, confirm if quotes only.
  static async getClientDocumentCounts(phone: string): Promise<{
    invoiceCount: number;
    blCount: number;
    proformaCount: number;
    quoteCount: number;
    avoirCount: number;
  }> {
    if (!phone) return { invoiceCount: 0, blCount: 0, proformaCount: 0, quoteCount: 0, avoirCount: 0 };
    const { companyId, isSuperAdmin } = getCompanyContext();
    let q = (supabase.from('quotes') as any)
      .select('document_type')
      .eq('customer_info->>phoneNumber', phone);
    if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
    const { data } = await q;
    const docs = (data || []) as { document_type: string | null }[];
    return {
      invoiceCount:  docs.filter(d => d.document_type === 'invoice').length,
      blCount:       docs.filter(d => d.document_type === 'bl').length,
      proformaCount: docs.filter(d => d.document_type === 'proforma').length,
      quoteCount:    docs.filter(d => !d.document_type || d.document_type === 'quote').length,
      avoirCount:    docs.filter(d => d.document_type === 'avoir').length,
    };
  }

  // Deletes all quote-type documents for a client (used when cascading client deletion).
  static async deleteClientQuotesByPhone(phone: string): Promise<void> {
    if (!phone) return;
    const { companyId, isSuperAdmin } = getCompanyContext();
    let q = (supabase.from('quotes') as any)
      .delete()
      .eq('customer_info->>phoneNumber', phone)
      .or('document_type.eq.quote,document_type.is.null');
    if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
    const { error } = await q;
    if (error) throw new Error(`Erreur suppression devis: ${error.message}`);
  }

  // Unified client financial view:
  // - Sources ALL clients from the clients table (registered clients always appear)
  // - Facturé = invoices − credit notes; Payé = money received on invoices
  //   (advance + recorded payments); Reste = the difference
  // - Also appends legacy "quote-only" customers not in clients table
  static async getClientFinancialSummary(): Promise<ClientFinancialRow[]> {
    const { companyId, isSuperAdmin } = getCompanyContext();

    // ── 1. All registered clients ──────────────────────────────────────────
    let clientQuery = (supabase.from('clients') as any)
      .select('id, full_name, phone_number, client_code')
      .order('full_name', { ascending: true });
    if (!isSuperAdmin && companyId) clientQuery = clientQuery.eq('company_id', companyId);
    const { data: clientRows, error: clientErr } = await clientQuery;
    if (clientErr) throw new Error(`Erreur clients: ${clientErr.message}`);

    // ── 2. Proformas, invoices and credit notes, every page ────────────────
    const docs: any[] = [];
    for (let from = 0; ; from += 1000) {
      let docQuery = (supabase.from('quotes') as any)
        .select('id, customer_info, total_amount, document_type, avance_amount, payment_methods_json')
        .in('document_type', ['proforma', 'invoice', 'avoir'])
        .order('id', { ascending: true })
        .range(from, from + 999);
      if (!isSuperAdmin && companyId) docQuery = docQuery.eq('company_id', companyId);
      const { data, error } = await docQuery;
      if (error) throw new Error(`Erreur documents: ${error.message}`);
      docs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    // ── 3. Aggregate by phone, or by name when there is no phone ───────────
    interface Agg {
      totalAmount: number; paidAmount: number; withheldAmount: number;
      proformaCount: number; invoiceCount: number;
      name: string; // client name from first encountered document
    }
    const empty = (name: string): Agg => ({ totalAmount: 0, paidAmount: 0, withheldAmount: 0, proformaCount: 0, invoiceCount: 0, name });
    const byPhone = new Map<string, Agg>();
    const byName = new Map<string, Agg>();

    for (const doc of docs) {
      const info = doc.customer_info as CustomerInfo;
      const phone = (info?.phoneNumber || '').trim();
      const name  = (info?.fullName   || '').trim();
      if (!phone && !name) continue;
      const map = phone ? byPhone : byName;
      const key = phone || nameKey(name);
      const agg = map.get(key) || empty(name);
      const total = Number(doc.total_amount || 0);
      if (doc.document_type === 'proforma') {
        agg.proformaCount += 1;
      } else if (doc.document_type === 'invoice') {
        agg.invoiceCount += 1;
        agg.totalAmount += total;
        const settled = invoicePayment({
          totalAmount: total, avance_amount: Number(doc.avance_amount || 0),
          payment_methods_json: Array.isArray(doc.payment_methods_json) ? doc.payment_methods_json : [],
        });
        agg.paidAmount += settled.paid;
        agg.withheldAmount += settled.withheld;
      } else {
        agg.totalAmount -= total;
      }
      if (!agg.name && name) agg.name = name;
      map.set(key, agg);
    }

    const toRow = (agg: Agg, extra: Partial<ClientFinancialRow> & { clientName: string; phoneNumber: string }): ClientFinancialRow => ({
      fullName: extra.clientName,
      totalAmount: round2(agg.totalAmount),
      paidAmount: round2(agg.paidAmount),
      withheldAmount: round2(agg.withheldAmount),
      remaining: round2(agg.totalAmount - agg.paidAmount),
      proformaCount: agg.proformaCount,
      invoiceCount: agg.invoiceCount,
      ...extra,
    });

    // ── 4. Build rows — registered clients first ────────────────────────────
    // Documents without a phone go to the registered client of that name, when
    // only one registered client has it (two "Ali" stay apart: ambiguous).
    const registered = (clientRows || []) as Array<{ id: string; full_name: string; phone_number: string | null; client_code: string | null }>;
    const registeredNames = new Map<string, number>();
    for (const c of registered) registeredNames.set(nameKey(c.full_name), (registeredNames.get(nameKey(c.full_name)) || 0) + 1);
    const rows: ClientFinancialRow[] = [];
    const seenPhones = new Set<string>();
    for (const c of registered) {
      const phone = (c.phone_number || '').trim();
      const key = nameKey(c.full_name);
      const byPhoneAgg = phone ? byPhone.get(phone) : undefined;
      const byNameAgg = key && registeredNames.get(key) === 1 ? byName.get(key) : undefined;
      const agg = empty(c.full_name);
      for (const part of [byPhoneAgg, byNameAgg]) {
        if (!part) continue;
        agg.totalAmount += part.totalAmount; agg.paidAmount += part.paidAmount; agg.withheldAmount += part.withheldAmount;
        agg.proformaCount += part.proformaCount; agg.invoiceCount += part.invoiceCount;
      }
      if (byNameAgg) byName.delete(key);
      if (phone) seenPhones.add(phone);
      rows.push(toRow(agg, {
        clientId: c.id, clientCode: c.client_code || undefined, clientName: c.full_name, phoneNumber: phone,
        ...(byNameAgg || (!phone && registeredNames.get(key) === 1) ? { nameMatch: key } : {}),
      }));
    }

    // ── 5. Legacy: document customers not in clients table (by phone) ───────
    for (const [phone, agg] of byPhone) {
      if (seenPhones.has(phone)) continue;
      rows.push(toRow(agg, { clientName: agg.name || phone, phoneNumber: phone }));
    }

    // ── 6. Legacy: name-only customers (no phone) ───────────────────────────
    for (const [key, agg] of byName) {
      rows.push(toRow(agg, { clientName: agg.name || key, phoneNumber: '', nameMatch: key }));
    }

    // Sort: clients with balance first, then alphabetical
    return rows.sort((a, b) =>
      b.remaining - a.remaining || b.totalAmount - a.totalAmount || a.clientName.localeCompare(b.clientName)
    );
  }

  static async getBLsForClient(clientName: string): Promise<Quote[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    const docs = await this.readDocs(() => {
      let q = (supabase.from('quotes') as any)
        .select('*')
        .eq('document_type', 'bl')
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
      if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
      return q;
    }, 'BLs');
    return clientName
      ? docs.filter(d => d.customer?.fullName === clientName)
      : docs;
  }

  // All BLs regardless of status (for BL directory)
  static async getAllBLs(): Promise<Quote[]> {
    return this.getAllByType('bl');
  }

  // All Bons de Commande (for BC directory)
  static async getAllBCs(): Promise<Quote[]> {
    return this.getAllByType('bon_commande');
  }

  // Create a Proforma from a single BL (convenience wrapper)
  static async createProformaFromBL(blId: string, targetCompanyId: string): Promise<Quote> {
    return this.createProformaFromBLs([blId], targetCompanyId);
  }

  // Create a BC pre-filled from a Quote
  static async createBCFromQuote(quoteId: string): Promise<Quote> {
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*').eq('id', quoteId).single();
    if (srcErr || !srcData) throw new Error('Devis introuvable');
    const src = mapDocRow(srcData as DocRow);
    const companyId = (srcData as DocRow).company_id || getCompanyContext().companyId;
    if (!companyId) throw new Error('Le devis ne possède pas de société associée');
    const bcNumber = await this.nextNumber(companyId, 'bon_commande');
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const row: Record<string, unknown> = {
      id: newId,
      quote_number: bcNumber,
      created_at: now,
      updated_at: now,
      status: 'draft',
      customer_info: src.customer,
      items: src.items,
      total_amount: src.totalAmount,
      notes: src.notes || null,
      created_by: src.createdBy || null,
      document_type: 'bon_commande',
      parent_document_id: quoteId,
      source_bl_ids: [],
      paid_amount: 0,
      company_id: companyId,
      tva_rate: await this.rateFor(srcData as DocRow, companyId),
    };
    return this.insertDoc(row, 'Erreur création BC');
  }

  // Create a BC pre-filled from a BL
  static async createBCFromBL(blId: string): Promise<Quote> {
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*').eq('id', blId).single();
    if (srcErr || !srcData) throw new Error('BL introuvable');
    const src = mapDocRow(srcData as DocRow);
    const companyId = (srcData as DocRow).company_id || getCompanyContext().companyId;
    if (!companyId) throw new Error('Le BL ne possède pas de société associée');
    const bcNumber = await this.nextNumber(companyId, 'bon_commande');
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const row: Record<string, unknown> = {
      id: newId,
      quote_number: bcNumber,
      created_at: now,
      updated_at: now,
      status: 'draft',
      customer_info: src.customer,
      items: src.items,
      total_amount: src.totalAmount,
      notes: src.notes || null,
      created_by: src.createdBy || null,
      document_type: 'bon_commande',
      parent_document_id: blId,
      source_bl_ids: [blId],
      paid_amount: 0,
      company_id: companyId,
      tva_rate: await this.rateFor(srcData as DocRow, companyId),
    };
    return this.insertDoc(row, 'Erreur création BC');
  }

  // Create a blank document of the given type directly (no source document needed).
  // Used by "Nouveau BL / Proforma / Facture" buttons in directory pages.
  static async createEmptyDocument(
    type: 'bl' | 'proforma' | 'invoice' | 'bon_commande',
    companyId: string
  ): Promise<Quote> {
    const today = localDay();
    const newId = crypto.randomUUID();
    // A draft invoice takes no number of the series: it gets one when it is
    // finalised, so an abandoned draft leaves no gap (CGI art. 145-III).
    const number = type === 'invoice' ? provisionalNumber(newId) : await this.nextNumber(companyId, type, today);
    const billing = await this.companyBilling(companyId);
    const now = new Date().toISOString();
    const emptyCustomer = { fullName: '', phoneNumber: '', address: '', city: '', salesPerson: '', ice: '' };
    const row: Record<string, unknown> = {
      id: newId,
      quote_number: number,
      created_at: now,
      updated_at: now,
      status: 'draft',
      customer_info: emptyCustomer,
      items: [],
      total_amount: 0,
      document_type: type,
      company_id: companyId,
      paid_amount: 0,
      tva_rate: billing.tvaRate,
      ...(type === 'invoice' ? { due_date: addDays(today, billing.paymentDays) } : {}),
    };
    return this.insertDoc(row, `Erreur création ${type}`);
  }

  /**
   * The rules for changing an invoice or a credit note, checked against the
   * row as stored (the database trigger checks the booked ones again):
   * - booked (validated journal entry): number, date, customer, lines and
   *   totals are fixed; payments, notes, due date and the lock still change;
   * - an issued invoice keeps its number, does not go back to draft, and its
   *   date stays in the month of its number (FAC2611-… is a November invoice);
   * - a draft has no number of the series: it takes one when it is
   *   finalised (the returned `finalise`), and a provisional reference
   *   cannot be replaced by hand;
   * - an older draft that holds a number and is moved to another month gives
   *   that number up (it no longer matches its month) and is numbered again
   *   when finalised;
   * - the due date stays between the invoice date and 120 days after it, and
   *   follows the invoice date when only the date changes.
   * Values that did not really change are not written again.
   */
  private static async guardBillingUpdate(current: DocRow, updates: DocumentUpdates, data: Record<string, unknown>): Promise<{ finalise: boolean }> {
    const type = current.document_type;
    if (type !== 'invoice' && type !== 'avoir') return { finalise: false };
    const createdDay = localDay(new Date(current.created_at));
    const currentDay = current.quote_date ? String(current.quote_date).slice(0, 10) : createdDay;
    const newDay = updates.quote_date === undefined ? currentDay : (updates.quote_date ? updates.quote_date.slice(0, 10) : createdDay);
    const dayChanged = newDay !== currentDay;
    const numberChanged = updates.quoteNumber !== undefined && updates.quoteNumber.trim() !== (current.quote_number || '').trim();
    const customerChanged = updates.customer !== undefined && customerIdentity(updates.customer) !== customerIdentity(current.customer_info);
    const currentItems = (Array.isArray(current.items) ? current.items : []) as QuoteItem[];
    const linesChanged = updates.items !== undefined && !sameLines(updates.items, currentItems);
    const toDraft = updates.status === 'draft' && current.status !== 'draft';

    if (!numberChanged) delete data.quote_number;
    if (!dayChanged) delete data.quote_date;
    if (updates.items !== undefined && !linesChanged) { delete data.items; delete data.total_amount; }
    if (updates.status !== undefined && updates.status === current.status) delete data.status;

    if ((numberChanged || dayChanged || customerChanged || linesChanged || toDraft) && await this.isPosted(current.id)) {
      throw new Error(postedMessage(type));
    }
    if (type !== 'invoice') return { finalise: false };

    const issued = current.status !== 'draft';
    if (issued && toDraft) throw new Error('Une facture finalisée ne revient pas en brouillon : pour l’annuler, établissez un avoir.');
    if (issued && numberChanged) throw new Error('Le numéro d’une facture finalisée ne peut plus être modifié (numérotation continue).');
    if (!issued && numberChanged && isProvisionalNumber(current.quote_number)) {
      throw new Error('Le numéro de la facture est attribué automatiquement quand elle est finalisée.');
    }
    // Finalising goes through finalizeInvoice, after the other changes are saved.
    const finalise = !issued && updates.status !== undefined && updates.status !== 'draft';
    if (finalise) delete data.status;
    const number = numberChanged ? updates.quoteNumber!.trim() : current.quote_number;
    const parsed = parseInvoiceNumber(number);
    if (dayChanged && parsed && parsed.ym !== yearMonthOfDay(newDay)) {
      if (issued) {
        throw new Error(`La date de la facture ${number} doit rester en ${parsed.ym.slice(2)}/20${parsed.ym.slice(0, 2)}, le mois de son numéro. Pour une autre date, établissez un avoir et une nouvelle facture.`);
      }
      if (!numberChanged) data.quote_number = provisionalNumber(current.id);
    }

    const currentDue = current.due_date ? String(current.due_date).slice(0, 10) : null;
    let due = updates.due_date === undefined ? undefined : (updates.due_date ? updates.due_date.slice(0, 10) : null);
    if (due === undefined && dayChanged && currentDue) {
      due = addDays(newDay, daysBetween(currentDay, currentDue));
      data.due_date = due;
    }
    if (due) {
      const err = dueDateError(newDay, due);
      if (err) throw new Error(err);
    }
    if (finalise) {
      const problem = finaliseError({
        customer: (updates.customer ?? current.customer_info) as { fullName?: string } | null,
        items: (updates.items ?? current.items) as unknown[] | null,
      });
      if (problem) throw new Error(problem);
    }
    return { finalise };
  }

  // Update any document fields (quote number, customer, items, notes, status)
  static async updateDocument(id: string, updates: DocumentUpdates): Promise<Quote> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.quoteNumber !== undefined) updateData.quote_number = updates.quoteNumber;
    if (updates.customer !== undefined) updateData.customer_info = updates.customer;
    if (updates.items !== undefined) {
      updateData.items = updates.items;
      updateData.total_amount = documentTotal(updates.items);
    }
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.notes2 !== undefined) updateData.notes2 = updates.notes2;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.payment_date !== undefined) updateData.payment_date = updates.payment_date || null;
    if (updates.payment_method !== undefined) updateData.payment_method = updates.payment_method || null;
    if (updates.payment_reference !== undefined) updateData.payment_reference = updates.payment_reference || null;
    if (updates.payment_bank !== undefined) updateData.payment_bank = updates.payment_bank || null;
    if (updates.is_locked !== undefined) updateData.is_locked = updates.is_locked;
    if (updates.avance_amount !== undefined) updateData.avance_amount = updates.avance_amount ?? 0;
    if (updates.payment_methods_json !== undefined) updateData.payment_methods_json = updates.payment_methods_json;
    if (updates.quote_date !== undefined) updateData.quote_date = updates.quote_date || null;
    if (updates.paid_amount !== undefined) updateData.paid_amount = updates.paid_amount;
    if (updates.due_date !== undefined) updateData.due_date = updates.due_date || null;

    const touchesBilling = [updates.quoteNumber, updates.customer, updates.items, updates.quote_date, updates.status, updates.due_date]
      .some(v => v !== undefined);
    let finalise = false;
    if (touchesBilling) {
      const { data: current } = await table('quotes').select('*').eq('id', id).maybeSingle();
      if (current) finalise = (await this.guardBillingUpdate(current as DocRow, updates, updateData)).finalise;
    }

    const { companyId, bypassFilter } = getCompanyContext();
    const { data, error } = await writeTolerant(updateData, NEW_DOC_COLUMNS, payload => {
      let q = table('quotes').update(payload).eq('id', id);
      if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
      return q.select('*').single();
    });
    if (error) throw new Error(`Erreur mise à jour: ${error.message}`);
    const saved = data as DocRow;
    // A line taken off an invoice made from a proforma is no longer billed:
    // put it back to invoice on the proforma, or it could never be billed again.
    if (updates.items !== undefined && saved.document_type === 'invoice' && saved.parent_document_id) {
      await this.releaseRemovedInvoiceLines(saved.parent_document_id, id, updates.items.map(i => i.id));
    }
    // The draft is saved; now it takes its number and becomes final.
    if (finalise) return this.finalizeInvoice(id);
    return mapDocRow(saved);
  }

  /** Proforma lines billed by `invoiceId` that are no longer on it go back to "not billed". */
  private static async releaseRemovedInvoiceLines(proformaId: string, invoiceId: string, keptItemIds: string[]): Promise<void> {
    const kept = new Set(keptItemIds);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await (supabase.from('quotes') as unknown as {
        select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { items: unknown; updated_at: string; document_type: string | null } | null }> } };
      }).select('items, updated_at, document_type').eq('id', proformaId).maybeSingle();
      if (!data || data.document_type !== 'proforma') return;
      const items = (Array.isArray(data.items) ? data.items : []) as QuoteItem[];
      const released = items.map(item => {
        if (!item.is_billed || item.billed_invoice_id !== invoiceId || kept.has(item.id)) return item;
        const { billed_by_company_id: _b, billed_invoice_id: _i, ...rest } = item;
        return { ...rest, is_billed: false } as QuoteItem;
      });
      if (released.every((item, i) => item === items[i])) return;
      if (await this.swapProformaItems(proformaId, data.updated_at, released)) return;
    }
    throw new Error('Le proforma est modifié en ce moment : ses lignes retirées de la facture n’ont pas pu être remises à facturer.');
  }

  static async duplicateDocument(id: string): Promise<Quote> {
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', id)
      .single();
    if (srcErr || !srcData) throw new Error('Document introuvable');

    const src = srcData as DocRow;
    const docType = (src.document_type as string) || 'quote';
    // An invoice is numbered in the series of the company that issues it.
    const companyId = (docType === 'invoice' ? src.issuing_company_id || src.company_id : src.company_id || src.issuing_company_id)
      || getCompanyContext().companyId;

    // The copy is dated today (its date is not copied).
    const today = localDay();
    const newId = crypto.randomUUID();
    let newNumber: string;
    if (docType === 'invoice') {
      // A copy is a draft: numbered when it is finalised.
      newNumber = provisionalNumber(newId);
    } else if (docType === 'bl') {
      newNumber = companyId ? await this.nextNumber(companyId, 'bl') : `BL-COPIE-${Date.now()}`;
    } else if (docType === 'proforma') {
      newNumber = companyId ? await this.nextNumber(companyId, 'proforma') : `PRO-COPIE-${Date.now()}`;
    } else if (docType === 'bon_commande') {
      newNumber = companyId ? await this.nextNumber(companyId, 'bon_commande') : `BC-COPIE-${Date.now()}`;
    } else {
      const { ExcelExportService } = await import('./excelExport');
      newNumber = ExcelExportService.generateQuoteNumber();
    }

    const now = new Date().toISOString();
    const insertData: Record<string, unknown> = {
      id: newId,
      quote_number: newNumber,
      created_at: now,
      updated_at: now,
      status: 'draft',
      is_locked: false,
      customer_info: src.customer_info,
      // A copy starts unbilled: it has not been invoiced yet.
      items: docType === 'invoice' ? src.items : ((Array.isArray(src.items) ? src.items : []) as QuoteItem[]).map(item => {
        const { is_billed: _b, billed_by_company_id: _c, billed_invoice_id: _i, ...rest } = item;
        return rest;
      }),
      total_amount: src.total_amount,
      notes: src.notes || null,
      notes2: src.notes2 || null,
      document_type: docType,
      company_id: src.company_id || null,
      issuing_company_id: src.issuing_company_id || null,
      paid_amount: 0,
      payment_date: null,
      payment_method: null,
      payment_reference: null,
      payment_bank: null,
      avance_amount: 0,
      payment_methods_json: [],
      // Same prices, same rate as the copied document.
      tva_rate: await this.rateFor(src, companyId),
    };
    if (docType === 'invoice') insertData.due_date = addDays(today, (await this.companyBilling(companyId)).paymentDays);

    return this.insertDoc(insertData, 'Erreur duplication');
  }

  static async createAvoirStandalone(payload: {
    companyId: string;
    issuingCompanyId?: string;
    customerName: string;
    customerPhone?: string;
    totalAmount: number;
    reason?: string;
    items?: unknown[];
  }): Promise<Quote> {
    const { data: numData, error: numErr } = await (supabase.rpc as any)('next_document_number', {
      p_company_id: payload.companyId,
      p_doc_type: 'avoir',
    });
    if (numErr) throw new Error(`Erreur numérotation avoir: ${numErr.message}`);
    const avoirNumber = `AV-${String(numData as number).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const insertData: Record<string, unknown> = {
      id: newId,
      quote_number: avoirNumber,
      created_at: now,
      updated_at: now,
      status: 'final',
      is_locked: false,
      customer_info: { fullName: payload.customerName, phoneNumber: payload.customerPhone || '', address: '', city: '', salesPerson: '' },
      items: payload.items || [],
      total_amount: payload.totalAmount,
      notes: payload.reason || null,
      document_type: 'avoir',
      company_id: payload.companyId,
      issuing_company_id: payload.issuingCompanyId || payload.companyId,
      avance_amount: 0,
      payment_methods_json: [],
      tva_rate: (await this.companyBilling(payload.issuingCompanyId || payload.companyId)).tvaRate,
    };
    return this.insertDoc(insertData, 'Erreur création avoir');
  }

  /** Credit notes already issued against an invoice. */
  static async getAvoirsForInvoice(invoiceId: string): Promise<Quote[]> {
    const { data, error } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('document_type', 'avoir')
      .eq('parent_document_id', invoiceId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Erreur avoirs: ${error.message}`);
    return ((data as DocRow[]) || []).map(mapDocRow);
  }

  /** Quantity of each invoice line not yet credited by an avoir. */
  static creditableQuantities(invoice: Quote, avoirs: Quote[]): Record<string, number> {
    const credited: Record<string, number> = {};
    for (const avoir of avoirs) {
      for (const item of avoir.items) credited[item.id] = (credited[item.id] || 0) + (Number(item.quantity) || 0);
    }
    const left: Record<string, number> = {};
    for (const item of invoice.items) left[item.id] = Math.max(0, (Number(item.quantity) || 0) - (credited[item.id] || 0));
    return left;
  }

  /**
   * Credit note for an invoice, for the given quantity of each line (all of
   * what is left when `lines` is omitted). Never credits more than invoiced.
   */
  static async createAvoirFromInvoice(invoiceId: string, reason: string, lines?: Record<string, number>): Promise<Quote> {
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', invoiceId)
      .single();
    if (srcErr || !srcData) throw new Error('Facture introuvable');

    const src = srcData as DocRow;
    const invoice = mapDocRow(src);
    if (invoice.document_type !== 'invoice') throw new Error('Un avoir se crée depuis une facture');
    const left = this.creditableQuantities(invoice, await this.getAvoirsForInvoice(invoiceId));
    const items = invoice.items
      .map(item => {
        const wanted = lines ? Number(lines[item.id]) || 0 : left[item.id];
        return { item, quantity: Math.min(wanted, left[item.id]) };
      })
      .filter(l => l.quantity > 0)
      .map(({ item, quantity }) => quantity === item.quantity ? item : recomputeLine({ ...item, quantity }));
    if (items.length === 0) {
      throw new Error(Object.values(left).some(q => q > 0)
        ? 'Choisissez au moins une quantité à créditer.'
        : 'Cette facture est déjà entièrement couverte par des avoirs.');
    }

    // Numbered in the series of the company that issued the invoice.
    const companyId = src.issuing_company_id || src.company_id || getCompanyContext().companyId;
    if (!companyId) throw new Error('Société non trouvée');
    const { data: numData, error: numErr } = await (supabase.rpc as any)('next_document_number', {
      p_company_id: companyId,
      p_doc_type: 'avoir',
    });
    if (numErr) throw new Error(`Erreur numérotation avoir: ${numErr.message}`);
    const avoirNumber = `AV-${String(numData as number).padStart(4, '0')}`;

    const now = new Date().toISOString();
    const insertData: Record<string, unknown> = {
      id: crypto.randomUUID(),
      quote_number: avoirNumber,
      created_at: now,
      updated_at: now,
      status: 'final',
      is_locked: false,
      customer_info: src.customer_info,
      items,
      total_amount: documentTotal(items),
      notes: reason || null,
      notes2: null,
      document_type: 'avoir',
      parent_document_id: invoiceId,
      company_id: src.company_id || null,
      issuing_company_id: src.issuing_company_id || null,
      payment_date: null,
      payment_method: null,
      avance_amount: 0,
      payment_methods_json: [],
      // A credit note cancels the invoice at the invoice's own rate.
      tva_rate: await this.rateFor(src, companyId),
    };

    return this.insertDoc(insertData, 'Erreur création avoir');
  }

  /** The invoice a credit note corrects, for its PDF ("Avoir sur facture N° … du …"). */
  static async withSourceInvoice(avoir: Quote): Promise<Quote> {
    if (avoir.document_type !== 'avoir' || !avoir.parent_document_id) return avoir;
    const { data } = await table('quotes').select('quote_number, quote_date, created_at').eq('id', avoir.parent_document_id).maybeSingle();
    const row = data as Pick<DocRow, 'quote_number' | 'quote_date' | 'created_at'> | null;
    if (!row) return avoir;
    return { ...avoir, source_invoice: { quoteNumber: row.quote_number, day: documentDay({ quote_date: row.quote_date || undefined, createdAt: new Date(row.created_at) }) } };
  }

  /**
   * Invoices and credit notes of one client for their statement, matched like
   * the balance in getClientFinancialSummary: documents with the client's
   * phone, plus documents without a phone whose name is the row's nameMatch.
   * (A substring match put "Ali Benali" and "Café Alibaba" on the statement
   * of "Ali".) Oldest first.
   */
  static async getStatementDocuments(phone: string, nameMatch?: string | null): Promise<Quote[]> {
    const { companyId, isSuperAdmin } = getCompanyContext();
    const wantedPhone = (phone || '').trim();
    const wantedName = nameKey(nameMatch);
    const rows = await this.readDocs(() => {
      let q = (supabase.from('quotes') as any)
        .select('*')
        .in('document_type', ['invoice', 'avoir'])
        .order('created_at', { ascending: true });
      if (!isSuperAdmin && companyId) q = q.eq('company_id', companyId);
      return q;
    }, 'factures et avoirs');
    return rows.filter(q => {
      const docPhone = (q.customer?.phoneNumber || '').trim();
      if (docPhone) return !!wantedPhone && docPhone === wantedPhone;
      return !!wantedName && nameKey(q.customer?.fullName) === wantedName;
    });
  }

  /** Invoices only, by phone when there is one, else by name (kept for callers). */
  static async getInvoicesForClient(phone: string, name: string): Promise<Quote[]> {
    const wantedPhone = (phone || '').trim();
    const docs = await this.getStatementDocuments(wantedPhone, wantedPhone ? null : name);
    return docs.filter(d => d.document_type === 'invoice').reverse();
  }
}
