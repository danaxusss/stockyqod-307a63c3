import { supabase } from './supabaseClient';
import { getCompanyContext } from './supabaseCompanyFilter';
import { Product } from '../types';

export class ProductUploadService {
  static async uploadProducts(products: Product[]): Promise<void> {
    if (products.length === 0) {
      throw new Error('No products to upload');
    }

    console.log(`Starting upload of ${products.length} products to Supabase`);

    // Load brand/provider overrides to preserve custom names for existing products
    const { data: overrides } = await supabase.from('product_name_overrides').select('*');
    const brandOverrides = new Map<string, string>();
    const providerOverrides = new Map<string, string>();
    if (overrides) {
      for (const o of overrides) {
        if (o.type === 'brand') brandOverrides.set(o.original_name, o.custom_name);
        else if (o.type === 'provider') providerOverrides.set(o.original_name, o.custom_name);
      }
    }

    // Load existing barcodes to determine new vs existing products (and keep the
    // previous stock_levels so we can log a reconciling ledger movement after import)
    const existingProducts: Array<{
      barcode: string;
      brand: string;
      provider: string;
      image: string | null;
      stock_levels: unknown;
    }> = [];
    const EXISTING_PAGE = 1000;
    for (let from = 0; ; from += EXISTING_PAGE) {
      const { data, error } = await supabase.from('products')
        .select('barcode, brand, provider, image, stock_levels')
        .range(from, from + EXISTING_PAGE - 1);
      if (error) throw new Error(`Unable to load existing products: ${error.message}`);
      existingProducts.push(...(data || []));
      if (!data || data.length < EXISTING_PAGE) break;
    }
    const existingMap = new Map<string, { brand: string; provider: string; image: string | null }>();
    const oldStockByBarcode = new Map<string, Record<string, number>>();
    for (const p of existingProducts) {
      existingMap.set(p.barcode, { brand: p.brand, provider: p.provider, image: p.image });
      oldStockByBarcode.set(p.barcode, (p.stock_levels || {}) as Record<string, number>);
    }

    const validProducts: Product[] = [];

    for (const product of products) {
      if (!product.barcode || typeof product.barcode !== 'string' || product.barcode.trim().length === 0) continue;
      if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) continue;

      let brand = String(product.brand || '').trim();
      let provider = String(product.provider || '').trim();

      const existing = existingMap.get(String(product.barcode).trim());
      if (existing) {
        // Existing product: preserve overridden brand/provider names
        // Check if the existing brand matches a custom_name from overrides
        const brandIsOverridden = [...brandOverrides.values()].includes(existing.brand);
        const providerIsOverridden = [...providerOverrides.values()].includes(existing.provider);
        if (brandIsOverridden) brand = existing.brand;
        else if (brandOverrides.has(brand)) brand = brandOverrides.get(brand)!;
        if (providerIsOverridden) provider = existing.provider;
        else if (providerOverrides.has(provider)) provider = providerOverrides.get(provider)!;
      } else {
        // New product: apply overrides if the incoming brand/provider matches an original_name
        if (brandOverrides.has(brand)) brand = brandOverrides.get(brand)!;
        if (providerOverrides.has(provider)) provider = providerOverrides.get(provider)!;
      }

      validProducts.push({
        barcode: String(product.barcode).trim(),
        name: String(product.name).trim(),
        brand,
        image: existing?.image ?? product.image ?? null,
        techsheet: String(product.techsheet || '').trim(),
        price: Number(product.price) || 0,
        buyprice: Number(product.buyprice) || 0,
        reseller_price: Number(product.reseller_price) || 0,
        provider,
        stock_levels: product.stock_levels || {}
      });
    }

    if (validProducts.length === 0) {
      throw new Error('No valid products to upload after validation');
    }

    const BATCH_SIZE = 100;
    let totalUploaded = 0;
    let totalFailed = 0;

    for (let i = 0; i < validProducts.length; i += BATCH_SIZE) {
      const batch = validProducts.slice(i, i + BATCH_SIZE);

      const rows = batch.map(p => ({
        barcode: p.barcode,
        name: p.name,
        brand: p.brand,
        image: p.image ?? null,
        techsheet: p.techsheet,
        price: p.price,
        buyprice: p.buyprice,
        reseller_price: p.reseller_price,
        provider: p.provider,
        stock_levels: p.stock_levels as unknown as import('@/integrations/supabase/types').Json
      }));

      const { error } = await (supabase
        .from('products') as any)
        .upsert(rows, { onConflict: 'barcode', ignoreDuplicates: false });

      if (error) {
        console.error(`Batch failed:`, error);
        totalFailed += batch.length;
      } else {
        totalUploaded += batch.length;
      }
    }

