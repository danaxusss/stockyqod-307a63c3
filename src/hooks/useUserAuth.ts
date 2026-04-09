import { useState, useEffect, useCallback } from 'react';
import { AppUser } from '../types';
import { SupabaseUsersService } from '../utils/supabaseUsers';

const AUTH_STORAGE_KEY = 'inventory_user_authenticated';
const AUTH_TIME_KEY = 'inventory_user_auth_time';
const USER_DATA_KEY = 'inventory_authenticated_user';
const AUTH_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Create a custom event for auth state changes
const USER_AUTH_CHANGE_EVENT = 'user-auth-state-change';

// Global auth state manager
class UserAuthStateManager {
  private listeners: Set<() => void> = new Set();
  
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notify() {
    this.listeners.forEach(listener => listener());
    // Also dispatch a custom event for cross-component communication
    window.dispatchEvent(new CustomEvent(USER_AUTH_CHANGE_EVENT));
  }
}

const userAuthStateManager = new UserAuthStateManager();

export function useUserAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return checkAuthenticationStatus();
  });
  const [authenticatedUser, setAuthenticatedUser] = useState<AppUser | null>(() => {
    const stored = localStorage.getItem(USER_DATA_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [forceUpdate, setForceUpdate] = useState(0);

  // Force re-render function
  const triggerUpdate = useCallback(() => {
    setForceUpdate(prev => prev + 1);
  }, []);

  // Check if user is authenticated and session is still valid
  function checkAuthenticationStatus(): boolean {
    try {
      const isAuth = localStorage.getItem(AUTH_STORAGE_KEY) === 'true';
      const authTime = localStorage.getItem(AUTH_TIME_KEY);
      
      if (!isAuth || !authTime) {
        return false;
      }

      const authTimestamp = parseInt(authTime);
      const now = Date.now();
      
      // Check if session has expired
      if (now - authTimestamp > AUTH_DURATION) {
        // Session expired, clear auth
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_TIME_KEY);
        localStorage.removeItem(USER_DATA_KEY);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking authentication status:', error);
      return false;
    }
  }

  // Listen for auth state changes from the global manager
  useEffect(() => {
    const unsubscribe = userAuthStateManager.subscribe(() => {
      const newAuthStatus = checkAuthenticationStatus();
      setIsAuthenticated(newAuthStatus);
      triggerUpdate();
    });

    return unsubscribe;
  }, [triggerUpdate]);

  // Listen for custom auth events
  useEffect(() => {
    const handleAuthChange = () => {
      const newAuthStatus = checkAuthenticationStatus();
      setIsAuthenticated(newAuthStatus);
      triggerUpdate();
    };

    window.addEventListener(USER_AUTH_CHANGE_EVENT, handleAuthChange);
    return () => window.removeEventListener(USER_AUTH_CHANGE_EVENT, handleAuthChange);
  }, [triggerUpdate]);

  // Listen for localStorage changes (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY || e.key === AUTH_TIME_KEY || e.key === USER_DATA_KEY) {
        const newAuthStatus = checkAuthenticationStatus();
        setIsAuthenticated(newAuthStatus);
        
        // Update user data
        const storedUser = localStorage.getItem(USER_DATA_KEY);
        if (storedUser) {
          try {
            setAuthenticatedUser(JSON.parse(storedUser));
          } catch {
            setAuthenticatedUser(null);
          }
        } else {
          setAuthenticatedUser(null);
        }
        
        triggerUpdate();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [triggerUpdate]);

  // Periodic check for session expiration
  useEffect(() => {
    const interval = setInterval(() => {
      const currentAuthStatus = checkAuthenticationStatus();
      if (currentAuthStatus !== isAuthenticated) {
        setIsAuthenticated(currentAuthStatus);
        userAuthStateManager.notify();
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Original PIN-only login (for backward compatibility)
  const login = useCallback(async (): Promise<void> => {
    localStorage.setItem(AUTH_STORAGE_KEY, 'true');
    localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
    setIsAuthenticated(true);
    
    // Notify all components about the auth state change
    userAuthStateManager.notify();
  });

  // New username/PIN login
  const loginWithCredentials = useCallback(async (username: string, pin: string): Promise<boolean> => {
    try {
      const user = await SupabaseUsersService.authenticateUser(username, pin);
      if (user) {
        localStorage.setItem(AUTH_STORAGE_KEY, 'true');
        localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
        localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
        
        setIsAuthenticated(true);
        setAuthenticatedUser(user);
        
        userAuthStateManager.notify();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login with credentials failed:', error);
      return false;
    }
  }, []);

  // PIN-only login (tries to find user by PIN)
  const loginWithPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      // For backward compatibility, try the hardcoded user PIN first
      if (pin === '100300') {
        // Try to find the default user
        try {
          const user = await SupabaseUsersService.getUserByUsername('user');
          if (user && user.pin === pin) {
            localStorage.setItem(AUTH_STORAGE_KEY, 'true');
            localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
            localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
            
            setIsAuthenticated(true);
            setAuthenticatedUser(user);
            
            userAuthStateManager.notify();
            return true;
          }
        } catch (error) {
          console.warn('Failed to authenticate with user system:', error);
        }
        
        // Fallback to old system
        localStorage.setItem(AUTH_STORAGE_KEY, 'true');
        localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
        setIsAuthenticated(true);
        userAuthStateManager.notify();
        return true;
      }

      // Try to find any user with this PIN (not ideal for production)
      try {
        const allUsers = await SupabaseUsersService.getAllUsers();
        const user = allUsers.find(u => u.pin === pin);
        
        if (user) {
          localStorage.setItem(AUTH_STORAGE_KEY, 'true');
          localStorage.setItem(AUTH_TIME_KEY, Date.now().toString());
          localStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
          
          setIsAuthenticated(true);
          setAuthenticatedUser(user);
          
          userAuthStateManager.notify();
          return true;
        }
      } catch (error) {
        console.warn('Failed to authenticate with new user system:', error);
      }

      return false;
    } catch (error) {
      console.error('PIN login failed:', error);
      return false;
    }
  }, []);

  const logout = useCallback((): void => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
    localStorage.removeItem(USER_DATA_KEY);
    setIsAuthenticated(false);
    setAuthenticatedUser(null);
    
    // Notify all components about the auth state change
    userAuthStateManager.notify();
  }, []);

  const getRemainingTime = useCallback((): number => {
    const authTime = localStorage.getItem(AUTH_TIME_KEY);
    if (!authTime) return 0;
    
    const authTimestamp = parseInt(authTime);
    const now = Date.now();
    const remaining = AUTH_DURATION - (now - authTimestamp);
    
    return Math.max(0, remaining);
  }, []);

  const getSessionInfo = useCallback(() => {
    const authTime = localStorage.getItem(AUTH_TIME_KEY);
    if (!authTime) return null;
    
    const authTimestamp = parseInt(authTime);
    const remainingTime = getRemainingTime();
    const hoursRemaining = Math.floor(remainingTime / (60 * 60 * 1000));
    const minutesRemaining = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000));
    
    return {
      loginTime: new Date(authTimestamp),
      remainingTime,
      hoursRemaining,
      minutesRemaining,
      isExpired: remainingTime <= 0
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
    // Expose the force update counter for components that need to react to auth changes
    authVersion: forceUpdate
  };
}