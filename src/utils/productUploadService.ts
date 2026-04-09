// @ts-nocheck
import { supabase } from './supabaseClient';
import { Product } from '../types';

export class ProductUploadService {
  static async uploadProducts(products: Product[]): Promise<void> {
    if (products.length === 0) {
      throw new Error('No products to upload');
    }

    console.log(`Starting upload of ${products.length} products to Supabase`);

    // Validate and normalize products before upload
    const validProducts: Product[] = [];
    const invalidProducts: { product: any; reason: string }[] = [];

    for (const product of products) {
      try {
        // Validate required fields
        if (!product.barcode || typeof product.barcode !== 'string' || product.barcode.trim().length === 0) {
          invalidProducts.push({ product, reason: 'Invalid or empty barcode' });
          continue;
        }

        if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) {
          invalidProducts.push({ product, reason: 'Invalid or empty name' });
          continue;
        }

        // Normalize the product for Supabase
        const normalizedProduct: Product = {
          barcode: String(product.barcode).trim(),
          name: String(product.name).trim(),
          brand: String(product.brand || '').trim(),
          techsheet: String(product.techsheet || '').trim(),
          price: Number(product.price) || 0,
          buyprice: Number(product.buyprice) || 0,
          reseller_price: Number(product.reseller_price) || 0,
          provider: String(product.provider || '').trim(),
          stock_levels: product.stock_levels || {}
        };

        validProducts.push(normalizedProduct);
      } catch (error) {
        invalidProducts.push({ 
          product, 
          reason: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}` 
        });
      }
    }

    console.log(`Validated ${validProducts.length} products, rejected ${invalidProducts.length} products`);
    
    if (invalidProducts.length > 0) {
      console.warn('Invalid products that will be skipped:', invalidProducts);
    }

    if (validProducts.length === 0) {
      throw new Error('No valid products to upload after validation');
    }

    // Batch size for Supabase operations
    const BATCH_SIZE = 100;
    const batches = [];
    
    for (let i = 0; i < validProducts.length; i += BATCH_SIZE) {
      batches.push(validProducts.slice(i, i + BATCH_SIZE));
    }

    console.log(`Uploading ${validProducts.length} products in ${batches.length} batches`);

    let totalUploaded = 0;
    let totalFailed = 0;
    const failedBatches: { batchIndex: number; error: string }[] = [];

    // Process batches sequentially to avoid overwhelming Supabase
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Uploading batch ${i + 1}/${batches.length} (${batch.length} products)`);
      
      try {
        const { error, count } = await supabase
          .from('products')
          .upsert(batch, {
            onConflict: 'barcode',
            ignoreDuplicates: false,
            count: 'exact'
          });

        if (error) {
          console.error(`Batch ${i + 1} failed:`, error);
          failedBatches.push({ batchIndex: i + 1, error: error.message });
          totalFailed += batch.length;
        } else {
          console.log(`Batch ${i + 1} uploaded successfully (${count} rows affected)`);
          totalUploaded += batch.length;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Batch ${i + 1} failed with exception:`, errorMessage);
        failedBatches.push({ batchIndex: i + 1, error: errorMessage });
        totalFailed += batch.length;
      }
    }

    console.log(`Upload completed: ${totalUploaded} successful, ${totalFailed} failed`);

    if (failedBatches.length > 0) {
      console.error('Failed batches:', failedBatches);
      throw new Error(`Upload partially failed: ${totalUploaded} products uploaded, ${totalFailed} failed. Check console for details.`);
    }

    // Verify the upload by checking the total count
    const finalCount = await this.getProductCount();
    console.log(`Final product count in Supabase: ${finalCount}`);
  }

  static async deleteAllProducts(): Promise<void> {
    console.log('Starting to delete all products from Supabase');
    
    // First, get the current count
    const initialCount = await this.getProductCount();
    console.log(`Current product count: ${initialCount}`);

    if (initialCount === 0) {
      console.log('No products to delete');
      return;
    }

    // Delete all products in batches to handle large datasets
    const BATCH_SIZE = 1000;
    let deletedTotal = 0;

    while (true) {
      console.log(`Deleting batch of up to ${BATCH_SIZE} products...`);
      
      const { error, count } = await supabase
        .from('products')
        .delete({ count: 'exact' })
        .limit(BATCH_SIZE);

      if (error) {
        console.error('Failed to delete products batch:', error);
        throw new Error(`Failed to delete products: ${error.message}`);
      }

      const deletedInBatch = count || 0;
      deletedTotal += deletedInBatch;
      
      console.log(`Deleted ${deletedInBatch} products in this batch. Total deleted: ${deletedTotal}`);

      // If we deleted fewer than the batch size, we're done
      if (deletedInBatch < BATCH_SIZE) {
        break;
      }
    }

    // Verify deletion
    const finalCount = await this.getProductCount();
    console.log(`Products deletion completed. Final count: ${finalCount}`);
    
    if (finalCount > 0) {
      console.warn(`Warning: ${finalCount} products still remain after deletion`);
      throw new Error(`Deletion incomplete: ${finalCount} products still remain`);
    }

    console.log(`Successfully deleted all ${deletedTotal} products from Supabase`);
  }

  static async getProductCount(): Promise<number> {
    const { count, error } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Failed to get product count:', error);
      throw new Error(`Failed to get product count: ${error.message}`);
    }

    return count || 0;
  }

  static async getAllProducts(): Promise<Product[]> {
    console.log('Fetching all products from Supabase');
    
    // Get total count first
    const totalCount = await this.getProductCount();
    console.log(`Total products in Supabase: ${totalCount}`);
    
    if (totalCount === 0) {
      return [];
    }

    // Fetch all products in batches to handle large datasets
    const BATCH_SIZE = 1000;
    const allProducts: Product[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching batch starting at offset ${offset}...`);
      
      const { data: batch, error } = await supabase
        .from('products')
        .select('*')
        .order('name')
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error('Failed to fetch product batch:', error);
        throw new Error(`Failed to fetch products: ${error.message}`);
      }

      if (batch && batch.length > 0) {
        allProducts.push(...batch);
        console.log(`Fetched ${batch.length} products in this batch. Total so far: ${allProducts.length}`);
        
        // Check if we've reached the end
        if (batch.length < BATCH_SIZE || allProducts.length >= totalCount) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`Successfully fetched all ${allProducts.length} products from Supabase`);
    return allProducts;
  }

  // Debug function to analyze product data
  static async analyzeProducts(): Promise<{
    totalCount: number;
    duplicateBarcodes: string[];
    invalidProducts: any[];
    sampleProducts: Product[];
  }> {
    const products = await this.getAllProducts();
    
    // Check for duplicates
    const barcodeMap = new Map<string, number>();
    const duplicateBarcodes: string[] = [];
    const invalidProducts: any[] = [];
    
    products.forEach(product => {
      // Check for invalid products
      if (!product.barcode || !product.name) {
        invalidProducts.push(product);
      }
      
      // Check for duplicates
      const barcode = String(product.barcode);
      const count = barcodeMap.get(barcode) || 0;
      barcodeMap.set(barcode, count + 1);
      
      if (count === 1) { // Second occurrence
        duplicateBarcodes.push(barcode);
      }
    });

    return {
      totalCount: products.length,
      duplicateBarcodes,
      invalidProducts,
      sampleProducts: products.slice(0, 5)
    };
  }

  // Complete database reset - clears all products from Supabase
  static async resetDatabase(): Promise<void> {
    console.log('Starting complete database reset...');
    
    try {
      await this.deleteAllProducts();
      console.log('Database reset completed successfully');
    } catch (error) {
      console.error('Database reset failed:', error);
      throw error;
    }
  }
}