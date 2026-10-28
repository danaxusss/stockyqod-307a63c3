import type { Product, StockLocation } from '../../types';

// Products keep stock under loose keys (abbreviation, name or normalized name,
// depending on how they were imported). Same rule as the database function
// resolve_stock_location_key, so what a page shows is what gets posted.

const normalized = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, '_');

/** Keys a stock location may appear under, most specific first. */
export function locationCandidates(location: Pick<StockLocation, 'abbreviation' | 'name'> | null | undefined, ...extra: Array<string | null | undefined>): string[] {
  return [location?.abbreviation, location?.name, ...extra]
    .map(value => (value || '').trim())
    .filter((value, index, all) => value && all.indexOf(value) === index);
}

/** The product's existing key for these candidates, or null. */
export function findLevelKey(levels: Record<string, unknown> | null | undefined, candidates: string[]): string | null {
  const keys = Object.keys(levels || {});
  for (const candidate of candidates.map(value => value.trim()).filter(Boolean)) {
    const hit = keys.find(key => key === candidate)
      || keys.find(key => key.toLowerCase() === candidate.toLowerCase())
      || keys.find(key => normalized(key) === normalized(candidate));
    if (hit) return hit;
  }
  return null;
}

/** Stock of a product at a location, whatever key it is stored under. */
export function levelAt(product: Pick<Product, 'stock_levels'> | null | undefined, candidates: string[]): number {
  const key = findLevelKey(product?.stock_levels, candidates);
  return key ? Number(product?.stock_levels?.[key]) || 0 : 0;
}
