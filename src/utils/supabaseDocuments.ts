import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { Quote, QuoteItem, CustomerInfo } from '../types';
import { documentTotal, invoicePayment, mergeLines, recomputeLine, sameCustomer } from './documentLines';

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  };
}

export interface ClientFinancialRow {
  clientId?: string;       // id from clients table — undefined for legacy quote-only customers
  clientName: string;
  fullName: string;
  phoneNumber: string;
  clientCode?: string;
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  proformaCount: number;
  invoiceCount: number;
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
  static async nextNumber(companyId: string, type: 'bl' | 'proforma' | 'invoice' | 'bon_commande'): Promise<string> {
    if (type === 'invoice') {
      const ym = this.currentYearMonth();
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
    };

    const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
      .insert(blData)
      .select('*')
      .single();
    if (insertErr) throw new Error(`Erreur création BL: ${insertErr.message}`);

    // Mark the original quote as final
    await (supabase.from('quotes') as any)
      .update({ status: 'final', updated_at: now })
      .eq('id', quoteId);

    return mapDocRow(newDoc as DocRow);
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
      };

      const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
        .insert(proformaData)
        .select('*')
        .single();
      if (insertErr) throw new Error(`Erreur création Proforma: ${insertErr.message}`);
      return mapDocRow(newDoc as DocRow);
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

    try {
      const invoiceNumber = await this.nextNumber(issuingCompanyId, 'invoice');
      const now = new Date().toISOString();
      const invoiceItems = selectedItems.map(mark);
      const invoiceData: Record<string, unknown> = {
        id: invoiceId,
        quote_number: invoiceNumber,
        created_at: now,
        updated_at: now,
        status: 'final',
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
      };
      const { data: newInvoice, error: invErr } = await (supabase.from('quotes') as any)
        .insert(invoiceData)
        .select('*')
        .single();
      if (invErr) throw new Error(`Erreur création Facture: ${invErr.message}`);
      return mapDocRow(newInvoice as DocRow);
    } catch (e) {
      await this.releaseInvoiceLines(proformaId, invoiceId, selectedItemIds).catch(() => {});
      throw e;
    }
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

  static async getAllByType(type: 'bl' | 'proforma' | 'invoice' | 'avoir' | 'bon_commande'): Promise<Quote[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase.from('quotes') as any)
      .select('*')
      .eq('document_type', type)
      .order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw new Error(`Erreur chargement documents: ${error.message}`);
    return ((data as DocRow[]) || []).map(mapDocRow);
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

  static async deleteDocument(id: string): Promise<void> {
    const { companyId, bypassFilter } = getCompanyContext();
    const { data: doc } = await (supabase.from('quotes') as any)
      .select('document_type, parent_document_id, source_bl_ids, items')
      .eq('id', id)
      .maybeSingle();
    let q = (supabase.from('quotes') as any).delete().eq('id', id);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { error } = await q;
    if (error) throw new Error(`Erreur suppression: ${error.message}`);
    if (!doc) return;

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
      totalAmount: number; paidAmount: number;
      proformaCount: number; invoiceCount: number;
      name: string; // client name from first encountered document
    }
    const empty = (name: string): Agg => ({ totalAmount: 0, paidAmount: 0, proformaCount: 0, invoiceCount: 0, name });
    const byPhone = new Map<string, Agg>();
    const byName = new Map<string, Agg>();

    for (const doc of docs) {
      const info = doc.customer_info as CustomerInfo;
      const phone = (info?.phoneNumber || '').trim();
      const name  = (info?.fullName   || '').trim();
      if (!phone && !name) continue;
      const map = phone ? byPhone : byName;
      const key = phone || name;
      const agg = map.get(key) || empty(name);
      const total = Number(doc.total_amount || 0);
      if (doc.document_type === 'proforma') {
        agg.proformaCount += 1;
      } else if (doc.document_type === 'invoice') {
        agg.invoiceCount += 1;
        agg.totalAmount += total;
        agg.paidAmount += invoicePayment({
          totalAmount: total, avance_amount: Number(doc.avance_amount || 0),
          payment_methods_json: Array.isArray(doc.payment_methods_json) ? doc.payment_methods_json : [],
        }).paid;
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
      remaining: round2(agg.totalAmount - agg.paidAmount),
      proformaCount: agg.proformaCount,
      invoiceCount: agg.invoiceCount,
      ...extra,
    });

    // ── 4. Build rows — registered clients first ────────────────────────────
    const rows: ClientFinancialRow[] = [];
    const seenPhones = new Set<string>();
    for (const c of (clientRows as any[]) || []) {
      const phone = (c.phone_number || '').trim();
      const agg = (phone && byPhone.get(phone)) || empty(c.full_name);
      if (phone) seenPhones.add(phone);
      rows.push(toRow(agg, { clientId: c.id, clientCode: c.client_code || undefined, clientName: c.full_name, phoneNumber: phone }));
    }

