import { useState, useEffect, useCallback } from 'react';
import { AppState, Product } from '../types';
import { StorageManager } from '../utils/storage';
import { SyncEngine, SyncInfo } from '../utils/syncEngine';
import { OfflineStorage } from '../utils/offlineStorage';

export function useApp() {
  const [state, setState] = useState<AppState>({
    role: StorageManager.getRole(),
    isOnline: navigator.onLine,
    hasNewData: false,
    products: [],
    meta: null
  });

  const [isLoading, setIsLoading] = useState(true);
  const [activeLoginModalRole, setActiveLoginModalRole] = useState<'user' | 'admin' | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo>(SyncEngine.getInfo());

  // Subscribe to sync engine state
  useEffect(() => {
    return SyncEngine.subscribe((info) => {
      setSyncInfo(info);
      setState(prev => ({ ...prev, isOnline: info.isOnline }));
    });
  }, []);

  // Load products: local cache first, then cloud
  useEffect(() => {
    const loadProducts = async () => {
      try {
        setIsLoading(true);
        
        // 1. Try local cache first (instant)
        const cached = await OfflineStorage.getCachedProducts();
        if (cached.length > 0) {
          setState(prev => ({ ...prev, products: cached }));
          console.log(`Loaded ${cached.length} products from local cache`);
          setIsLoading(false);
          
          // 2. Background sync from cloud
          if (navigator.onLine) {
            SyncEngine.pullProducts()
              .then(fresh => {
                setState(prev => ({ ...prev, products: fresh }));
                console.log(`Background sync: ${fresh.length} products from cloud`);
              })
              .catch(err => console.warn('Background sync failed:', err));
          }
        } else {
          // No cache — must fetch from cloud
          if (navigator.onLine) {
            const products = await SyncEngine.pullProducts();
            setState(prev => ({ ...prev, products }));
            console.log(`Loaded ${products.length} products from cloud (first sync)`);
          } else {
            console.warn('Offline with no cached data');
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load products:', error);
        setIsLoading(false);
      }
    };

    loadProducts();
    
    // Start periodic background sync (every 5 min)
    SyncEngine.startPeriodicSync();
    return () => SyncEngine.stopPeriodicSync();
  }, []);

  // Listen for online/offline + re-sync when coming back online
  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOnline: true }));
      // Re-fetch products when coming back online
      SyncEngine.pullProducts()
        .then(fresh => {
          setState(prev => ({ ...prev, products: fresh }));
          console.log('Reconnected: synced products from cloud');
        })
        .catch(err => console.warn('Reconnect sync failed:', err));
    };
    const handleOffline = () => setState(prev => ({ ...prev, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen for role changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'inventory_role') {
        setState(prev => ({ ...prev, role: (e.newValue as AppState['role']) || 'sales' }));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const syncData = useCallback(async (_forceSync = false): Promise<boolean> => {
    if (!state.isOnline) {
      throw new Error('Sync requires internet connection');
    }

    try {
      const { products } = await SyncEngine.pullAll();
      setState(prev => ({ ...prev, products, hasNewData: false }));
      return products.length > 0;
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }, [state.isOnline]);

  const checkForUpdates = async (): Promise<boolean> => {
    return false;
  };

  const getSyncStats = async () => {
    const stats = await OfflineStorage.getSyncStats();
    return stats;
  };

  const updateRole = (role: AppState['role']) => {
    setState(prev => ({ ...prev, role }));
    StorageManager.setRole(role);
  };

  const openLoginModal = (role: 'user' | 'admin' | null) => {
    setActiveLoginModalRole(role);
  };

  return {
    state,
    isLoading,
    syncStatus: null,
    syncInfo,
    syncData,
    checkForUpdates,
    getSyncStats,
    updateRole,
    activeLoginModalRole,
    openLoginModal
  };
}
