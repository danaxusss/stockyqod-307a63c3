import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductUploadService } from '../utils/productUploadService';
import type { Product } from '../types';

const db = vi.hoisted(() => ({ upserts: [] as Array<Record<string, unknown>[]>, movements: [] as unknown[] }));

vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => ({ companyId: 'c1' }) }));
vi.mock('../utils/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => table === 'product_name_overrides'
        ? Promise.resolve({ data: [], error: null })
        : { range: async (from: number) => ({ data: from === 0 ? [{ barcode: 'OLD', brand: 'B', provider: 'P', image: null, kiosk_category: null, stock_levels: { DEP: 7 } }] : [], error: null }) },
      upsert: async (rows: Record<string, unknown>[]) => { db.upserts.push(rows); return { error: null }; },
      insert: async (rows: unknown[]) => { db.movements.push(...rows); return { error: null }; },
    }),
  },
}));

const product = (barcode: string, stock: Record<string, number>): Product =>
  ({ barcode, name: barcode, brand: 'B', provider: 'P', price: 10, buyprice: 5, reseller_price: 8, image: null, techsheet: '', stock_levels: stock }) as Product;

afterEach(() => { db.upserts = []; db.movements = []; });

describe('Excel product import', () => {
  it('seeds stock for new products only and leaves existing stock untouched', async () => {
    await ProductUploadService.uploadProducts([product('OLD', { DEP: 1 }), product('NEW', { DEP: 4 })]);
    const rows = db.upserts.flat();
    const old = rows.find(r => r.barcode === 'OLD')!;
    const fresh = rows.find(r => r.barcode === 'NEW')!;
    expect(old).not.toHaveProperty('stock_levels');
    expect(old.price).toBe(10);
    expect(fresh.stock_levels).toEqual({ DEP: 4 });
    // Batches never mix rows with and without stock.
    expect(db.upserts.every(batch => batch.every(r => ('stock_levels' in r) === ('stock_levels' in batch[0])))).toBe(true);
    expect(db.movements).toEqual([expect.objectContaining({ barcode: 'NEW', location_key: 'DEP', quantity: 4, balance_after: 4 })]);
  });
});
