import type { Product } from '../types';

export type SheetFileMatch = {
  file: File;
  /** Products whose code is the file name; empty when nothing matches. */
  products: Product[];
};

/**
 * Bulk sheet import, same rule as the product image import: the file name
 * (without extension) is the product code. One sheet can cover several
 * products: "CODE1+CODE2.pdf" (also "," or ";"). Codes are matched exactly,
 * then ignoring case when that finds a single product.
 */
export function matchSheetFiles(files: File[], products: Pick<Product, 'barcode' | 'name' | 'brand'>[]): SheetFileMatch[] {
  const exact = new Map(products.map(product => [product.barcode.trim(), product]));
  const folded = new Map<string, (typeof products)[number] | null>();
  for (const product of products) {
    const key = product.barcode.trim().toUpperCase();
    folded.set(key, folded.has(key) ? null : product); // null: ambiguous
  }
  const find = (code: string) => exact.get(code) || folded.get(code.toUpperCase()) || null;

  return files.map(file => {
    const stem = file.name.trim().replace(/\.[^/.]+$/, '').trim();
    const whole = find(stem);
    const codes = whole ? [stem] : stem.split(/\s*[+,;]\s*/).filter(Boolean);
    const found = whole ? [whole] : codes.length > 1 ? codes.map(find) : [];
    // A list of codes only counts when every code is a product (no partial guesses).
    const matched = found.length && found.every(Boolean) ? found as Product[] : [];
    return { file, products: Array.from(new Map(matched.map(product => [product.barcode, product])).values()) };
  });
}

/** Library title of a sheet named after its products' codes. */
export function matchedSheetTitle(products: Pick<Product, 'name'>[], fallback: string): string {
  if (!products.length) return fallback;
  const names = Array.from(new Set(products.map(product => product.name.trim()).filter(Boolean)));
  return (names.length ? names.join(' / ') : fallback).slice(0, 200);
}
