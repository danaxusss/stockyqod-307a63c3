import { useState, useEffect, useCallback } from 'react';
import { UserRole, AppUser, UserPermissions } from '../types';
import { StorageManager } from '../utils/storage';
import { supabase } from '@/integrations/supabase/client';
import { useUserAuth } from './useUserAuth';
import { setCompanyContext } from '../utils/supabaseCompanyFilter';
import { setLastAuthError, rateLimitMessage } from '../utils/authError';
import { saveSession } from '../utils/session';
import { SupabaseCompaniesService } from '../utils/supabaseCompanies';
import { deriveRoleFlags } from '../lib/permissions';

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
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [authReady, setAuthReady] = useState(false);
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

    return () => { unsubscribe(); };
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

    const companyId = user.company_id || null;
    const appRole = user.new_role ?? null;
    const crossBranchRead = user.cross_branch_read ?? false;

    // Tasks/Delivery module access: super_admin gets full access implicitly;
    // everyone else needs a tasks_role assigned by the super admin.
    // tasks_only marks standalone field staff with no main-app access.
    const tasksRole = user.is_superadmin ? 'super_admin' : (user.tasks_role ?? null);
    const isTasks = !!tasksRole;
    const isTasksOnly = user.tasks_only === true;

    // Derive backward-compat flags from new_role; fall back to legacy booleans during transition
    const flags = appRole
      ? deriveRoleFlags(appRole)
      : {
          isSuperAdmin:  user.is_superadmin || false,
          isAdmin:       user.is_admin || user.is_superadmin || false,
          isFacturation: false,
          isCompta:      user.is_compta || false,
          isManager:     false,
          isSeniorSales: false,
          isJuniorSales: false,
          isPaie:        user.is_superadmin || user.is_admin || user.is_compta || false,
        };

    // The is_superadmin / is_admin boolean columns are authoritative — a stale or
    // mismatched new_role must never strip admin access. Setting is_superadmin in
    // the DB (then re-login) always grants full access.
    if (user.is_superadmin) { flags.isSuperAdmin = true; flags.isAdmin = true; flags.isPaie = true; }
    if (user.is_admin) { flags.isAdmin = true; flags.isPaie = true; }

    const permissions: UserPermissions = {
      canCreateQuote: user.can_create_quote,
      allowedStockLocations: user.allowed_stock_locations,
      priceDisplayType: user.price_display_type,
      isAdmin: flags.isAdmin,
      isSuperAdmin: flags.isSuperAdmin,
      isFacturation: flags.isFacturation,
      isCompta: flags.isCompta,
      isManager: flags.isManager,
      isSeniorSales: flags.isSeniorSales,
      isJuniorSales: flags.isJuniorSales,
      isPaie: flags.isPaie,
      isTasks,
      isTasksOnly,
      tasksRole,
      crossBranchRead,
      newRole: appRole,
      companyId,
      allowedBrands: user.allowed_brands || []
    };

    setUserPermissions(permissions);

    // Update the global company filter singleton
    setCompanyContext(companyId, appRole, crossBranchRead);

    // Load company name if user has a company
    if (companyId) {
      SupabaseCompaniesService.getCompanyById(companyId)
        .then(company => setCompanyName(company?.name || null))
        .catch(() => setCompanyName(null));
    }

    // Update role for backward compatibility
    const legacyRole: UserRole = flags.isAdmin ? 'admin' : 'sales';
    setRole(legacyRole);
    StorageManager.setRole(legacyRole);

    // Store user info in localStorage for persistence
    localStorage.setItem('inventory_current_user', JSON.stringify(user));
    localStorage.setItem('inventory_user_permissions', JSON.stringify(permissions));

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

        // Recompute flags that may be missing from older cached permissions
        const appRole = user.new_role ?? null;
        const freshFlags = appRole ? deriveRoleFlags(appRole) : null;
        const restoredTasksRole = user.is_superadmin ? 'super_admin' : (user.tasks_role ?? null);
        const restoredTasksOnly = user.tasks_only === true;
        const recomputedPermissions: UserPermissions = {
          ...permissions,
          isPaie: permissions.isPaie ??
            (freshFlags?.isPaie ?? (user.is_superadmin || user.is_admin || user.is_compta || false)),
          tasksRole: permissions.tasksRole ?? restoredTasksRole,
          isTasks: permissions.isTasks ?? !!restoredTasksRole,
          isTasksOnly: permissions.isTasksOnly ?? restoredTasksOnly,
        };
        // Boolean columns are authoritative — never let a stale cached blob hide
        // admin access on reload.
        if (user.is_superadmin) { recomputedPermissions.isSuperAdmin = true; recomputedPermissions.isAdmin = true; recomputedPermissions.isPaie = true; }
        if (user.is_admin) { recomputedPermissions.isAdmin = true; recomputedPermissions.isPaie = true; }
        setUserPermissions(recomputedPermissions);

        // Restore company context singleton from persisted data
        const restoredCompanyId = user.company_id || null;
        const restoredRole = user.new_role ?? null;
        const restoredCrossBranch = user.cross_branch_read ?? false;
        setCompanyContext(restoredCompanyId, restoredRole, restoredCrossBranch);
        if (restoredCompanyId) {
          SupabaseCompaniesService.getCompanyById(restoredCompanyId)
            .then(company => setCompanyName(company?.name || null))
            .catch(() => {});
        }

        // Persist the recomputed permissions so future restores are up to date
        localStorage.setItem('inventory_user_permissions', JSON.stringify(recomputedPermissions));

        // Ensure role state is correctly set based on loaded permissions
        const restoredLegacyRole: UserRole = (recomputedPermissions.isAdmin) ? 'admin' : 'sales';
        setRole(restoredLegacyRole);
        StorageManager.setRole(restoredLegacyRole);
      } catch (error) {
        console.error('Failed to parse stored user data:', error);
        localStorage.removeItem('inventory_current_user');
        localStorage.removeItem('inventory_user_permissions');
        setRole('sales');
        StorageManager.setRole('sales');
      }
    }
    // Auth is now ready regardless — guards can now make decisions
    setAuthReady(true);
  }, []);

  const login = useCallback(async (pin: string, rememberMe = false): Promise<boolean> => {
    try {
      // Authentication happens server-side only. The previous local fallback
      // ("if the typed PIN matches the one cached in localStorage, grant
      // admin") was a full authentication bypass: anyone could write that key
      // from devtools and log in as admin. It is deliberately gone.
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify-pin-only', pin, remember_me: rememberMe }
      });

      if (error) setLastAuthError(await rateLimitMessage(error));

      if (!error && data?.success) {
        const user = data.user as AppUser;
        if (!data.session_token) {
          console.warn(
            '[auth] verify-pin returned no session_token — the Edge Function is out of date. ' +
            'Run: supabase functions deploy verify-pin'
          );
        }
        saveSession(data.session_token ?? null, user, data.expires_at, rememberMe);
        await loadUserData(user);
        authStateManager.notify();
        return true;
      }

      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }, [loadUserData]);

  const loginWithUsername = useCallback(async (username: string, pin: string, rememberMe = false): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify', username, pin, remember_me: rememberMe }
      });

      if (error) setLastAuthError(await rateLimitMessage(error));

      if (!error && data?.success) {
        const user = data.user as AppUser;
        if (!data.session_token) {
          console.warn(
            '[auth] verify-pin returned no session_token — the Edge Function is out of date. ' +
            'Run: supabase functions deploy verify-pin'
          );
        }
        saveSession(data.session_token ?? null, user, data.expires_at, rememberMe);
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
    setCompanyName(null);
    setCompanyContext(null, null, false);
    StorageManager.setRole('sales');
    
    // Clear stored user data
    localStorage.removeItem('inventory_current_user');
    localStorage.removeItem('inventory_user_permissions');
    localStorage.removeItem('inventory_authenticated_user');
    
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
  const isSuperAdmin = userPermissions?.isSuperAdmin ?? false;
  const isFacturation = userPermissions?.isFacturation ?? false;
  const isCompta = userPermissions?.isCompta ?? false;
  const isManager = userPermissions?.isManager ?? false;
  const isSeniorSales = userPermissions?.isSeniorSales ?? false;
  const isJuniorSales = userPermissions?.isJuniorSales ?? false;
  const isPaie = userPermissions?.isPaie ?? false;
  // Stock management: super_admin, admin and managers.
  const isStock = isSuperAdmin || isAdmin || isManager;
  const isTasks = userPermissions?.isTasks ?? false;
  const isTasksOnly = userPermissions?.isTasksOnly ?? false;
  const tasksRole = userPermissions?.tasksRole ?? null;
  const crossBranchRead = userPermissions?.crossBranchRead ?? false;
  const newRole = userPermissions?.newRole ?? null;
  const companyId = userPermissions?.companyId ?? null;

  return {
    role,
    currentUser,
    userPermissions,
    isAdmin,
    isSuperAdmin,
    isFacturation,
    isCompta,
    isManager,
    isSeniorSales,
    isJuniorSales,
    isPaie,
    isStock,
    isTasks,
    isTasksOnly,
    tasksRole,
    crossBranchRead,
    newRole,
    companyId,
    companyName,
    authReady,
    login,
    loginWithUsername,
    logout,
    canCreateQuote,
    canAccessStockLocation,
    canAccessBrand,
    getPriceDisplayType,
    getDisplayPrice,
    authVersion: forceUpdate
  };
}