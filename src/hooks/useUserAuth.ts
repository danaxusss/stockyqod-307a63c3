import { useState, useEffect, useCallback } from 'react';
import { AppUser } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { ActivityLogger } from '../utils/activityLogger';
import { setLastAuthError, rateLimitMessage } from '../utils/authError';
import {
  saveSession, readSession, clearSession, validateSession,
  hasLocallyValidSession, touchSession, remainingMs,
} from '../utils/session';

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

// A session now exists only if a server-signed token is present and neither
// its expiry nor the idle timeout has passed. The old scheme trusted an
// `authenticated=true` flag plus a timestamp, both of which the user could
// simply write in devtools.
function checkAuthenticationStatus(): boolean {
  return hasLocallyValidSession();
}

export function useUserAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => checkAuthenticationStatus());
  const [authenticatedUser, setAuthenticatedUser] = useState<AppUser | null>(() => readSession()?.user ?? null);
  const [forceUpdate, setForceUpdate] = useState(0);

  const triggerUpdate = useCallback(() => {
    setForceUpdate(prev => prev + 1);
  }, []);

  useEffect(() => {
    const unsubscribe = userAuthStateManager.subscribe(() => {
      setIsAuthenticated(checkAuthenticationStatus());
      setAuthenticatedUser(readSession()?.user ?? null);
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
    // Keeps tabs in sync: logging out in one tab logs out the others.
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith('stocky_session') || e.key === 'inventory_authenticated_user') {
        setIsAuthenticated(checkAuthenticationStatus());
        setAuthenticatedUser(readSession()?.user ?? null);
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

  // Confirm with the server that the stored token is genuine and still valid,
  // and refresh the cached user so revoked rights apply immediately. Runs once
  // on mount and then hourly.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!readSession()) return;
      const fresh = await validateSession();
      if (cancelled) return;
      if (!fresh) {
        setIsAuthenticated(false);
        setAuthenticatedUser(null);
        userAuthStateManager.notify();
      } else {
        setAuthenticatedUser(fresh);
      }
    };
    check();
    const id = setInterval(check, 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Activity refreshes the idle clock.
  useEffect(() => {
    const onActivity = () => touchSession();
    const events: (keyof WindowEventMap)[] = ['click', 'keydown', 'focus'];
    events.forEach(e => window.addEventListener(e, onActivity));
    document.addEventListener('visibilitychange', onActivity);
    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, []);

  const applyLogin = useCallback((data: any, rememberMe: boolean): AppUser => {
    const user = data.user as AppUser;
    if (!data.session_token) {
      // The server verified the PIN but is running a build without session
      // tokens. Log in anyway rather than lock the user out; deploying
      // verify-pin restores signed sessions automatically.
      console.warn(
        '[auth] verify-pin returned no session_token — the Edge Function is out of date. ' +
        'Run: supabase functions deploy verify-pin'
      );
    }
    saveSession(data.session_token ?? null, user, data.expires_at, rememberMe);
    setIsAuthenticated(true);
    setAuthenticatedUser(user);
    userAuthStateManager.notify();
    return user;
  }, []);

  const loginWithCredentials = useCallback(async (username: string, pin: string, rememberMe = false): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify', username, pin, remember_me: rememberMe }
      });
      if (error) { setLastAuthError(await rateLimitMessage(error)); return false; }
      if (!data?.success) { setLastAuthError(null); return false; }
      const user = applyLogin(data, rememberMe);
      ActivityLogger.log('login', `User ${user.username} logged in`);
      return true;
    } catch (error) {
      console.error('Login with credentials failed:', error);
      return false;
    }
  }, [applyLogin]);

  const loginWithPin = useCallback(async (pin: string, rememberMe = false): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { action: 'verify-pin-only', pin, remember_me: rememberMe }
      });
      if (error) { setLastAuthError(await rateLimitMessage(error)); return false; }
      if (!data?.success) { setLastAuthError(null); return false; }
      applyLogin(data, rememberMe);
      return true;
    } catch (error) {
      console.error('PIN login failed:', error);
      return false;
    }
  }, [applyLogin]);

  const logout = useCallback((): void => {
    ActivityLogger.log('logout', 'User logged out');
    clearSession();
    setIsAuthenticated(false);
    setAuthenticatedUser(null);
    userAuthStateManager.notify();
  }, []);

  const getRemainingTime = useCallback((): number => remainingMs(), []);

  const getSessionInfo = useCallback(() => {
    const s = readSession();
    if (!s) return null;
    const remaining = remainingMs();
    return {
      loginTime: new Date(s.expiresAt * 1000 - (s.remembered ? 30 * 24 : 12) * 60 * 60 * 1000),
      remainingTime: remaining,
      hoursRemaining: Math.floor(remaining / (60 * 60 * 1000)),
      minutesRemaining: Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000)),
      isExpired: remaining <= 0,
      remembered: s.remembered,
    };
  }, []);

  return {
    isAuthenticated,
    authenticatedUser,
    loginWithCredentials,
    loginWithPin,
    logout,
    getRemainingTime,
    getSessionInfo,
    authVersion: forceUpdate
  };
}
