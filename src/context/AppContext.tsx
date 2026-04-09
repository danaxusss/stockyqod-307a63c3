import React, { createContext, useContext, ReactNode } from 'react';
import { AppState, Meta } from '../types';
import { SyncStatus } from '../utils/syncManager';
import { useApp } from '../hooks/useApp';

interface AppContextType {
  state: AppState;
  isLoading: boolean;
  syncStatus: SyncStatus | null;
  syncData: (forceSync?: boolean) => Promise<boolean>;
  checkForUpdates: () => Promise<boolean>;
  getSyncStats: () => Promise<any>;
  updateRole: (role: AppState['role']) => void;
  activeLoginModalRole: 'user' | 'admin' | null;
  openLoginModal: (role: 'user' | 'admin' | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const appData = useApp();

  return (
    <AppContext.Provider value={appData}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextType {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}