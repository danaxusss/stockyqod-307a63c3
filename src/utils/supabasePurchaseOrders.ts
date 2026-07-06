import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { StockService } from './supabaseStock';
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

  private static async nextNumber(companyId: string | null): Promise<string> {
    const year = new Date().getFullYear();
    let q = (supabase as any).from('purchase_orders').select('id', { count: 'exact', head: true });
    if (companyId) q = q.eq('company_id', companyId);
    const { count } = await q;
    return `BC-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
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
   * Receive quantities against a PO: posts 'in' stock movements (CMUP-aware),
   * updates qty_received per line, and advances PO status to partial/received.
   * `received` maps purchase_order_items.id → quantity received now.
   */
  static async receive(
    poId: string,
    received: Record<string, number>,
    opts: { locationKey: string; locationId?: string | null; createdBy?: string | null }
  ): Promise<void> {
    const po = await this.getById(poId);
    if (!po || !po.items) throw new Error('Bon de commande introuvable');

    for (const it of po.items) {
      const qty = received[it.id!] || 0;
      if (qty <= 0) continue;
      await StockService.applyMovement({
        barcode: it.barcode,
        locationKey: opts.locationKey,
        type: 'in',
        quantity: qty,
        unitCost: it.unit_cost || null,
        reason: `Réception ${po.po_number}`,
        sourceType: 'receipt',
        sourceId: po.id,
        createdBy: opts.createdBy ?? null,
        locationId: opts.locationId ?? null,
      });
      await (supabase as any).from('purchase_order_items')
        .update({ qty_received: (it.qty_received || 0) + qty }).eq('id', it.id);
    }

    // Recompute status from fresh line totals
    const fresh = await this.getById(poId);
    const allReceived = (fresh?.items || []).every(i => (i.qty_received || 0) >= i.qty_ordered);
    const anyReceived = (fresh?.items || []).some(i => (i.qty_received || 0) > 0);
    const status: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partial' : po.status;
    await this.setStatus(poId, status);
  }
}
