import { useCallback, useEffect, useRef, useState } from 'react';
import { StockService } from '../../utils/supabaseStock';
import { CompanySettingsService, type CompanySettings } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { dayEndInstant, type ValuationMovement, type ValuationProduct } from '../lib/stockValuation';

interface Loaded { since: number; rows: ValuationMovement[] }

/**
 * What the stock at `day` is computed from: the products (current levels and
 * average costs), the movements recorded after that day, and the company
 * (identifiers for the exports, VAT rate for the value excluding VAT).
 *
 * Products and company are read once. Movements are read once per earlier
 * date: going back to a later date reuses the rows already loaded (the
 * statement keeps only those after its date), so switching between dates
 * does not read the database again.
 */
export function useStockAtDate(day: string | null) {
  const [products, setProducts] = useState<ValuationProduct[] | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [movements, setMovements] = useState<ValuationMovement[] | null>(null);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  // Nothing is read until there is a date (the Clôture page waits for its year).
  const active = !!day;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const { companyId } = getCompanyContext();
    Promise.all([
      StockService.getProducts(),
      CompanySettingsService.getSettings(companyId || undefined).catch(() => null),
    ]).then(([p, s]) => {
      if (cancelled) return;
      setProducts(p as unknown as ValuationProduct[]);
      setSettings(s);
    }).catch(e => { if (!cancelled) setError((e as Error)?.message || 'Lecture du stock impossible'); });
    return () => { cancelled = true; };
  }, [version, active]);

  useEffect(() => {
    if (!day) return;
    const since = dayEndInstant(day);
    if (loaded.current && loaded.current.since <= since) { setMovements(loaded.current.rows); setLoadingMovements(false); return; }
    let cancelled = false;
    setLoadingMovements(true);
    StockService.getMovementsSince(new Date(since).toISOString())
      .then(rows => {
        if (cancelled) return;
        loaded.current = { since, rows: rows as ValuationMovement[] };
        setMovements(loaded.current.rows);
      })
      .catch(e => { if (!cancelled) setError((e as Error)?.message || 'Lecture des mouvements impossible'); })
      .finally(() => { if (!cancelled) setLoadingMovements(false); });
    return () => { cancelled = true; };
  }, [day, version]);

  const reload = useCallback(() => { loaded.current = null; setError(null); setProducts(null); setMovements(null); setVersion(v => v + 1); }, []);

  const vatRate = Number.isFinite(Number(settings?.tva_rate)) && settings?.tva_rate != null ? Number(settings.tva_rate) : 20;
  return {
    products, movements, settings, vatRate, error, reload,
    loading: !error && (products === null || movements === null || loadingMovements),
  };
}
