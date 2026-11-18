/**
 * Purchase prices (products.buyprice) — visible to everyone except resellers,
 * enforced by the database (migration 20261119130000_role_company_rules.sql):
 *
 *  • products.buyprice cannot be read with the public API any more, so a
 *    `select('*')` on products is refused: read PRODUCT_COLUMNS instead.
 *  • the purchase prices come from the view product_costs, which is empty
 *    for resellers (no error: their catalogue simply has no purchase price).
 *  • they are written with saveProductCosts() (an upsert cannot set the
 *    column any more; a plain update still can).
 *
 * Every function also works on a database that has not run the migration yet
 * (the front end ships first): it then reads and writes products.buyprice.
 */
import { supabase } from './supabaseClient';
import { readAll, type Pageable } from './readAll';
import type { Product, QuoteItem } from '../types';

/** Every products column the app reads, purchase price excepted. */
export const PRODUCT_COLUMNS =
  'barcode, name, brand, image, kiosk_category, sector_ids, series, techsheet, price, reseller_price, provider, stock_levels, created_at, updated_at';

export type ProductCosts = Map<string, number>;

/** A table, view or function this database does not have (migration not run). */
export function isMissingDbObject(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === 'PGRST202' || e.code === '42883'
    || /could not find the (table|function)/i.test(e.message || ''));
}

type CostRow = { barcode: string; buyprice: number | string | null };
type DbError = { code?: string; message: string };

// The view and the function are newer than the generated database types.
interface CostQuery extends PromiseLike<{ data: CostRow[] | null; error: DbError | null }> {
  select(columns: string): CostQuery;
  in(column: string, values: string[]): CostQuery;
  order(column: string, options?: { ascending?: boolean }): CostQuery;
  range(from: number, to: number): CostQuery;
}
interface LooseDb {
  from(table: string): CostQuery;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}
const db = () => supabase as unknown as LooseDb;

const toCosts = (rows: CostRow[]): ProductCosts =>
  new Map(rows.filter(r => r?.barcode).map(r => [r.barcode, Number(r.buyprice) || 0]));

async function readCosts(source: 'product_costs' | 'products', barcodes?: string[]): Promise<CostRow[]> {
  if (!barcodes) {
    return readAll<CostRow>(() => db().from(source).select('barcode, buyprice') as Pageable<CostRow>, 'barcode');
  }
  const rows: CostRow[] = [];
  for (let i = 0; i < barcodes.length; i += 200) {
    const { data, error } = await db().from(source).select('barcode, buyprice').in('barcode', barcodes.slice(i, i + 200));
    if (error) throw error;
    rows.push(...((data || []) as CostRow[]));
  }
  return rows;
}

/**
 * Purchase prices by barcode (all products, or only `barcodes`). Empty for a
 * reseller. Never throws: without purchase prices the app still works (they
 * show as 0), so a failed read must not stop the catalogue from loading.
 */
export async function loadProductCosts(barcodes?: string[]): Promise<ProductCosts> {
  const wanted = barcodes ? [...new Set(barcodes.filter(Boolean))] : undefined;
  if (wanted && wanted.length === 0) return new Map();
  try {
    return toCosts(await readCosts('product_costs', wanted));
  } catch (error) {
    if (isMissingDbObject(error)) {
      try { return toCosts(await readCosts('products', wanted)); } catch (e) { console.warn('[costs] purchase prices not loaded:', e); return new Map(); }
    }
    console.warn('[costs] purchase prices not loaded:', error);
    return new Map();
  }
}

/** Products with their purchase price filled in (0 when unknown or hidden). */
export function withProductCosts<T extends { barcode: string; buyprice?: number }>(products: T[], costs: ProductCosts): (T & { buyprice: number })[] {
  return products.map(p => ({ ...p, buyprice: costs.get(p.barcode) ?? 0 }));
}

/**
 * Document lines no longer store the catalogue purchase price (the database
 * removes it on save): put the current one back for the margin tools. A line
 * that still has one (saved before, or typed by hand) keeps it; a line whose
 * product has none visible gets 0, never undefined (margin maths stay numeric).
 */
export function withItemCosts(items: QuoteItem[], costs: ProductCosts): QuoteItem[] {
  return items.map(item => {
    const product = item?.product as (Product & { buyprice?: number }) | undefined;
    if (!product || typeof product !== 'object') return item;
    const stored = product.buyprice;
    if (stored !== undefined && stored !== null && !Number.isNaN(Number(stored))) return item;
    return { ...item, product: { ...product, buyprice: costs.get(product.barcode) ?? 0 } };
  });
}

/** Barcodes of the lines whose purchase price is missing. */
export function itemsMissingCosts(items: QuoteItem[]): string[] {
  return [...new Set(items
    .filter(item => item?.product && (item.product.buyprice === undefined || item.product.buyprice === null))
    .map(item => item.product.barcode)
    .filter(Boolean))];
}

/** Fill in the purchase prices of a document's lines (one request at most). */
export async function hydrateItemCosts(items: QuoteItem[]): Promise<QuoteItem[]> {
  const missing = itemsMissingCosts(items);
  if (missing.length === 0) return items;
  return withItemCosts(items, await loadProductCosts(missing));
}

/** `{barcode, buyprice}` pairs of products, one per barcode (the last wins). */
export function costRows(products: Array<{ barcode: string; buyprice?: number | null }>): Array<{ barcode: string; buyprice: number }> {
  const byBarcode = new Map<string, number>();
  for (const p of products) if (p?.barcode) byBarcode.set(p.barcode, Number(p.buyprice) || 0);
  return [...byBarcode].map(([barcode, buyprice]) => ({ barcode, buyprice }));
}

const NOT_ALLOWED = '42501';

/**
 * True when purchase prices must be saved apart from the products (the
 * database has stocky_set_product_costs). False before the migration: the
 * products upsert then carries buyprice, as it always did.
 */
export async function costsSavedSeparately(): Promise<boolean> {
  const { error } = await db().rpc('stocky_set_product_costs', { p_costs: [] });
  return !error || !isMissingDbObject(error);
}

/**
 * Save purchase prices, after the products themselves were saved without
 * them. A reseller's purchase prices are ignored (the database refuses them).
 */
export async function saveProductCosts(products: Array<{ barcode: string; buyprice?: number | null }>): Promise<void> {
  const rows = costRows(products);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().rpc('stocky_set_product_costs', { p_costs: rows.slice(i, i + 500) });
    if (!error) continue;
    if (error.code === NOT_ALLOWED) { console.warn('[costs] purchase prices not saved: not allowed for this account'); return; }
    throw new Error(`Prix d'achat : ${error.message}`);
  }
}
