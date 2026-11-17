import type { Product } from '../types';
import { sortSeries } from './kioskSort';

/**
 * A product series as stored: trimmed, without a typed "Série" prefix
 * ("Série 700" → "700"); empty or "Aucune" means no series (null).
 */
export function normalizeSeries(value: string | null | undefined): string | null {
  const cleaned = (value || '').trim().replace(/^s[ée]rie\s*/i, '').trim();
  if (/^(aucune?|sans s[ée]rie|-|—)$/i.test(cleaned)) return null;
  return cleaned ? cleaned.slice(0, 40) : null;
}

/** Series already used, for suggestions: those of `brand` first. */
export function knownSeries(products: Pick<Product, 'brand' | 'series'>[], brand?: string): string[] {
  const ofBrand = products.filter(p => p.series && (!brand || p.brand === brand)).map(p => p.series as string);
  const others = products.filter(p => p.series).map(p => p.series as string);
  return [...new Set([...sortSeries(ofBrand), ...sortSeries(others)])];
}