    // ── 5. Legacy: document customers not in clients table (by phone) ───────
    for (const [phone, agg] of byPhone) {
      if (seenPhones.has(phone)) continue;
      rows.push(toRow(agg, { clientName: agg.name || phone, phoneNumber: phone }));
    }

    // ── 6. Legacy: name-only customers (no phone) ───────────────────────────
    for (const [name, agg] of byName) {
      rows.push(toRow(agg, { clientName: name, phoneNumber: '' }));
    }

    // Sort: clients with balance first, then alphabetical
    return rows.sort((a, b) =>
      b.remaining - a.remaining || b.totalAmount - a.totalAmount || a.clientName.localeCompare(b.clientName)
    );
  }

  static async getBLsForClient(clientName: string): Promise<Quote[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase.from('quotes') as any)
      .select('*')
      .eq('document_type', 'bl')
      .eq('status', 'draft')
      .order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw new Error(`Erreur BLs: ${error.message}`);
    const docs = ((data as DocRow[]) || []).map(mapDocRow);
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
    };
    const { data, error } = await (supabase.from('quotes') as any).insert(row).select('*').single();
    if (error) throw new Error(`Erreur création BC: ${error.message}`);
    return mapDocRow(data as DocRow);
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
    };
    const { data, error } = await (supabase.from('quotes') as any).insert(row).select('*').single();
    if (error) throw new Error(`Erreur création BC: ${error.message}`);
    return mapDocRow(data as DocRow);
  }

  // Create a blank document of the given type directly (no source document needed).
  // Used by "Nouveau BL / Proforma / Facture" buttons in directory pages.
  static async createEmptyDocument(
    type: 'bl' | 'proforma' | 'invoice' | 'bon_commande',
    companyId: string
  ): Promise<Quote> {
    const number = await this.nextNumber(companyId, type);
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
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
    };
    const { data, error } = await (supabase.from('quotes') as any)
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(`Erreur création ${type}: ${error.message}`);
    return mapDocRow(data as DocRow);
  }

  // Update any document fields (quote number, customer, items, notes, status)
  static async updateDocument(
    id: string,
    updates: {
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
    }
  ): Promise<Quote> {
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

    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase.from('quotes') as any).update(updateData).eq('id', id);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.select('*').single();
    if (error) throw new Error(`Erreur mise à jour: ${error.message}`);
    return mapDocRow(data as DocRow);
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

    let newNumber: string;
    if (docType === 'invoice') {
      newNumber = companyId ? await this.nextNumber(companyId, 'invoice') : `FAC-COPIE-${Date.now()}`;
    } else if (docType === 'bl') {
      newNumber = companyId ? await this.nextNumber(companyId, 'bl') : `BL-COPIE-${Date.now()}`;
    } else if (docType === 'proforma') {
      newNumber = companyId ? await this.nextNumber(companyId, 'proforma') : `PRO-COPIE-${Date.now()}`;
    } else {
      const { ExcelExportService } = await import('./excelExport');
      newNumber = ExcelExportService.generateQuoteNumber();
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
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
    };

    const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
      .insert(insertData)
      .select('*')
      .single();
    if (insertErr) throw new Error(`Erreur duplication: ${insertErr.message}`);
    return mapDocRow(newDoc as DocRow);
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
    };
    const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
      .insert(insertData).select('*').single();
    if (insertErr) throw new Error(`Erreur création avoir: ${insertErr.message}`);
    return mapDocRow(newDoc as DocRow);
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
    };

    const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
      .insert(insertData)
      .select('*')
      .single();
    if (insertErr) throw new Error(`Erreur création avoir: ${insertErr.message}`);
    return mapDocRow(newDoc as DocRow);
  }

  // Fetch all invoices for a given client, matched by phone or name (for F6 export)
  static async getInvoicesForClient(phoneOrName: string): Promise<Quote[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    const { data, error } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('document_type', 'invoice')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = ((data || []) as DocRow[]).map(mapDocRow);
    const needle = phoneOrName.toLowerCase().trim();
    const filtered = rows.filter(q => {
      const c = q.customer;
      if (!c) return false;
      return (
        (c.phoneNumber || '').toLowerCase().includes(needle) ||
        (c.fullName || '').toLowerCase().includes(needle)
      );
    });
    if (bypassFilter || !companyId) return filtered;
    return filtered.filter(q => !q.company_id || q.company_id === companyId);
  }
}
