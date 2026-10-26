import type { Product, TechnicalSheet } from '../types';
import { buildImageQuery } from './imageSearch';

export type SheetDocumentKind = 'pdf' | 'doc' | 'docx';

export type SheetSearchResult = {
  url: string;
  title: string;
  snippet: string;
  source: string;
  kind: SheetDocumentKind | null;
};

export type SheetQueryFlavor = 'fr' | 'en' | 'reference';

/** Search text for a product's technical sheet ("brand name fiche technique"…). */
export function buildSheetQuery(product: Pick<Product, 'name' | 'brand' | 'barcode'>, flavor: SheetQueryFlavor = 'fr'): string {
  const base = buildImageQuery(product);
  if (flavor === 'en') return `${base} datasheet`;
  if (flavor === 'reference') return `${product.brand || ''} "${product.barcode}"`.trim();
  return `${base} fiche technique`;
}

export function googleDocumentSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} filetype:pdf`)}`;
}

/** Library title for a sheet found on the web: the page title without "[PDF]", site names and the like. */
export function sheetTitle(result: Pick<SheetSearchResult, 'title' | 'url'>, fallback: string): string {
  let title = (result.title || '')
    .replace(/^\s*\[(pdf|doc|docx)\]\s*/i, '')
    .replace(/\s*[|–—]\s*[^|–—]{2,40}$/, '')
    .replace(/\s+-\s+(pdf|doc|docx)$/i, '')
    .replace(/\.(pdf|docx?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 3) title = fallback;
  return title.slice(0, 120);
}

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Sheets already in Stocky that probably cover this product: most of the
 * product's significant words (and ideally its brand) appear in the sheet's
 * title or manufacturer. Linked sheets are left out.
 */
export function libraryMatches(
  sheets: TechnicalSheet[],
  product: Pick<Product, 'name' | 'brand'>,
  linkedIds: string[] = [],
  limit = 6,
): TechnicalSheet[] {
  const words = Array.from(new Set(normalize(product.name || '').split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !/^\d+$/.test(word))));
  const brand = normalize(product.brand || '').trim();
  if (!words.length && !brand) return [];
  const needed = Math.min(2, Math.max(1, words.length));
  return sheets
    .filter(sheet => !linkedIds.includes(sheet.id))
    .map(sheet => {
      const haystack = normalize(`${sheet.title} ${sheet.manufacturer || ''}`);
      const wordHits = words.filter(word => haystack.includes(word)).length;
      const brandHit = !!brand && haystack.includes(brand);
      return { sheet, wordHits, score: wordHits + (brandHit ? 1 : 0) };
    })
    .filter(match => match.wordHits >= needed)
    .sort((a, b) => b.score - a.score || a.sheet.title.localeCompare(b.sheet.title))
    .slice(0, limit)
    .map(match => match.sheet);
}

export function kindLabel(kind: SheetDocumentKind | null | undefined): string {
  return kind ? kind.toUpperCase() : 'DOC';
}
