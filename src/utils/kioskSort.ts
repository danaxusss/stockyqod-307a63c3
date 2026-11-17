// Kiosk catalogue order and series helpers (kept apart from kioskService,
// which tests replace with a mock).

/** Catalogue order on the kiosk; price sorts only where prices are shown. */
export const KIOSK_SORTS = ['relevance', 'price_asc', 'price_desc', 'name', 'available', 'newest'] as const;
export type KioskSort = typeof KIOSK_SORTS[number];

/** Series in a natural order: 600, 700, 900, then names A to Z. */
export function sortSeries(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
  });
}
