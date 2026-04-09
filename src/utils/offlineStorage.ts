import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Product, Quote } from '../types';

interface StockyDB extends DBSchema {
  products: {
    key: string; // barcode
    value: Product & { _syncedAt: string };
    indexes: { 'by-brand': string; 'by-updated': string };
  };
  quotes: {
    key: string; // id
    value: {
      id: string;
      quote_number: string;
      command_number?: string;
      created_at: string;
      updated_at: string;
      status: string;
      customer_info: any;
      items: any;
      total_amount: number;
      notes?: string;
      _syncedAt: string;
      _pendingSync?: boolean;
    };
    indexes: { 'by-status': string; 'by-pending': string };
  };
  sync_queue: {
    key: string;
    value: {
      id: string;
      table: string;
      action: 'insert' | 'update' | 'delete';
      data: any;
      created_at: string;
    };
  };
  meta: {
    key: string;
    value: { key: string; value: any };
  };
}

const DB_NAME = 'stocky-offline';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<StockyDB> | null = null;

async function getDB(): Promise<IDBPDatabase<StockyDB>> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB<StockyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Products store
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'barcode' });
        productStore.createIndex('by-brand', 'brand');
        productStore.createIndex('by-updated', 'updated_at');
      }
      
      // Quotes store
      if (!db.objectStoreNames.contains('quotes')) {
        const quoteStore = db.createObjectStore('quotes', { keyPath: 'id' });
        quoteStore.createIndex('by-status', 'status');
        quoteStore.createIndex('by-pending', '_pendingSync');
      }
      
      // Sync queue
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id' });
      }
      
      // Meta store for last sync timestamps etc.
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    },
  });
  
  return dbInstance;
}

export class OfflineStorage {
  // ========== PRODUCTS ==========
  
  static async cacheProducts(products: Product[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('products', 'readwrite');
    const now = new Date().toISOString();
    
    // Clear existing and write fresh
    await tx.store.clear();
    for (const product of products) {
      await tx.store.put({ ...product, _syncedAt: now });
    }
    await tx.done;
    
    // Update last sync timestamp
    await this.setMeta('products_last_sync', now);
  }
  
  static async getCachedProducts(): Promise<Product[]> {
    const db = await getDB();
    const all = await db.getAll('products');
    // Strip internal fields
    return all.map(({ _syncedAt, ...product }) => product as Product);
  }
  
  static async getProductCount(): Promise<number> {
    const db = await getDB();
    return db.count('products');
  }
  
  // ========== QUOTES ==========
  
  static async cacheQuotes(quotes: any[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('quotes', 'readwrite');
    const now = new Date().toISOString();
    
    // Only overwrite non-pending quotes
    for (const quote of quotes) {
      const existing = await tx.store.get(quote.id);
      if (existing?._pendingSync) continue; // Don't overwrite pending local changes
      await tx.store.put({ ...quote, _syncedAt: now, _pendingSync: false });
    }
    await tx.done;
    
    await this.setMeta('quotes_last_sync', now);
  }
  
  static async getCachedQuotes(): Promise<any[]> {
    const db = await getDB();
    const all = await db.getAll('quotes');
    return all.map(({ _syncedAt, _pendingSync, ...quote }) => quote);
  }
  
  static async saveQuoteLocally(quote: any): Promise<void> {
    const db = await getDB();
    const now = new Date().toISOString();
    await db.put('quotes', { ...quote, _syncedAt: now, _pendingSync: true });
  }
  
  static async getPendingQuotes(): Promise<any[]> {
    const db = await getDB();
    const all = await db.getAll('quotes');
    return all.filter(q => q._pendingSync);
  }
  
  static async markQuoteSynced(id: string): Promise<void> {
    const db = await getDB();
    const quote = await db.get('quotes', id);
    if (quote) {
      quote._pendingSync = false;
      quote._syncedAt = new Date().toISOString();
      await db.put('quotes', quote);
    }
  }
  
  // ========== SYNC QUEUE ==========
  
  static async addToSyncQueue(table: string, action: 'insert' | 'update' | 'delete', data: any): Promise<void> {
    const db = await getDB();
    await db.put('sync_queue', {
      id: `${table}_${action}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      table,
      action,
      data,
      created_at: new Date().toISOString(),
    });
  }
  
  static async getSyncQueue(): Promise<any[]> {
    const db = await getDB();
    return db.getAll('sync_queue');
  }
  
  static async clearSyncQueueItem(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('sync_queue', id);
  }
  
  static async clearSyncQueue(): Promise<void> {
    const db = await getDB();
    await db.clear('sync_queue');
  }
  
  // ========== META ==========
  
  static async setMeta(key: string, value: any): Promise<void> {
    const db = await getDB();
    await db.put('meta', { key, value });
  }
  
  static async getMeta(key: string): Promise<any> {
    const db = await getDB();
    const entry = await db.get('meta', key);
    return entry?.value ?? null;
  }
  
  // ========== UTILITIES ==========
  
  static async getLastSyncTime(table: string): Promise<Date | null> {
    const val = await this.getMeta(`${table}_last_sync`);
    return val ? new Date(val) : null;
  }
  
  static async hasLocalData(): Promise<boolean> {
    const count = await this.getProductCount();
    return count > 0;
  }
  
  static async clearAll(): Promise<void> {
    const db = await getDB();
    await db.clear('products');
    await db.clear('quotes');
    await db.clear('sync_queue');
    await db.clear('meta');
  }
  
  static async getSyncStats() {
    const productCount = await this.getProductCount();
    const db = await getDB();
    const quoteCount = await db.count('quotes');
    const pendingCount = (await this.getPendingQuotes()).length;
    const queueCount = (await this.getSyncQueue()).length;
    const lastProductSync = await this.getLastSyncTime('products');
    const lastQuoteSync = await this.getLastSyncTime('quotes');
    
    return {
      productCount,
      quoteCount,
      pendingCount,
      queueCount,
      lastProductSync,
      lastQuoteSync,
    };
  }
}
