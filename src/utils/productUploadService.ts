import { productsApi } from '@/lib/apiClient';
import { Product } from '../types';

export class ProductUploadService {
  static async uploadProducts(products: Product[]): Promise<void> {
    if (products.length === 0) throw new Error('No products to upload');
    const { count } = await productsApi.bulkUpsert(products);
    console.log(`Uploaded ${count} products`);
  }

  static async getAllProducts(): Promise<Product[]> {
    const { products } = await productsApi.getAll();
    return (products as Record<string, unknown>[]).map(p => ({
      barcode: p.barcode as string,
      name: p.name as string,
      brand: (p.brand as string) ?? '',
      techsheet: (p.techsheet as string) ?? '',
      price: Number(p.price ?? 0),
      buyprice: Number(p.buyprice ?? 0),
      reseller_price: Number(p.reseller_price ?? 0),
      provider: (p.provider as string) ?? '',
      stock_levels: (p.stock_levels as Record<string, number>) ?? {},
      created_at: p.created_at as string | undefined,
      updated_at: p.updated_at as string | undefined,
    }));
  }
}
