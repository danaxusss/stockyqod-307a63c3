// Matching for the global search (Ctrl K): products from the local catalogue,
// pages from the user's menu. Accents and case are ignored; every word typed
// must appear somewhere. References also match without their separators, so
// "7410CEEPT", "74/10ceept" and "10CEEPT" all find "74/10CEEPT".

import type { Product } from '../types';
import type { NavModule } from '../lib/navigation';

export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Letters and digits only: "74/10-CEEPT" → "7410ceept". */
export const compact = (s: string) => normalize(s).replace(/[^a-z0-9]/g, '');

const words = (q: string) => normalize(q).split(/[\s,;]+/).filter(Boolean);

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/.test(c);

/** True when `term` starts a word of `text` (both normalized); `whole`: and ends it. */
const startsWord = (text: string, term: string, whole = false) => {
  let from = text.indexOf(term);
  while (from !== -1) {
    if (!isWordChar(text[from - 1]) && (!whole || !isWordChar(text[from + term.length]))) return true;
    from = text.indexOf(term, from + 1);
  }
  return false;
};

export interface ProductSearchOptions {
  limit?: number;
  allowed?: (p: Product) => boolean;
  /** Other names the product is known by (renamed brands, supplier…). */
  extraText?: (p: Product) => string;
}

/**
 * Best products for the query: same reference, then references starting with
 * it, then names starting with it, then whole words, then word starts
 * ("four" before "fournisseur"), then the rest.
 */
export function searchProducts(products: Product[], query: string, limitOrOptions: number | ProductSearchOptions = 6, allowedArg?: (p: Product) => boolean): Product[] {
  const options: ProductSearchOptions = typeof limitOrOptions === 'number' ? { limit: limitOrOptions, allowed: allowedArg } : limitOrOptions;
  const { limit = 6, allowed = () => true, extraText } = options;
  const terms = words(query);
  if (!terms.length) return [];
  const q = normalize(query);
  const qCompact = compact(query);
  const scored: { p: Product; score: number }[] = [];
  for (const p of products) {
    const name = normalize(p.name || '');
    const code = normalize(p.barcode || '');
    const codeCompact = compact(p.barcode || '');
    const hay = `${name} ${normalize(p.brand || '')} ${code} ${extraText ? normalize(extraText(p)) : ''}`;
    const hayCompact = `${codeCompact} ${hay.replace(/[^a-z0-9 ]/g, '')}`;
    const wholeCode = qCompact.length >= 3 && codeCompact.includes(qCompact);
    if (!wholeCode && !terms.every(t => hay.includes(t) || (compact(t) && hayCompact.includes(compact(t))))) continue;
    if (!allowed(p)) continue;
    let score = 6;
    if (qCompact && codeCompact === qCompact) score = 0;
    else if (qCompact && codeCompact.startsWith(qCompact)) score = 1;
    else if (name.startsWith(q) && !isWordChar(name[q.length])) score = 2;
    else if (terms.every(t => startsWord(hay, t, true))) score = 3;
    else if (terms.every(t => startsWord(hay, t))) score = 4;
    else if (wholeCode) score = 5;
    scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.p.name || '').localeCompare(b.p.name || '', 'fr'))
    .slice(0, limit)
    .map(s => s.p);
}

export interface PageHit {
  to: string; label: string; module: string;
  /** What was typed is the page's name or short name ("bl", "tva"): show pages first. */
  strong?: boolean;
}

/** Short names people type for a page. */
export const PAGE_ALIASES: Record<string, string> = {
  '/': 'accueil home tableau de bord',
  '/search': 'recherche chercher produits stock',
  '/quote-cart': 'creer devis panier',
  '/quotes-history': 'devis historique',
  '/compta/invoices': 'fa facture',
  '/compta/bls': 'bl livraison',
  '/compta/proformas': 'pf proforma',
  '/compta/avoirs': 'av avoir credit',
  '/compta/bons-commande': 'bc commande client',
  '/compta/returns': 'retour',
  '/compta/factures-fournisseurs': 'ff facture fournisseur achat',
  '/compta/fournisseurs': 'fournisseur ice attestation regularite',
  '/compta/delais-paiement': 'delai paiement 69-21 amende retard simpl',
  '/inventaire/commandes': 'bc achat fournisseur',
  '/inventaire/reception': 'reception achat',
  '/inventaire/bons': 'be bs bon entree sortie casse perte stock initial',
  '/inventaire/stock-comptable': 'inventaire detaille valorisation cloture bilan 3111 cmup',
  '/comptabilite/tva': 'tva',
  '/photos': 'photo image',
  '/photos/finder': 'photo image recherche internet',
  '/admin/settings': 'parametres reglages settings configuration',
  '/paie/parametres': 'parametres paie',
  '/admin/users': 'utilisateurs users pin',
};

/**
 * Pages of the user's menu whose name, module or alias matches. Pages whose
 * words start with what was typed come first ("bl" → "Bons de livraison",
 * not "Tableau").
 */
export function searchPages(modules: NavModule[], query: string, limit = 5): PageHit[] {
  const terms = words(query);
  if (!terms.length) return [];
  const hits: { hit: PageHit; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of modules) {
    for (const item of m.items) {
      if (seen.has(item.to)) continue;
      const hay = normalize(`${item.label} ${m.label} ${PAGE_ALIASES[item.to] || ''}`);
      if (!terms.every(t => hay.includes(t))) continue;
      seen.add(item.to);
      const label = normalize(item.label);
      const alias = normalize(PAGE_ALIASES[item.to] || '');
      const strong = label === terms.join(' ') || terms.every(t => startsWord(alias, t, true));
      const score = strong || label.startsWith(terms.join(' ')) ? 0 : terms.every(t => startsWord(hay, t)) ? 1 : 2;
      hits.push({ hit: { to: item.to, label: item.label, module: m.label, ...(strong ? { strong } : {}) }, score });
    }
  }
  // Words found inside other words ("bl" in "tableau") only when nothing better.
  const best = Math.min(...hits.map(h => h.score));
  return hits.filter(h => h.score < 2 || best === 2).sort((a, b) => a.score - b.score).slice(0, limit).map(h => h.hit);
}

/**
 * Text for a PostgREST ilike filter. Wildcards are escaped; commas, brackets
 * and quotes (which break an or() filter) match any single character instead.
 */
export function ilikePattern(query: string): string {
  return `%${query.trim().replace(/[%_\\]/g, m => `\\${m}`).replace(/[,()"]/g, '_')}%`;
}

/**
 * ilike pattern for a document number typed loosely: letters and digits keep
 * their order, anything may sit between groups ("BL12" and "bl 12" find
 * "BL-0012").
 */
export function documentNumberPattern(query: string): string | null {
  const groups = compact(query).match(/[a-z]+|\d+/g);
  return groups ? `%${groups.join('%')}%` : null;
}

/**
 * ilike pattern for one word of a name: vowels and c stand for any letter so
 * that "societe" also finds "Société" (the exact check happens on the results,
 * see nameMatches).
 */
export function accentLoosePattern(word: string): string {
  const w = normalize(word).replace(/[%_\\,()"]/g, '');
  return `%${w.replace(/[aeiouyc]/g, '_')}%`;
}

/** Every typed word starts a word of the name, whatever the accents and the order. */
export const nameMatches = (name: string, query: string) => {
  const hay = normalize(name);
  return words(query).every(t => startsWord(hay, t));
};
