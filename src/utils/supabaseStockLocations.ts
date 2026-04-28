import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import type { Provider, StockLocation, SubStockLocation } from '../types';

export class StockLocationsService {
  // ── Providers ────────────────────────────────────────────────

  static async getProviders(): Promise<Provider[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any).from('providers').select('*').order('name', { ascending: true });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as Provider[];
  }

  static async upsertProvider(data: Partial<Provider> & { name: string }): Promise<Provider> {
    const { companyId } = getCompanyContext();
    const payload = { ...data, company_id: data.company_id || companyId };
    if (payload.id) {
      const { data: row, error } = await (supabase as any)
        .from('providers').update(payload).eq('id', payload.id).select().single();
      if (error) throw error;
      return row as Provider;
    }
    const { data: row, error } = await (supabase as any)
      .from('providers').insert(payload).select().single();
    if (error) throw error;
    return row as Provider;
  }

  static async deleteProvider(id: string): Promise<void> {
    const { error } = await (supabase as any).from('providers').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Stock Locations (with nested sub_locations) ───────────────

  static async getStockLocations(): Promise<StockLocation[]> {
    const { companyId, bypassFilter } = getCompanyContext();
    let q = (supabase as any)
      .from('stock_locations')
      .select('*, sub_locations:sub_stock_locations(*)')
      .order('name', { ascending: true });
    if (!bypassFilter && companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as StockLocation[];
  }

  static async upsertStockLocation(
    data: Partial<StockLocation> & { name: string }
  ): Promise<StockLocation> {
    const { companyId } = getCompanyContext();
    const { sub_locations: _sub, ...payload } = data as any;
    const insert = { ...payload, company_id: payload.company_id || companyId };
    if (insert.id) {
      const { data: row, error } = await (supabase as any)
        .from('stock_locations').update(insert).eq('id', insert.id).select().single();
      if (error) throw error;
      return row as StockLocation;
    }
    const { data: row, error } = await (supabase as any)
      .from('stock_locations').insert(insert).select().single();
    if (error) throw error;
    return row as StockLocation;
  }

  static async deleteStockLocation(id: string): Promise<void> {
    const { error } = await (supabase as any).from('stock_locations').delete().eq('id', id);
    if (error) throw error;
  }

  // ── Sub-locations ─────────────────────────────────────────────

  static async upsertSubLocation(
    data: Partial<SubStockLocation> & { stock_location_id: string; name: string; code: string }
  ): Promise<SubStockLocation> {
    if (data.id) {
      const { data: row, error } = await (supabase as any)
        .from('sub_stock_locations').update(data).eq('id', data.id).select().single();
      if (error) throw error;
      return row as SubStockLocation;
    }
    const { data: row, error } = await (supabase as any)
      .from('sub_stock_locations').insert(data).select().single();
    if (error) throw error;
    return row as SubStockLocation;
  }

  static async deleteSubLocation(id: string): Promise<void> {
    const { error } = await (supabase as any).from('sub_stock_locations').delete().eq('id', id);
    if (error) throw error;
  }
}
