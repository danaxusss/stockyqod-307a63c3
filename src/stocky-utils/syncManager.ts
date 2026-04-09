import { Product, Meta, SyncData } from '../types';
import { ApiService } from './api';
import { initDB, saveProducts, saveMeta, getProducts, getMeta } from './database';
import { StorageManager } from './storage';

export interface SyncStatus {
  isOnline: boolean;
  hasLocalData: boolean;
  hasServerData: boolean;
  isUpToDate: boolean;
  lastSyncTime: Date | null;
  serverVersion: string | null;
  localVersion: string | null;
  needsSync: boolean;
}

export interface SyncResult {
  success: boolean;
  updated: boolean;
  error?: string;
  productsCount?: number;
  version?: string;
}

export class SyncManager {
  private static instance: SyncManager;
  private syncInProgress = false;
  private retryCount = 0;
  private maxRetries = 3;
  private retryDelay = 1000; // Start with 1 second
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  // Subscribe to sync status changes
  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(status: SyncStatus) {
    this.listeners.forEach(listener => listener(status));
  }

  // Get current sync status
  async getSyncStatus(): Promise<SyncStatus> {
    const isOnline = navigator.onLine;
    const localVersion = StorageManager.getVersion();
    const lastSyncTime = StorageManager.getLastSyncTime();
    
    let serverVersion: string | null = null;
    let hasServerData = false;
    
    if (isOnline) {
      try {
        const meta = await ApiService.fetchMeta();
        serverVersion = meta.version;
        hasServerData = true;
      } catch (error) {
        console.warn('Failed to fetch server meta:', error);
      }
    }

    const products = await getProducts();
    const hasLocalData = products.length > 0;
    
    const isUpToDate = localVersion === serverVersion && hasLocalData;
    const needsSync = hasServerData && (!hasLocalData || !isUpToDate);

    const status: SyncStatus = {
      isOnline,
      hasLocalData,
      hasServerData,
      isUpToDate,
      lastSyncTime,
      serverVersion,
      localVersion,
      needsSync
    };

    this.notifyListeners(status);
    return status;
  }

  // Initial load with fallback strategy
  async initialLoad(): Promise<{ products: Product[], meta: Meta | null }> {
    console.log('Starting initial load...');
    
    try {
      await initDB();
      
      // Strategy 1: Try to load fresh data from server if online
      if (navigator.onLine) {
        try {
          console.log('Online - attempting to fetch fresh data...');
          const syncResult = await this.performSync();
          
          if (syncResult.success) {
            const [products, meta] = await Promise.all([
              getProducts(),
              getMeta()
            ]);
            console.log('Successfully loaded fresh data from server');
            return { products, meta };
          }
        } catch (error) {
          console.warn('Failed to fetch fresh data, falling back to cache:', error);
        }
      }

      // Strategy 2: Load from local cache
      console.log('Loading from local cache...');
      const [products, meta] = await Promise.all([
        getProducts(),
        getMeta()
      ]);

      // Strategy 3: If no local data and online, try basic meta fetch
      if (products.length === 0 && navigator.onLine) {
        try {
          console.log('No cached data, fetching basic meta...');
          const freshMeta = await ApiService.fetchMeta();
          await saveMeta(freshMeta);
          StorageManager.setAdminPin(freshMeta.adminPin);
          return { products, meta: freshMeta };
        } catch (error) {
          console.warn('Failed to fetch basic meta:', error);
        }
      }

      return { products, meta };
    } catch (error) {
      console.error('Initial load failed:', error);
      // Return empty state as last resort
      return { products: [], meta: null };
    }
  }

  // Perform synchronization with retry logic
  async performSync(forceSync = false): Promise<SyncResult> {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress');
    }

    if (!navigator.onLine) {
      throw new Error('Sync requires internet connection');
    }

    this.syncInProgress = true;
    this.retryCount = 0;

    try {
      const result = await this.attemptSync(forceSync);
      this.syncInProgress = false;
      return result;
    } catch (error) {
      this.syncInProgress = false;
      throw error;
    }
  }

  private async attemptSync(forceSync: boolean): Promise<SyncResult> {
    try {
      console.log(`Sync attempt ${this.retryCount + 1}/${this.maxRetries + 1}`);
      
      const syncData = await ApiService.fetchFullSync();
      
      if (!syncData.meta || !Array.isArray(syncData.rows)) {
        throw new Error('Invalid sync data structure received');
      }

      const currentVersion = StorageManager.getVersion();
      const serverVersion = syncData.meta.version;
      
      console.log('Version comparison:', { currentVersion, serverVersion });

      // Check if sync is needed
      if (!forceSync && currentVersion === serverVersion) {
        console.log('Data is already up to date');
        return {
          success: true,
          updated: false,
          productsCount: syncData.rows.length,
          version: serverVersion
        };
      }

      // Perform the sync
      console.log('Updating local data...');
      
      await Promise.all([
        saveProducts(syncData.rows),
        saveMeta(syncData.meta)
      ]);

      // Update storage metadata
      StorageManager.setVersion(syncData.meta.version);
      StorageManager.setAdminPin(syncData.meta.adminPin);
      StorageManager.setLastSyncTime(new Date());
      StorageManager.setHasNewData(false);

      // Broadcast update to other tabs
      StorageManager.broadcastNewData();

      console.log('Sync completed successfully');
      
      // Update sync status
      await this.getSyncStatus();

      return {
        success: true,
        updated: true,
        productsCount: syncData.rows.length,
        version: syncData.meta.version
      };

    } catch (error) {
      console.error(`Sync attempt ${this.retryCount + 1} failed:`, error);
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        const delay = this.retryDelay * Math.pow(2, this.retryCount - 1); // Exponential backoff
        
        console.log(`Retrying sync in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.attemptSync(forceSync);
      }

      throw new Error(`Sync failed after ${this.maxRetries + 1} attempts: ${error.message}`);
    }
  }

  // Check for updates without syncing
  async checkForUpdates(): Promise<boolean> {
    if (!navigator.onLine) {
      return false;
    }

    try {
      const meta = await ApiService.fetchMeta();
      const currentVersion = StorageManager.getVersion();
      
      const hasUpdates = currentVersion !== meta.version;
      
      if (hasUpdates) {
        StorageManager.setHasNewData(true);
        await this.getSyncStatus(); // Update status
      }
      
      return hasUpdates;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to check for updates (working offline):', errorMessage);
      
      return false;
    }
  }

  // Setup periodic update checking
  setupPeriodicCheck(intervalMs = 300000): () => void { // 5 minutes default
    const interval = setInterval(async () => {
      if (navigator.onLine) {
        await this.checkForUpdates();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }

  // Get sync statistics
  async getSyncStats() {
    const products = await getProducts();
    const meta = await getMeta();
    const lastSyncTime = StorageManager.getLastSyncTime();
    const version = StorageManager.getVersion();

    return {
      productsCount: products.length,
      lastSyncTime,
      version,
      metaVersion: meta?.version,
      hasLocalData: products.length > 0,
      isOnline: navigator.onLine
    };
  }
}