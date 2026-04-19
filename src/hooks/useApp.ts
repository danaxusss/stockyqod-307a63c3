import { useState, useEffect, useCallback } from 'react';
import { AppState, Product } from '../types';
import { StorageManager } from '../utils/storage';
import { getProducts, saveProducts } from '../utils/database';
import { ProductUploadService } from '../utils/productUploadService';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncInfo {
  state: SyncState;
  lastSync: Date | null;
  pendingChanges: number;
  isOnline: boolean;
}

let periodicSyncTimer: ReturnType<typeof setInterval> | null = null;

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
  const [syncInfo, setSyncInfo] = useState<SyncInfo>({
    state: 'idle',
    lastSync: null,
    pendingChanges: 0,
    isOnline: navigator.onLine,
  });

  const pullProducts = useCallback(async (): Promise<Product[]> => {
    setSyncInfo(prev => ({ ...prev, state: 'syncing' }));
    try {
      const products = await ProductUploadService.getAllProducts();
      await saveProducts(products);
      setSyncInfo(prev => ({ ...prev, state: 'idle', lastSync: new Date() }));
      return products;
    } catch (error) {
      setSyncInfo(prev => ({ ...prev, state: navigator.onLine ? 'error' : 'offline' }));
      throw error;
    }
  }, []);

  // Load products: local cache first, then cloud
  useEffect(() => {
    const loadProducts = async () => {
      try {
        setIsLoading(true);

        const cached = await getProducts();
        if (cached.length > 0) {
          setState(prev => ({ ...prev, products: cached }));
          setIsLoading(false);

          if (navigator.onLine) {
            pullProducts()
              .then(fresh => setState(prev => ({ ...prev, products: fresh })))
              .catch(err => console.warn('Background sync failed:', err));
          }
        } else {
          if (navigator.onLine) {
            const products = await pullProducts();
            setState(prev => ({ ...prev, products }));
          } else {
            setSyncInfo(prev => ({ ...prev, state: 'offline' }));
          }
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load products:', error);
        setIsLoading(false);
      }
    };

    loadProducts();

    periodicSyncTimer = setInterval(() => {
      if (navigator.onLine) {
        pullProducts()
          .then(fresh => setState(prev => ({ ...prev, products: fresh })))
          .catch(err => console.warn('Periodic sync failed:', err));
      }
    }, 5 * 60 * 1000);

    return () => {
      if (periodicSyncTimer) {
        clearInterval(periodicSyncTimer);
        periodicSyncTimer = null;
      }
    };
  }, [pullProducts]);

  // Online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setSyncInfo(prev => ({ ...prev, isOnline: true }));
      setState(prev => ({ ...prev, isOnline: true }));
      pullProducts()
        .then(fresh => setState(prev => ({ ...prev, products: fresh })))
        .catch(err => console.warn('Reconnect sync failed:', err));
    };
    const handleOffline = () => {
      setSyncInfo(prev => ({ ...prev, isOnline: false, state: 'offline' }));
      setState(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pullProducts]);

  // Role changes from other tabs
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
    if (!state.isOnline) throw new Error('Sync requires internet connection');
    const products = await pullProducts();
    setState(prev => ({ ...prev, products, hasNewData: false }));
    return products.length > 0;
  }, [state.isOnline, pullProducts]);

  const checkForUpdates = async (): Promise<boolean> => false;

  const getSyncStats = async () => ({
    productCount: state.products.length,
    pendingCount: 0,
  });

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
