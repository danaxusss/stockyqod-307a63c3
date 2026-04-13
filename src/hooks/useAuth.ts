import { useState, useEffect, useCallback } from 'react';
import { UserRole, AppUser, UserPermissions } from '../types';
import { StorageManager } from '../utils/storage';
import { authApi } from '@/lib/apiClient';
import { useUserAuth } from './useUserAuth';

const AUTH_CHANGE_EVENT = 'auth-state-change';

class AuthStateManager {
  private listeners: Set<() => void> = new Set();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { this.listeners.forEach(l => l()); window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT)); }
}

const authStateManager = new AuthStateManager();

export function useAuth() {
  const [role, setRole] = useState<UserRole>(() => StorageManager.getRole());
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [userPermissions, setUserPermissions] = useState<UserPermissions | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const { authenticatedUser } = useUserAuth();
  const { logout: userLogout } = useUserAuth();

  const triggerUpdate = useCallback(() => setForceUpdate(p => p + 1), []);

  useEffect(() => {
    const unsub = authStateManager.subscribe(() => { setRole(StorageManager.getRole()); triggerUpdate(); });
    return unsub;
  }, [triggerUpdate]);

  useEffect(() => {
    const handle = () => { setRole(StorageManager.getRole()); triggerUpdate(); };
    window.addEventListener(AUTH_CHANGE_EVENT, handle);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, handle);
  }, [triggerUpdate]);

  useEffect(() => {
    const handle = (e: StorageEvent) => {
      if (e.key === 'inventory_role') { setRole((e.newValue as UserRole) || 'sales'); triggerUpdate(); }
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, [triggerUpdate]);

  const loadUserData = useCallback(async (user: AppUser) => {
    setCurrentUser(user);
    const permissions: UserPermissions = {
      canCreateQuote: user.can_create_quote,
      allowedStockLocations: user.allowed_stock_locations,
      priceDisplayType: user.price_display_type,
      isAdmin: user.is_admin,
      allowedBrands: user.allowed_brands || [],
    };
    setUserPermissions(permissions);
    const newRole: UserRole = user.is_admin ? 'admin' : 'sales';
    setRole(newRole);
    StorageManager.setRole(newRole);
    localStorage.setItem('inventory_current_user', JSON.stringify(user));
    localStorage.setItem('inventory_user_permissions', JSON.stringify(permissions));
    triggerUpdate();
  }, [triggerUpdate]);

  useEffect(() => {
    if (authenticatedUser && !currentUser) loadUserData(authenticatedUser);
  }, [authenticatedUser, currentUser, loadUserData]);

  useEffect(() => {
    const stored = localStorage.getItem('inventory_current_user');
    const storedPerms = localStorage.getItem('inventory_user_permissions');
    if (stored && storedPerms) {
      try {
        const user = JSON.parse(stored);
        const permissions = JSON.parse(storedPerms);
        setCurrentUser(user);
        setUserPermissions(permissions);
        const newRole: UserRole = user.is_admin ? 'admin' : 'sales';
        setRole(newRole);
        StorageManager.setRole(newRole);
      } catch {
        localStorage.removeItem('inventory_current_user');
        localStorage.removeItem('inventory_user_permissions');
        setRole('sales');
        StorageManager.setRole('sales');
      }
    }
  }, []);

  // Admin PIN-only re-authentication (for admin modal)
  const login = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const stored = localStorage.getItem('inventory_authenticated_user');
      const username = stored ? JSON.parse(stored)?.username : undefined;
      const data = await authApi.loginByPin(pin, username);
      if (data.success) {
        const user = data.user as unknown as AppUser;
        if (user.is_admin) sessionStorage.setItem('inventory_admin_pin', pin);
        await loadUserData(user);
        authStateManager.notify();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Admin login failed:', error);
      return false;
    }
  }, [loadUserData]);

  const loginWithUsername = useCallback(async (username: string, pin: string): Promise<boolean> => {
    try {
      const data = await authApi.login(username, pin);
      if (data.success) {
        const user = data.user as unknown as AppUser;
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
    localStorage.removeItem('inventory_current_user');
    localStorage.removeItem('inventory_user_permissions');
    authStateManager.notify();
  }, [userLogout]);

  const canCreateQuote = useCallback(() => userPermissions?.canCreateQuote ?? true, [userPermissions]);
  const canAccessStockLocation = useCallback((location: string) => !userPermissions?.allowedStockLocations?.length || userPermissions.allowedStockLocations.includes(location), [userPermissions]);
  const canAccessBrand = useCallback((brand: string) => !userPermissions?.allowedBrands?.length || userPermissions.allowedBrands.includes(brand), [userPermissions]);
  const getPriceDisplayType = useCallback(() => userPermissions?.priceDisplayType ?? 'normal', [userPermissions]);
  const getDisplayPrice = useCallback((product: Record<string, number>) => {
    switch (getPriceDisplayType()) {
      case 'reseller': return product.reseller_price || product.price;
      case 'buy': return product.buyprice || product.price;
      default: return product.price;
    }
  }, [getPriceDisplayType]);

  return {
    role, currentUser, userPermissions, isAdmin: role === 'admin',
    login, loginWithUsername, logout,
    canCreateQuote, canAccessStockLocation, canAccessBrand,
    getPriceDisplayType, getDisplayPrice,
    authVersion: forceUpdate,
  };
}
