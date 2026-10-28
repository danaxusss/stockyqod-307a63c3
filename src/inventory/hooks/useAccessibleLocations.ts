import { useEffect, useState, useCallback, useMemo } from 'react';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { useAuth } from '../../hooks/useAuth';
import type { StockLocation } from '../../types';

/**
 * Scopes inventory views to the locations the current user may see:
 *  - super_admin / facturation (bypassFilter) → everything.
 *  - otherwise → the user's company locations (getStockLocations is already
 *    company-scoped) intersected with their allowed_stock_locations.
 * Safety valve: if the company has no configured locations, we don't black out
 * the view — we fall back to allowed_stock_locations only.
 *
 * This is how multi-branch separation is enforced without making products
 * per-company: stock lives at company-scoped locations, and every page filters
 * its stock_levels keys through keyAllowed().
 */
export function useAccessibleLocations() {
  const { canAccessStockLocation } = useAuth();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    StockLocationsService.getStockLocations()
      .then(setLocations).catch(() => setFailed(true)).finally(() => setLoading(false));
  }, []);

  const { bypassFilter } = getCompanyContext();

  const companyTokens = useMemo(() => {
    const s = new Set<string>();
    locations.forEach(l => {
      [l.abbreviation, l.name, l.name?.toLowerCase().replace(/\s+/g, '_')].forEach(t => {
        if (t) s.add(t.toLowerCase());
      });
    });
    return s;
  }, [locations]);

  const keyAllowed = useCallback((key: string): boolean => {
    if (!canAccessStockLocation(key)) return false;
    if (bypassFilter) return true;
    // Until the company's locations are known (or if they could not be read),
    // show nothing rather than every company's stock.
    if (loading || failed) return false;
    if (companyTokens.size === 0) return true; // no locations configured → don't hide
    const k = key.toLowerCase();
    return companyTokens.has(k) || companyTokens.has(k.replace(/\s+/g, '_'));
  }, [canAccessStockLocation, bypassFilter, companyTokens, loading, failed]);

  const filterLevels = useCallback((levels: Record<string, number> | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    Object.entries(levels || {}).forEach(([k, v]) => { if (keyAllowed(k)) out[k] = v; });
    return out;
  }, [keyAllowed]);

  /** Locations this user may count, receive into or transfer between. */
  const accessibleLocations = useMemo(
    () => locations.filter(l => keyAllowed(l.abbreviation || l.name) || keyAllowed(l.name)),
    [locations, keyAllowed],
  );

  return { locations, accessibleLocations, loading, failed, keyAllowed, filterLevels, bypassFilter };
}
