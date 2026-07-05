import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Product, StockMovement, StockMovementType, StockSourceType, ProductStockSetting } from '../types';

export interface ApplyMovementParams {
  barcode: string;
  locationKey: string;
  type: StockMovementType;
  quantity: number;            // signed delta for adjustment/count; magnitude otherwise
  unitCost?: number | null;
  reason?: string | null;
  sourceType?: StockSourceType;
  sourceId?: string | null;
  createdBy?: string | null;
  locationId?: string | null;
  transferGroupId?: string | null;
}

export interface MovementFilters {
  barcode?: string;
  locationKey?: string;
  type?: StockMovementType;
  sourceType?: StockSourceType;
  from?: string;               // ISO date
  to?: string;                 // ISO date
  limit?: number;
}

export class StockService {
  /** Fresh product read from Supabase (stock changes frequently — bypass cache). */
  static async getProducts(): Promise<Product[]> {
    const { data, error } = await supabase
      .from('products')
      .select('barcode, name, brand, price, buyprice, reseller_price, provider, stock_levels, updated_at')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map((p: any) => ({
      ...p,
      stock_levels: (p.stock_levels || {}) as Record<string, number>,
    })) as Product[];
  }

  /** Apply a stock movement through the RPC (the only writer of stock_levels). */
  static async applyMovement(p: ApplyMovementParams): Promise<StockMovement> {
    const { companyId } = getCompanyContext();
    const { data, error } = await (supabase as any).rpc('apply_stock_movement', {
      p_barcode: p.barcode,
      p_location_key: p.locationKey,
      p_type: p.type,
      p_quantity: p.quantity,
      p_unit_cost: p.unitCost ?? null,
      p_reason: p.reason ?? null,
      p_source_type: p.sourceType ?? 'manual',
      p_source_id: p.sourceId ?? null,
      p_company_id: companyId,
      p_created_by: p.createdBy ?? null,
      p_location_id: p.locationId ?? null,
      p_transfer_group_id: p.transferGroupId ?? null,
    });
    if (error) throw error;
    return data as StockMovement;
  }

  static async getMovements(filters: MovementFilters = {}): Promise<StockMovement[]> {
    let q = (supabase as any)
      .from('stock_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(filters.limit ?? 500);
    if (filters.barcode) q = q.eq('barcode', filters.barcode);
    if (filters.locationKey) q = q.eq('location_key', filters.locationKey);
    if (filters.type) q = q.eq('type', filters.type);
    if (filters.sourceType) q = q.eq('source_type', filters.sourceType);
    if (filters.from) q = q.gte('created_at', filters.from);
    if (filters.to) q = q.lte('created_at', filters.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as StockMovement[];
  }

  static async getMovementsForProduct(barcode: string): Promise<StockMovement[]> {
    return this.getMovements({ barcode, limit: 200 });
  }

  // ── Reorder settings ────────────────────────────────────────────────────
  static async getStockSettings(): Promise<ProductStockSetting[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('product_stock_settings').select('*');
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as ProductStockSetting[];
  }

  static async upsertStockSetting(
    s: Partial<ProductStockSetting> & { barcode: string; reorder_point: number }
  ): Promise<ProductStockSetting> {
    const { companyId } = getCompanyContext();
    const payload = { ...s, company_id: s.company_id ?? companyId };
    const { data, error } = await (supabase as any)
      .from('product_stock_settings')
      .upsert(payload, { onConflict: 'barcode,location_key,company_id' })
      .select()
      .single();
    if (error) throw error;
    return data as ProductStockSetting;
  }
}

/** Total quantity across all locations for a product. */
export function totalStock(p: Product): number {
  return Object.values(p.stock_levels || {}).reduce((s, v) => s + (Number(v) || 0), 0);
}

/** Stock value at CMUP (buyprice) across all locations. */
export function stockValue(p: Product): number {
  return totalStock(p) * (Number(p.buyprice) || 0);
}
