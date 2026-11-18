import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The Supabase session (opened by verify-pin at PIN login) lives next to the
// Stocky session: in localStorage with "remember me", else in sessionStorage so
// it ends with the tab. Reads fall back to the other store and removals clear
// both, so a sign-out always finds and removes it.
const APP_USER_KEY = 'inventory_authenticated_user';   // see utils/session.ts

const preferredStore = (): Storage => {
  try { return localStorage.getItem(APP_USER_KEY) ? localStorage : sessionStorage; } catch { return localStorage; }
};
const otherStore = (store: Storage): Storage => (store === localStorage ? sessionStorage : localStorage);

export const authStorage = {
  getItem(key: string): string | null {
    try {
      const store = preferredStore();
      return store.getItem(key) ?? otherStore(store).getItem(key);
    } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try {
      const store = preferredStore();
      store.setItem(key, value);
      otherStore(store).removeItem(key);
    } catch { /* storage full or blocked */ }
  },
  removeItem(key: string): void {
    try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* */ }
  },
};

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  }
});
