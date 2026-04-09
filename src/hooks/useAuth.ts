import { useState, useEffect, useCallback } from 'react';
import { UserRole, AppUser, UserPermissions } from '../types';
import { StorageManager } from '../utils/storage';
import { supabase } from '@/integrations/supabase/client';
import { useUserAuth } from './useUserAuth';

// Create a custom event for auth state changes
const AUTH_CHANGE_EVENT = 'auth-state-change';

// Global auth state manager
class AuthStateManager {
  private listeners: Set<() => void> = new Set();
  
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notify() {
    this.listeners.forEach(listener => listener());
    // Also dispatch a custom event for cross-component communication
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
  }
}

const authStateManager = new AuthStateManager();

export function useAuth() {
  const [role, setRole] = useState<UserRole>(() => StorageManager.getRole());
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserPermissions | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const { authenticatedUser } = useUserAuth();
  const { logout: userLogout } = useUserAuth();

  // Force re-render function
  const triggerUpdate = useCallback(() => {
    setForceUpdate(prev => prev + 1);
  }, []);

  // Listen for auth state changes from the global manager
  useEffect(() => {
    const unsubscribe = authStateManager.subscribe(() => {
      const newRole = StorageManager.getRole();
      setRole(newRole);
      triggerUpdate();
    });

    return unsubscribe;
  }, [triggerUpdate]);

  // Listen for custom auth events
  useEffect(() => {
    const handleAuthChange = () => {
      const newRole = StorageManager.getRole();
      setRole(newRole);
      triggerUpdate();
    };

    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
  }, [triggerUpdate]);

  // Listen for localStorage changes (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'inventory_role') {
        const newRole = (e.newValue as UserRole) || 'sales';
        setRole(newRole);
        triggerUpdate();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [triggerUpdate]);

  // Load user data and permissions
  const loadUserData = useCallback(async (user: AppUser) => {
    setCurrentUser(user);
    
    const permissions: UserPermissions = {
      canCreateQuote: user.can_create_quote,
      allowedStockLocations: user.allowed_stock_locations,
      priceDisplayType: user.price_display_type,
      isAdmin: user.is_admin,
      allowedBrands: user.allowed_brands || []
    };
    
    setUserPermissions(permissions);
    
    // Update role for backward compatibility
    const newRole = user.is_admin ? 'admin' : 'sales';
    console.log('loadUserData - Setting role based on user.is_admin:', {
      username: user.username,
      is_admin: user.is_admin,
      newRole: newRole,
      currentRole: role
    });
    setRole(newRole);
    StorageManager.setRole(newRole);
    
    // Store user info in localStorage for persistence
    localStorage.setItem('inventory_current_user', JSON.stringify(user));
    localStorage.setItem('inventory_user_permissions', JSON.stringify(permissions));
    
    console.log('User data loaded - Final state:', {
      username: user.username,
      is_admin: user.is_admin,
      role: newRole,
      permissions: permissions
    });
    
    // Force a re-render to ensure UI updates
    triggerUpdate();
  }, []);

  // Sync with useUserAuth - if user is authenticated there but not here, sync the data
  useEffect(() => {
    if (authenticatedUser && !currentUser) {
      console.log('Syncing authenticated user from useUserAuth to useAuth:', {
        username: authenticatedUser.username,
        is_admin: authenticatedUser.is_admin
      });
      
      // Load the user data into the admin auth system
      loadUserData(authenticatedUser);
    }
  }, [authenticatedUser, currentUser, loadUserData]);

  // Load persisted user data on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('inventory_current_user');
    const storedPermissions = localStorage.getItem('inventory_user_permissions');
    
    if (storedUser && storedPermissions) {
      try {
        const user = JSON.parse(storedUser);
        const permissions = JSON.parse(storedPermissions);
        setCurrentUser(user);
        setUserPermissions(permissions);
        
        // Ensure role state is correctly set based on loaded user's admin status
        const newRole = user.is_admin ? 'admin' : 'sales';
        setRole(newRole);
        StorageManager.setRole(newRole);
        
        console.log('Loaded persisted user data:', {
          username: user.username,
          is_admin: user.is_admin,
          role: newRole
        });
      } catch (error) {
        console.error('Failed to parse stored user data:', error);
        // Clear corrupted data
        localStorage.removeItem('inventory_current_user');
        localStorage.removeItem('inventory_user_permissions');
        // Reset role to default
        setRole('sales');
        StorageManager.setRole('sales');
      }
    }
  }, []);

  const login = useCallback(async (pin: string): Promise<boolean> => {
    try {
      // Try to authenticate via edge function (PIN only)
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify-pin-only', pin }
      });

      if (!error && data?.success) {
        const user = data.user as AppUser;
        await loadUserData(user);
        authStateManager.notify();
        return true;
      }

      // Fallback: old admin PIN
      const storedPin = StorageManager.getAdminPin();
      if (storedPin && pin === storedPin) {
        const tempAdminUser: AppUser = {
          id: 'temp-admin',
          username: 'admin',
          pin: '',
          is_admin: true,
          can_create_quote: true,
          allowed_stock_locations: [],
          allowed_brands: [],
          price_display_type: 'normal',
          created_at: new Date(),
          updated_at: new Date()
        };
        await loadUserData(tempAdminUser);
        authStateManager.notify();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }, [loadUserData]);

  const loginWithUsername = useCallback(async (username: string, pin: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify', username, pin }
      });

      if (!error && data?.success) {
        const user = data.user as AppUser;
        await loadUserData(user);
        authStateManager.notify();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Username login failed:', error);
      return false;
    }
  }, [loadUserData]);

  const logout = useCallback(() => {
    userLogout();
    
    setRole('sales');
    setCurrentUser(null);
    setUserPermissions(null);
    StorageManager.setRole('sales');
    
    // Clear stored user data
    localStorage.removeItem('inventory_current_user');
    localStorage.removeItem('inventory_user_permissions');
    
    console.log('User logged out, role reset to sales');
    
    // Notify all components about the auth state change
    authStateManager.notify();
  }, [userLogout]);

  // Permission helper functions
  const canCreateQuote = useCallback((): boolean => {
    return userPermissions?.canCreateQuote ?? true;
  }, [userPermissions]);

  const canAccessStockLocation = useCallback((location: string): boolean => {
    if (!userPermissions || userPermissions.allowedStockLocations.length === 0) {
      return true; // No restrictions
    }
    return userPermissions.allowedStockLocations.includes(location);
  }, [userPermissions]);

  const canAccessBrand = useCallback((brand: string): boolean => {
    if (!userPermissions || !userPermissions.allowedBrands || userPermissions.allowedBrands.length === 0) {
      return true; // No restrictions
    }
    return userPermissions.allowedBrands.includes(brand);
  }, [userPermissions]);

  const getPriceDisplayType = useCallback((): 'normal' | 'reseller' | 'buy' | 'calculated' => {
    return userPermissions?.priceDisplayType ?? 'normal';
  }, [userPermissions]);

  const getDisplayPrice = useCallback((product: any): number => {
    const priceType = getPriceDisplayType();
    switch (priceType) {
      case 'reseller':
        return product.reseller_price || product.price;
      case 'buy':
        return product.buyprice || product.price;
      case 'calculated':
        // For calculated, we'd need margin percentage - default to normal for now
        return product.price;
      case 'normal':
      default:
        return product.price;
    }
  }, [getPriceDisplayType]);

  const isAdmin = role === 'admin';

  return {
    role,
    currentUser,
    userPermissions,
    isAdmin,
    login,
    loginWithUsername,
    logout,
    canCreateQuote,
    canAccessStockLocation,
    canAccessBrand,
    getPriceDisplayType,
    getDisplayPrice,
    // Expose the force update counter for components that need to react to auth changes
    authVersion: forceUpdate
  };
}