    // Log reconciling ledger movements for every changed (barcode, location) so
    // the stock_movements journal stays consistent with the imported quantities.
    // Best-effort: never fail the import if this step errors.
    try {
      await this.logImportReconcile(validProducts, oldStockByBarcode);
    } catch (e) {
      console.warn('Stock reconcile after import failed (non-blocking):', e);
    }

    if (totalFailed > 0) {
      throw new Error(`Upload partially failed: ${totalUploaded} products uploaded, ${totalFailed} failed.`);
    }
  }

  /**
   * After a catalogue import overwrites products.stock_levels with absolute
   * values, record a 'count' movement for each (barcode, location) whose
   * quantity changed. We insert directly (NOT via apply_stock_movement) because
   * the upsert already set the absolute level — the movement only records the
   * delta and the resulting balance for the audit journal.
   */
  private static async logImportReconcile(
    imported: Product[],
    oldStockByBarcode: Map<string, Record<string, number>>
  ): Promise<void> {
    const { companyId } = getCompanyContext();
    const batchId = (crypto as any).randomUUID ? crypto.randomUUID() : `import-${Date.now()}`;
    const now = new Date().toISOString();

    type MovRow = {
      company_id: string | null; barcode: string; location_key: string; type: string;
      quantity: number; balance_after: number; reason: string; source_type: string;
      source_id: string; created_by: string; created_at: string;
    };
    const rows: MovRow[] = [];

    for (const p of imported) {
      const oldLevels = oldStockByBarcode.get(p.barcode) || {};
      const newLevels = p.stock_levels || {};
      const keys = new Set<string>([...Object.keys(oldLevels), ...Object.keys(newLevels)]);
      for (const key of keys) {
        const oldQty = Number(oldLevels[key]) || 0;
        const newQty = Number(newLevels[key]) || 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;
        rows.push({
          company_id: companyId, barcode: p.barcode, location_key: key, type: 'count',
          quantity: delta, balance_after: newQty, reason: 'Import Excel', source_type: 'count',
          source_id: batchId, created_by: 'import', created_at: now,
        });
      }
    }

    if (rows.length === 0) return;
    const INS_BATCH = 500;
    for (let i = 0; i < rows.length; i += INS_BATCH) {
      const slice = rows.slice(i, i + INS_BATCH);
      const { error } = await (supabase.from('stock_movements') as any).insert(slice);
      if (error) throw error;
    }
  }

  static async deleteAllProducts(): Promise<void> {
    const initialCount = await this.getProductCount();
    if (initialCount === 0) return;

    // Delete in batches - need to select IDs first since delete needs a filter
    const { error } = await supabase
      .from('products')
      .delete()
      .gte('barcode', ''); // matches all rows

    if (error) {
      throw new Error(`Failed to delete products: ${error.message}`);
    }
  }

  static async getProductCount(): Promise<number> {
    const { count, error } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Failed to get product count: ${error.message}`);
    }

    return count || 0;
  }

  static async getAllProducts(): Promise<Product[]> {
    const totalCount = await this.getProductCount();
    if (totalCount === 0) return [];

    const BATCH_SIZE = 1000;
    const allProducts: Product[] = [];
    let offset = 0;

    while (offset < totalCount) {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name')
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }

      if (data && data.length > 0) {
        allProducts.push(...data.map(row => ({
          barcode: row.barcode,
          name: row.name,
          brand: row.brand,
          image: row.image,
          techsheet: row.techsheet,
          price: Number(row.price),
          buyprice: Number(row.buyprice),
          reseller_price: Number(row.reseller_price),
          provider: row.provider,
          stock_levels: (row.stock_levels || {}) as Record<string, number>,
          created_at: row.created_at,
          updated_at: row.updated_at
        })));
        offset += data.length;
      } else {
        break;
      }
    }

    return allProducts;
  }

  static async analyzeProducts(): Promise<{
    totalCount: number;
    duplicateBarcodes: string[];
    invalidProducts: Product[];
    sampleProducts: Product[];
  }> {
    const products = await this.getAllProducts();

    const barcodeMap = new Map<string, number>();
    const duplicateBarcodes: string[] = [];
    const invalidProducts: Product[] = [];

    products.forEach(product => {
      if (!product.barcode || !product.name) {
        invalidProducts.push(product);
      }
      const count = barcodeMap.get(product.barcode) || 0;
      barcodeMap.set(product.barcode, count + 1);
      if (count === 1) duplicateBarcodes.push(product.barcode);
    });

    return {
      totalCount: products.length,
      duplicateBarcodes,
      invalidProducts,
      sampleProducts: products.slice(0, 5)
    };
  }

  static async resetDatabase(): Promise<void> {
    await this.deleteAllProducts();
  }
}
