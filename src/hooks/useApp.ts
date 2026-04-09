import { useState, useEffect } from 'react';
import { AppState, Meta } from '../types';
import { StorageManager } from '../utils/storage';
import { SyncManager, SyncStatus } from '../utils/syncManager';

export function useApp() {
  const [state, setState] = useState<AppState>({
    role: StorageManager.getRole(),
    isOnline: navigator.onLine,
    hasNewData: StorageManager.getHasNewData(),
    products: [],
    meta: null
  });

  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [activeLoginModalRole, setActiveLoginModalRole] = useState<'user' | 'admin' | null>(null);
  const syncManager = SyncManager.getInstance();

  // Initialize app with robust loading strategy
  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        
        // Load initial data using the sync manager
        const { products, meta } = await syncManager.initialLoad();
        
        setState(prev => ({
          ...prev,
          products,
          meta
        }));

        // Get initial sync status
        const status = await syncManager.getSyncStatus();
        setSyncStatus(status);

        console.log('App initialized successfully', {
          productsCount: products.length,
          metaVersion: meta?.version,
          syncStatus: status
        });

      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  // Listen for online/offline changes
  useEffect(() => {
    const handleOnlineChange = async () => {
      const isOnline = navigator.onLine;
      setState(prev => ({ ...prev, isOnline }));
      
      // Update sync status when connectivity changes
      const status = await syncManager.getSyncStatus();
      setSyncStatus(status);
      
      // Check for updates when coming back online
      if (isOnline) {
        console.log('Device came back online, checking for updates...');
        try {
          await syncManager.checkForUpdates();
        } catch (error) {
          console.warn('Failed to check for updates when coming online:', error);
        }
      }
    };

    window.addEventListener('online', handleOnlineChange);
    window.addEventListener('offline', handleOnlineChange);

    return () => {
      window.removeEventListener('online', handleOnlineChange);
      window.removeEventListener('offline', handleOnlineChange);
    };
  }, []);

  // Listen for sync status changes
  useEffect(() => {
    const unsubscribe = syncManager.subscribe((status) => {
      setSyncStatus(status);
      setState(prev => ({
        ...prev,
        hasNewData: status.needsSync
      }));
    });

    return unsubscribe;
  }, []);

  // Listen for new data broadcasts from other tabs
  useEffect(() => {
    const cleanup = StorageManager.listenForNewData(async () => {
      console.log('Received new data broadcast from another tab');
      
      // Reload data from local storage
      const { products, meta } = await syncManager.initialLoad();
      setState(prev => ({
        ...prev,
        products,
        meta,
        hasNewData: false
      }));

      // Update sync status
      const status = await syncManager.getSyncStatus();
      setSyncStatus(status);
    });

    return cleanup;
  }, []);

  // Setup periodic update checking
  useEffect(() => {
    const cleanup = syncManager.setupPeriodicCheck(300000); // Check every 5 minutes
    return cleanup;
  }, []);

  // Listen for role changes
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'inventory_role') {
        setState(prev => ({ ...prev, role: (e.newValue as AppState['role']) || 'sales' }));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Sync data function
  const syncData = async (forceSync = false): Promise<boolean> => {
    if (!state.isOnline) {
      throw new Error('Sync requires internet connection');
    }

    console.log('Starting sync process...');

    try {
      const result = await syncManager.performSync(forceSync);
      
      if (result.updated) {
        // Reload data after successful sync
        const { products, meta } = await syncManager.initialLoad();
        setState(prev => ({
          ...prev,
          products,
          meta,
          hasNewData: false
        }));
      }

      return result.updated;
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  };

  // Check for updates function
  const checkForUpdates = async (): Promise<boolean> => {
    return await syncManager.checkForUpdates();
  };

  // Get sync statistics
  const getSyncStats = async () => {
    return await syncManager.getSyncStats();
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
    syncStatus,
    syncData,
    checkForUpdates,
    getSyncStats,
    updateRole,
    activeLoginModalRole,
    openLoginModal
  };
}