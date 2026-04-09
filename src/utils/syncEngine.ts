import { OfflineStorage } from './offlineStorage';
import { ProductUploadService } from './productUploadService';
import { SupabaseQuotesService } from './supabaseQuotes';
import { Product } from '../types';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncInfo {
  state: SyncState;
  lastSync: Date | null;
  pendingChanges: number;
  isOnline: boolean;
}

type SyncListener = (info: SyncInfo) => void;

class SyncEngineClass {
  private listeners: Set<SyncListener> = new Set();
  private syncInfo: SyncInfo = {
    state: 'idle',
    lastSync: null,
    pendingChanges: 0,
    isOnline: navigator.onLine,
  };
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.syncInfo);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(fn => fn({ ...this.syncInfo }));
  }

  private update(partial: Partial<SyncInfo>) {
    Object.assign(this.syncInfo, partial);
    this.notify();
  }

  private async handleOnline() {
    this.update({ isOnline: true });
    // Auto-sync when coming back online
    await this.pushPendingChanges();
    await this.pullAll();
  }

  private handleOffline() {
    this.update({ isOnline: false, state: 'offline' });
  }

  // ========== PULL: Cloud → Local ==========

  async pullProducts(): Promise<Product[]> {
    try {
      this.update({ state: 'syncing' });
      const products = await ProductUploadService.getAllProducts();
      await OfflineStorage.cacheProducts(products);
      this.update({ state: 'idle', lastSync: new Date() });
      return products;
    } catch (error) {
      console.error('Pull products failed:', error);
      this.update({ state: navigator.onLine ? 'error' : 'offline' });
      throw error;
    }
  }

  async pullQuotes(): Promise<any[]> {
    try {
      const quotes = await SupabaseQuotesService.getAllQuotes();
      await OfflineStorage.cacheQuotes(quotes);
      return quotes;
    } catch (error) {
      console.error('Pull quotes failed:', error);
      throw error;
    }
  }

  async pullAll(): Promise<{ products: Product[] }> {
    if (!navigator.onLine) {
      throw new Error('Cannot sync while offline');
    }
    this.update({ state: 'syncing' });
    try {
      const products = await this.pullProducts();
      // Quotes are pulled separately on-demand
      this.update({ state: 'idle', lastSync: new Date() });
      return { products };
    } catch (error) {
      this.update({ state: 'error' });
      throw error;
    }
  }

  // ========== PUSH: Local → Cloud ==========

  async pushPendingChanges(): Promise<void> {
    if (!navigator.onLine) return;

    const pendingQuotes = await OfflineStorage.getPendingQuotes();
    if (pendingQuotes.length === 0) return;

    this.update({ state: 'syncing' });

    for (const quote of pendingQuotes) {
      try {
        await SupabaseQuotesService.saveQuote(quote);
        await OfflineStorage.markQuoteSynced(quote.id);
      } catch (error) {
        console.error(`Failed to push quote ${quote.id}:`, error);
      }
    }

    const remaining = (await OfflineStorage.getPendingQuotes()).length;
    this.update({ state: 'idle', pendingChanges: remaining });
  }

  // ========== LOAD: Local first, then Cloud ==========

  async loadProducts(): Promise<Product[]> {
    // 1. Serve from cache immediately
    const cached = await OfflineStorage.getCachedProducts();
    
    if (!navigator.onLine) {
      this.update({ state: 'offline' });
      return cached;
    }

    // 2. If we have cache, return it and sync in background
    if (cached.length > 0) {
      // Background sync - don't await
      this.pullProducts().catch(err => console.warn('Background sync failed:', err));
      return cached;
    }

    // 3. No cache, must fetch from cloud
    try {
      return await this.pullProducts();
    } catch (error) {
      console.error('Failed to load products:', error);
      return cached; // Return empty array if both fail
    }
  }

  // ========== PERIODIC SYNC ==========

  startPeriodicSync(intervalMs = 5 * 60 * 1000) {
    this.stopPeriodicSync();
    this.syncTimer = setInterval(() => {
      if (navigator.onLine) {
        this.pullProducts().catch(err => 
          console.warn('Periodic sync failed:', err)
        );
      }
    }, intervalMs);
  }

  stopPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ========== STATUS ==========

  getInfo(): SyncInfo {
    return { ...this.syncInfo };
  }

  async refreshPendingCount() {
    const pending = await OfflineStorage.getPendingQuotes();
    this.update({ pendingChanges: pending.length });
  }
}

export const SyncEngine = new SyncEngineClass();
