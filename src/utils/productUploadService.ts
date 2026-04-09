import { supabase } from './supabaseClient';
import { Product } from '../types';

export class ProductUploadService {
  static async uploadProducts(products: Product[]): Promise<void> {
    if (products.length === 0) {
      throw new Error('No products to upload');
    }

    console.log(`Starting upload of ${products.length} products to Supabase`);

    const validProducts: Product[] = [];

    for (const product of products) {
      if (!product.barcode || typeof product.barcode !== 'string' || product.barcode.trim().length === 0) continue;
      if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) continue;

      validProducts.push({
        barcode: String(product.barcode).trim(),
        name: String(product.name).trim(),
        brand: String(product.brand || '').trim(),
        techsheet: String(product.techsheet || '').trim(),
        price: Number(product.price) || 0,
        buyprice: Number(product.buyprice) || 0,
        reseller_price: Number(product.reseller_price) || 0,
        provider: String(product.provider || '').trim(),
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

    if (totalFailed > 0) {
      throw new Error(`Upload partially failed: ${totalUploaded} products uploaded, ${totalFailed} failed.`);
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
