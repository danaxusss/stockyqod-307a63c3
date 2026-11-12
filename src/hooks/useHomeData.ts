import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useAccess } from './useAccess';
import { loadHomeData, type HomeData } from '../utils/homeData';

// Shared by the home page and the sidebar badges: one load per user, reused
// for five minutes (or until a page asks for a refresh).
const TTL = 5 * 60_000;
let cache: { key: string; at: number; data: HomeData } | null = null;
let pending: { key: string; promise: Promise<HomeData> } | null = null;
const listeners = new Set<() => void>();

function fetchData(key: string, run: () => Promise<HomeData>, force = false): Promise<HomeData> {
  if (!force && cache?.key === key && Date.now() - cache.at < TTL) return Promise.resolve(cache.data);
  if (!force && pending?.key === key) return pending.promise;
  const promise = run().then(data => {
    cache = { key, at: Date.now(), data };
    listeners.forEach(l => l());
    return data;
  }).finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { key, promise };
  return promise;
}

export function useHomeData(): { data: HomeData | null; loading: boolean; refresh: () => void } {
  const { currentUser } = useAuth();
  const { access } = useAccess();
  const username = currentUser?.username ?? null;
  const sellerName = currentUser?.custom_seller_name?.trim() || null;
  const userId = currentUser?.id ?? null;
  const key = JSON.stringify([username, sellerName, userId, access]);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(cache?.key !== key);

  const run = useCallback(() => loadHomeData({ access, username, sellerName, userId }), [access, username, sellerName, userId]);

  useEffect(() => {
    const listener = () => setTick(t => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!username) return;
    setLoading(cache?.key !== key);
    fetchData(key, run).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, run, username]);

  const refresh = useCallback(() => { fetchData(key, run, true); }, [key, run]);
  return { data: cache?.key === key ? cache.data : null, loading, refresh };
}

/** For tests: forget the cached data. */
export function resetHomeDataCache(): void { cache = null; pending = null; }
