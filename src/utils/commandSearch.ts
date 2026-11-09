// Matching for the global search (Ctrl K): products from the local catalogue,
// pages from the user's menu. Accents and case are ignored; every word typed
// must appear somewhere.

import type { Product } from '../types';
import type { NavModule } from '../lib/navigation';

export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const words = (q: string) => normalize(q).split(/\s+/).filter(Boolean);

/** Best products for the query: exact barcode, then names starting with it, then the rest. */
export function searchProducts(products: Product[], query: string, limit = 6, allowed: (p: Product) => boolean = () => true): Product[] {
  const terms = words(query);
  if (!terms.length) return [];
  const q = normalize(query);
  const scored: { p: Product; score: number }[] = [];
  for (const p of products) {
    const name = normalize(p.name || '');
    const hay = `${name} ${normalize(p.brand || '')} ${p.barcode}`;
    if (!terms.every(t => hay.includes(t))) continue;
    if (!allowed(p)) continue;
    let score = 3;
    if (p.barcode === query.trim()) score = 0;
    else if (p.barcode.startsWith(query.trim())) score = 1;
    else if (name.startsWith(q)) score = 2;
    scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.p.name || '').localeCompare(b.p.name || '', 'fr'))
    .slice(0, limit)
    .map(s => s.p);
}

export interface PageHit { to: string; label: string; module: string; }

/** Pages of the user's menu whose name (or module name) matches. */
export function searchPages(modules: NavModule[], query: string, limit = 4): PageHit[] {
  const terms = words(query);
  if (!terms.length) return [];
  const hits: PageHit[] = [];
  for (const m of modules) {
    for (const item of m.items) {
      const hay = normalize(`${item.label} ${m.label}`);
      if (terms.every(t => hay.includes(t))) hits.push({ to: item.to, label: item.label, module: m.label });
    }
  }
  return hits.slice(0, limit);
}

/** Text for a PostgREST ilike filter: wildcards and separators escaped. */
export function ilikePattern(query: string): string {
  return `%${query.trim().replace(/[%_\\]/g, m => `\\${m}`).replace(/[,()"]/g, ' ')}%`;
}
