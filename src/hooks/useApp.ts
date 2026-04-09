import { useState, useEffect } from 'react';
import { AppState, Product } from '../types';
import { StorageManager } from '../utils/storage';
import { ProductUploadService } from '../utils/productUploadService';

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

  // Load products directly from Supabase
  useEffect(() => {
    const loadProducts = async () => {
      try {
        setIsLoading(true);
        const products = await ProductUploadService.getAllProducts();
        setState(prev => ({ ...prev, products }));
        console.log(`Loaded ${products.length} products from Supabase`);
      } catch (error) {
        console.error('Failed to load products:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProducts();
  }, []);

  // Listen for online/offline changes
  useEffect(() => {
    const handleOnline = () => setState(prev => ({ ...prev, isOnline: true }));
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

  // Refresh products from Supabase
  const syncData = async (_forceSync = false): Promise<boolean> => {
    if (!state.isOnline) {
      throw new Error('Sync requires internet connection');
    }

    try {
      const products = await ProductUploadService.getAllProducts();
      setState(prev => ({ ...prev, products, hasNewData: false }));
      return products.length > 0;
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  };

  const checkForUpdates = async (): Promise<boolean> => {
    return false; // Not needed with direct Supabase access
  };

  const getSyncStats = async () => {
    const count = await ProductUploadService.getProductCount();
    return { productCount: count };
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
    syncData,
    checkForUpdates,
    getSyncStats,
    updateRole,
    activeLoginModalRole,
    openLoginModal
  };
}
