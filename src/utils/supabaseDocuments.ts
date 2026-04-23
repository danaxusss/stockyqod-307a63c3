import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { Quote, QuoteItem, CustomerInfo } from '../types';

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
    type: 'bl' | 'proforma' | 'invoice',
    n: number,
    companyPrefix?: string,
    yearMonth?: string
  ): string {
    if (type === 'invoice') {
      const pfx = companyPrefix || 'FAC';
      const ym = yearMonth || this.currentYearMonth();
      return `${pfx}${ym}-${n}`;
    }
    const prefix = { bl: 'BL', proforma: 'PRO' }[type];
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }

  static currentYearMonth(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${yy}${mm}`;
  }

  // Atomically increment the per-company counter and return the formatted string.
  // For invoices: uses monthly doc_type key (e.g. "invoice_2601") and fetches company doc_prefix.
  static async nextNumber(companyId: string, type: 'bl' | 'proforma' | 'invoice'): Promise<string> {
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
    return this.formatDocNumber(type, data as number);
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
    // Fetch all source BLs
    const { data: blRows, error: blErr } = await (supabase.from('quotes') as any)
      .select('*')
      .in('id', blIds);
    if (blErr || !blRows || (blRows as any[]).length === 0) throw new Error('BLs introuvables');

    const bls = (blRows as DocRow[]).map(mapDocRow);

    // Flatten items: merge by barcode (same product → sum quantities)
    const itemMap = new Map<string, QuoteItem>();
    for (const bl of bls) {
      for (const item of bl.items) {
        const key = item.quoteBarcode || item.product?.barcode || item.id;
        if (itemMap.has(key)) {
          const existing = itemMap.get(key)!;
          const newQty = existing.quantity + item.quantity;
          itemMap.set(key, {
            ...existing,
            quantity: newQty,
            subtotal: existing.unitPrice * newQty,
            is_billed: false,
          });
        } else {
          itemMap.set(key, { ...item, is_billed: false });
        }
      }
    }
    const mergedItems = Array.from(itemMap.values());
    const totalAmount = mergedItems.reduce((sum, i) => sum + i.subtotal, 0);

    // Use first BL's customer info
    const customer = bls[0].customer;

    // Build auto-note listing source BL numbers
    const blNums = bls.map(b => b.quoteNumber).join(', ');
    const autoNote = `Proforma créé depuis les BL : ${blNums}`;

    // Get next Proforma number
    const proformaNumber = await this.nextNumber(targetCompanyId, 'proforma');
    const now = new Date().toISOString();

    const newId = crypto.randomUUID();
    const proformaData: Record<string, unknown> = {
      id: newId,
      quote_number: proformaNumber,
      created_at: now,
      updated_at: now,
      status: 'draft',
      customer_info: customer,
      items: mergedItems,
      total_amount: totalAmount,
      notes: autoNote,
      created_by: null,
      document_type: 'proforma',
      parent_document_id: null,
      source_bl_ids: blIds,
      paid_amount: 0,
      company_id: targetCompanyId,
    };

    const { data: newDoc, error: insertErr } = await (supabase.from('quotes') as any)
      .insert(proformaData)
      .select('*')
      .single();
    if (insertErr) throw new Error(`Erreur création Proforma: ${insertErr.message}`);

    // Mark all source BLs as final
    await (supabase.from('quotes') as any)
      .update({ status: 'final', updated_at: now })
      .in('id', blIds);

    return mapDocRow(newDoc as DocRow);
  }

  // Generate an Invoice from selected Proforma items (by item id).
  // Marks those items is_billed=true on the proforma.
  // Updates proforma paid_amount. Auto-sets proforma status='solde' when all items billed.
  static async createInvoiceFromProforma(
    proformaId: string,
    selectedItemIds: string[],
    issuingCompanyId: string
  ): Promise<Quote> {
    // Fetch proforma
    const { data: proformaData, error: pfErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', proformaId)
      .single();
    if (pfErr || !proformaData) throw new Error('Proforma introuvable');

    const proforma = mapDocRow(proformaData as DocRow);

    // Validate selected items exist
    const selectedItems = proforma.items.filter(item => selectedItemIds.includes(item.id));
    if (selectedItems.length === 0) throw new Error('Aucun article sélectionné');

    // Total for selected items
    const invoiceTotal = selectedItems.reduce((sum, i) => sum + i.subtotal, 0);

    // Get next invoice number
    const invoiceNumber = await this.nextNumber(issuingCompanyId, 'invoice');
    const now = new Date().toISOString();

    // Build invoice items (mark as billed + record issuing company)
    const invoiceItems = selectedItems.map(i => ({ ...i, is_billed: true, billed_by_company_id: issuingCompanyId }));

    const invoiceId = crypto.randomUUID();
    const invoiceData: Record<string, unknown> = {
      id: invoiceId,
      quote_number: invoiceNumber,
      created_at: now,
      updated_at: now,
      status: 'final',
      customer_info: proforma.customer,
      items: invoiceItems,
      total_amount: invoiceTotal,
      notes: `Facture générée depuis ${proforma.quoteNumber}`,
      created_by: null,
      document_type: 'invoice',
      parent_document_id: proformaId,
      source_bl_ids: [],
      paid_amount: 0,
      issuing_company_id: issuingCompanyId,
      company_id: (proformaData as DocRow).company_id || null,
    };

    const { data: newInvoice, error: invErr } = await (supabase.from('quotes') as any)
      .insert(invoiceData)
      .select('*')
      .single();
    if (invErr) throw new Error(`Erreur création Facture: ${invErr.message}`);

    // Mark selected items as is_billed=true + record issuing company on proforma items
    const updatedItems = proforma.items.map(item =>
      selectedItemIds.includes(item.id)
        ? { ...item, is_billed: true, billed_by_company_id: issuingCompanyId }
        : item
    );

    // Recalculate paid_amount = sum of all invoices' total_amount for this proforma
    const { data: allInvoices } = await (supabase.from('quotes') as any)
      .select('total_amount')
      .eq('parent_document_id', proformaId)
      .eq('document_type', 'invoice');

    const newPaidAmount = ((allInvoices as any[]) || []).reduce(
      (sum: number, inv: any) => sum + Number(inv.total_amount), 0
    );

    // Determine if all items are now billed
    const allBilled = updatedItems.every(item => item.is_billed === true);
    const proformaStatus = allBilled ? 'solde' : 'pending';

    await (supabase.from('quotes') as any)
      .update({
        items: updatedItems,
        paid_amount: newPaidAmount,
        status: proformaStatus,
        updated_at: now,
      })
      .eq('id', proformaId);

    return mapDocRow(newInvoice as DocRow);
  }

  static async getAllByType(type: 'bl' | 'proforma' | 'invoice' | 'avoir'): Promise<Quote[]> {
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
    let q = (supabase.from('quotes') as any).delete().eq('id', id);
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { error } = await q;
    if (error) throw new Error(`Erreur suppression: ${error.message}`);
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
  // - Enriches with aggregated proforma/invoice data (LEFT JOIN by phone)
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

    // ── 2. Quote documents (proformas + invoices) for aggregation ───────────
    let docQuery = (supabase.from('quotes') as any)
      .select('customer_info, total_amount, paid_amount, document_type')
      .in('document_type', ['proforma', 'invoice']);
    if (!isSuperAdmin && companyId) docQuery = docQuery.eq('company_id', companyId);
    const { data: docData } = await docQuery;

    // ── 3. Build aggregation map keyed by phone_number ──────────────────────
    interface Agg {
      totalAmount: number; paidAmount: number;
      proformaCount: number; invoiceCount: number;
      name: string; // client name from first encountered quote
    }
    const byPhone = new Map<string, Agg>();

    for (const doc of (docData as any[]) || []) {
      const info = doc.customer_info as CustomerInfo;
      const phone = (info?.phoneNumber || '').trim();
      const name  = (info?.fullName   || '').trim();
      if (!phone) continue; // skip phone-less entries (handled separately below)

      const existing = byPhone.get(phone) || {
        totalAmount: 0, paidAmount: 0, proformaCount: 0, invoiceCount: 0, name,
      };
      if (doc.document_type === 'proforma') {
        existing.totalAmount  += Number(doc.total_amount || 0);
        existing.paidAmount   += Number(doc.paid_amount  || 0);
        existing.proformaCount += 1;
      } else {
        existing.invoiceCount += 1;
      }
      if (!existing.name && name) existing.name = name;
      byPhone.set(phone, existing);
    }

    // Also collect name-only (no phone) quote customers for legacy fallback
    const byName = new Map<string, Agg>();
    for (const doc of (docData as any[]) || []) {
      const info = doc.customer_info as CustomerInfo;
      const phone = (info?.phoneNumber || '').trim();
      const name  = (info?.fullName   || '').trim();
      if (phone || !name) continue;
      const existing = byName.get(name) || {
        totalAmount: 0, paidAmount: 0, proformaCount: 0, invoiceCount: 0, name,
      };
      if (doc.document_type === 'proforma') {
        existing.totalAmount  += Number(doc.total_amount || 0);
        existing.paidAmount   += Number(doc.paid_amount  || 0);
        existing.proformaCount += 1;
      } else {
        existing.invoiceCount += 1;
      }
      byName.set(name, existing);
    }

    // ── 4. Build rows — registered clients first ────────────────────────────
    const rows: ClientFinancialRow[] = [];
    const seenPhones = new Set<string>();

    for (const c of (clientRows as any[]) || []) {
      const phone = (c.phone_number || '').trim();
      const agg = (phone && byPhone.get(phone)) || {
        totalAmount: 0, paidAmount: 0, proformaCount: 0, invoiceCount: 0, name: c.full_name,
      };
      if (phone) seenPhones.add(phone);
      rows.push({
        clientId:    c.id,
        clientCode:  c.client_code || undefined,
        clientName:  c.full_name,
        fullName:    c.full_name,
        phoneNumber: phone,
        totalAmount:  agg.totalAmount,
        paidAmount:   agg.paidAmount,
        remaining:    agg.totalAmount - agg.paidAmount,
        proformaCount: agg.proformaCount,
        invoiceCount:  agg.invoiceCount,
      });
    }

    // ── 5. Legacy: quote customers not in clients table (by phone) ──────────
    for (const [phone, agg] of byPhone) {
      if (seenPhones.has(phone)) continue;
      rows.push({
        clientName:  agg.name || phone,
        fullName:    agg.name || phone,
        phoneNumber: phone,
        totalAmount:  agg.totalAmount,
        paidAmount:   agg.paidAmount,
        remaining:    agg.totalAmount - agg.paidAmount,
        proformaCount: agg.proformaCount,
        invoiceCount:  agg.invoiceCount,
      });
    }

    // ── 6. Legacy: name-only quote customers (no phone) ─────────────────────
    for (const [name, agg] of byName) {
      rows.push({
        clientName:  name,
        fullName:    name,
        phoneNumber: '',
        totalAmount:  agg.totalAmount,
        paidAmount:   agg.paidAmount,
        remaining:    agg.totalAmount - agg.paidAmount,
        proformaCount: agg.proformaCount,
        invoiceCount:  agg.invoiceCount,
      });
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

  // Create a Proforma from a single BL (convenience wrapper)
  static async createProformaFromBL(blId: string, targetCompanyId: string): Promise<Quote> {
    return this.createProformaFromBLs([blId], targetCompanyId);
  }

  // Create a blank document of the given type directly (no source document needed).
  // Used by "Nouveau BL / Proforma / Facture" buttons in directory pages.
  static async createEmptyDocument(
    type: 'bl' | 'proforma' | 'invoice',
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
    }
  ): Promise<Quote> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.quoteNumber !== undefined) updateData.quote_number = updates.quoteNumber;
    if (updates.customer !== undefined) updateData.customer_info = updates.customer;
    if (updates.items !== undefined) {
      updateData.items = updates.items;
      updateData.total_amount = updates.items.reduce((s, i) => s + i.subtotal, 0);
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
    const companyId = src.company_id || src.issuing_company_id || getCompanyContext().companyId;

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
      items: src.items,
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

  static async createAvoirFromInvoice(invoiceId: string, reason: string): Promise<Quote> {
    const { data: srcData, error: srcErr } = await (supabase.from('quotes') as any)
      .select('*')
      .eq('id', invoiceId)
      .single();
    if (srcErr || !srcData) throw new Error('Facture introuvable');

    const src = srcData as DocRow;
    const companyId = src.company_id || src.issuing_company_id || getCompanyContext().companyId;
    if (!companyId) throw new Error('Société non trouvée');

    const { data: numData, error: numErr } = await (supabase.rpc as any)('next_document_number', {
      p_company_id: companyId,
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
      customer_info: src.customer_info,
      items: src.items,
      total_amount: src.total_amount,
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
}
