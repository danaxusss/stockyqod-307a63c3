import { useState, useEffect, useCallback } from 'react';
import { AppUser } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { ActivityLogger } from '../utils/activityLogger';

const AUTH_STORAGE_KEY = 'inventory_user_authenticated';
const AUTH_TIME_KEY = 'inventory_user_auth_time';
const USER_DATA_KEY = 'inventory_authenticated_user';
const AUTH_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const USER_AUTH_CHANGE_EVENT = 'user-auth-state-change';

class UserAuthStateManager {
  private listeners: Set<() => void> = new Set();
  
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notify() {
    this.listeners.forEach(listener => listener());
    window.dispatchEvent(new CustomEvent(USER_AUTH_CHANGE_EVENT));
  }
}

const userAuthStateManager = new UserAuthStateManager();

function checkAuthenticationStatus(): boolean {
  try {
    const isAuth = localStorage.getItem(AUTH_STORAGE_KEY) === 'true';
    const authTime = localStorage.getItem(AUTH_TIME_KEY);
    
    if (!isAuth || !authTime) return false;

    const authTimestamp = parseInt(authTime);
    if (Date.now() - authTimestamp > AUTH_DURATION) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(AUTH_TIME_KEY);
      localStorage.removeItem(USER_DATA_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function useUserAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => checkAuthenticationStatus());
  const [authenticatedUser, setAuthenticatedUser] = useState<AppUser | null>(() => {
    const stored = localStorage.getItem(USER_DATA_KEY);
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });
  const [forceUpdate, setForceUpdate] = useState(0);

  const triggerUpdate = useCallback(() => {
    setForceUpdate(prev => prev + 1);
  }, []);

  useEffect(() => {
    const unsubscribe = userAuthStateManager.subscribe(() => {
      setIsAuthenticated(checkAuthenticationStatus());
      const stored = localStorage.getItem(USER_DATA_KEY);
      try { setAuthenticatedUser(stored ? JSON.parse(stored) : null); } catch { setAuthenticatedUser(null); }
      triggerUpdate();
    });
    return () => { unsubscribe(); };
  }, [triggerUpdate]);

  useEffect(() => {
    const handleAuthChange = () => {
      setIsAuthenticated(checkAuthenticationStatus());
      triggerUpdate();
    };
    window.addEventListener(USER_AUTH_CHANGE_EVENT, handleAuthChange);
    return () => window.removeEventListener(USER_AUTH_CHANGE_EVENT, handleAuthChange);
  }, [triggerUpdate]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY || e.key === AUTH_TIME_KEY || e.key === USER_DATA_KEY) {
        setIsAuthenticated(checkAuthenticationStatus());
        const stored = localStorage.getItem(USER_DATA_KEY);
        setAuthenticatedUser(stored ? JSON.parse(stored) : null);
        triggerUpdate();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [triggerUpdate]);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = checkAuthenticationStatus();
      if (current !== isAuthenticated) {
        setIsAuthenticated(current);
        userAuthStateManager.notify();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const login = useCallback(async (): Promise<void> => {
    localStorage.setItem(AUTH_STORAGE_KEY, 'true');
    localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
    setIsAuthenticated(true);
    userAuthStateManager.notify();
  }, []);

  const loginWithCredentials = useCallback(async (username: string, pin: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify', username, pin }
      });
      if (error || !data?.success) return false;
      const user = data.user as AppUser;
      localStorage.setItem(AUTH_STORAGE_KEY, 'true');
      localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
      // Store PIN in sessionStorage for admin operations (cleared on tab close)
      if (user.is_admin || user.is_superadmin) {
        sessionStorage.setItem('inventory_admin_pin', pin);
      }
      setIsAuthenticated(true);
      setAuthenticatedUser(user);
      userAuthStateManager.notify();
      ActivityLogger.log('login', `User ${user.username} logged in`);
      return true;
    } catch (error) {
      console.error('Login with credentials failed:', error);
      return false;
    }
  }, []);

  const loginWithPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify-pin-only', pin }
      });
      if (error || !data?.success) return false;
      const user = data.user as AppUser;
      localStorage.setItem(AUTH_STORAGE_KEY, 'true');
      localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
      if (user.is_admin || user.is_superadmin) {
        sessionStorage.setItem('inventory_admin_pin', pin);
      }
      setIsAuthenticated(true);
      setAuthenticatedUser(user);
      userAuthStateManager.notify();
      return true;
    } catch (error) {
      console.error('PIN login failed:', error);
      return false;
    }
  }, []);

  const logout = useCallback((): void => {
    ActivityLogger.log('logout', 'User logged out');
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
    localStorage.removeItem(USER_DATA_KEY);
    sessionStorage.removeItem('inventory_admin_pin');
    setIsAuthenticated(false);
    setAuthenticatedUser(null);
    userAuthStateManager.notify();
  }, []);

  const getRemainingTime = useCallback((): number => {
    const authTime = localStorage.getItem(AUTH_TIME_KEY);
    if (!authTime) return 0;
    return Math.max(0, AUTH_DURATION - (Date.now() - parseInt(authTime)));
  }, []);

  const getSessionInfo = useCallback(() => {
    const authTime = localStorage.getItem(AUTH_TIME_KEY);
    if (!authTime) return null;
    const remaining = getRemainingTime();
    return {
      loginTime: new Date(parseInt(authTime)),
      remainingTime: remaining,
      hoursRemaining: Math.floor(remaining / (60 * 60 * 1000)),
      minutesRemaining: Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000)),
      isExpired: remaining <= 0
    };
  }, [getRemainingTime]);

  return {
    isAuthenticated,
    authenticatedUser,
    login,
    loginWithCredentials,
    loginWithPin,
    logout,
    getRemainingTime,
    getSessionInfo,
    authVersion: forceUpdate
  };
}
