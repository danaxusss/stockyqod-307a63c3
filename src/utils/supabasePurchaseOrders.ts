import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '../types';

export class PurchaseOrdersService {
  static async list(): Promise<PurchaseOrder[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('purchase_orders').select('*').order('created_at', { ascending: false });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as PurchaseOrder[];
  }

  static async getById(id: string): Promise<PurchaseOrder | null> {
    const { data, error } = await (supabase as any)
      .from('purchase_orders').select('*, items:purchase_order_items(*)').eq('id', id).single();
    if (error) throw error;
    if (!data) return null;
    const po = data as PurchaseOrder;
    po.items = ((data.items || []) as PurchaseOrderItem[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return po;
  }

  /** Next number, unique per company and year (database counter). */
  private static async nextNumber(companyId: string | null): Promise<string> {
    const { data, error } = await (supabase as any).rpc('next_purchase_order_number', { p_company_id: companyId });
    if (error) throw error;
    return data as string;
  }

  static async create(
    header: Partial<PurchaseOrder>,
    items: PurchaseOrderItem[]
  ): Promise<PurchaseOrder> {
    const { companyId } = getCompanyContext();
    const cid = header.company_id ?? companyId;
    const poNumber = header.po_number || await this.nextNumber(cid);
    const total = items.reduce((s, i) => s + i.qty_ordered * i.unit_cost, 0);
    const { data, error } = await (supabase as any).from('purchase_orders').insert({
      company_id: cid,
      po_number: poNumber,
      provider_id: header.provider_id ?? null,
      provider_name: header.provider_name ?? null,
      location_key: header.location_key ?? null,
      status: header.status ?? 'draft',
      order_date: header.order_date ?? new Date().toISOString().slice(0, 10),
      expected_date: header.expected_date ?? null,
      total_ht: total,
      notes: header.notes ?? null,
      created_by: header.created_by ?? null,
    }).select().single();
    if (error) throw error;
    const po = data as PurchaseOrder;
    if (items.length > 0) {
      const rows = items.map((it, idx) => ({
        po_id: po.id, barcode: it.barcode, label: it.label,
        qty_ordered: it.qty_ordered, qty_received: 0, unit_cost: it.unit_cost, sort_order: idx,
      }));
      const { error: iErr } = await (supabase as any).from('purchase_order_items').insert(rows);
      if (iErr) throw iErr;
    }
    return po;
  }

  static async setStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
    const { error } = await (supabase as any).from('purchase_orders').update({ status }).eq('id', id);
    if (error) throw error;
  }

  /**
   * Receive quantities against a PO in one locked database transaction: posts
   * 'in' stock movements (CMUP-aware), updates qty_received and the PO status.
   * `received` maps purchase_order_items.id → quantity received now. More than
   * what remains is refused unless allowOver (OverReceiptError otherwise).
   */
  static async receive(
    poId: string,
    received: Record<string, number>,
    opts: { locationKeys: string[]; locationId?: string | null; createdBy?: string | null; allowOver?: boolean }
  ): Promise<PurchaseOrderStatus> {
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).rpc('receive_purchase_order', {
      p_po_id: poId,
      p_lines: received,
      p_location_keys: opts.locationKeys,
      p_location_id: opts.locationId ?? null,
      p_allow_over: opts.allowOver === true,
      p_company_id: companyId,
      p_created_by: opts.createdBy ?? null,
    });
    if (error) {
      if (error.hint === 'over_receipt') throw new OverReceiptError(error.message);
      throw error;
    }
    return data as PurchaseOrderStatus;
  }
}

/** A reception exceeds what remains on the order; ask before forcing it. */
export class OverReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverReceiptError';
  }
}
