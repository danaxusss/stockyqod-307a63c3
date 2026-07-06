import { supabase } from '../../utils/supabaseClient';
import { StockService } from '../../utils/supabaseStock';
import type { Quote, QuoteItem, Product } from '../../types';

/** Has this document already posted stock movements? (idempotency guard) */
export async function isDocumentStockPosted(sourceId: string): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from('stock_movements').select('id').eq('source_id', sourceId).limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

function itemBarcode(item: QuoteItem): string | null {
  return item.quoteBarcode || item.product?.barcode || null;
}

/**
 * Resolve the stock_levels key to decrement for a dispatch entry / item.
 * Products use loose keys (abbrev/name/normalized). Prefer a key that already
 * exists in the product's stock_levels; else fall back to the abbrev/name.
 */
function resolveKey(product: Product | undefined, candidates: (string | undefined)[]): string | null {
  const clean = candidates.map(c => (c || '').trim()).filter(Boolean);
  if (clean.length === 0) return null;
  const levels = product?.stock_levels || {};
  const existing = Object.keys(levels);
  for (const c of clean) {
    const hit = existing.find(k =>
      k === c || k.toLowerCase() === c.toLowerCase() ||
      k.toLowerCase().replace(/\s+/g, '_') === c.toLowerCase().replace(/\s+/g, '_')
    );
    if (hit) return hit;
  }
  return clean[0];
}

export interface PostResult { posted: number; skipped: number; skippedItems: string[]; }

/**
 * Post stock-OUT movements for a delivered document (BL). Idempotent by
 * source_id. Uses each item's dispatch locations; items without a resolvable
 * location or barcode are skipped and reported.
 */
export async function postDocumentStockOut(
  doc: Quote,
  opts: { createdBy?: string | null } = {}
): Promise<PostResult> {
  if (await isDocumentStockPosted(doc.id)) return { posted: 0, skipped: 0, skippedItems: [] };

  const products = await StockService.getProducts();
  const byBarcode = new Map(products.map(p => [p.barcode, p]));

  let posted = 0, skipped = 0;
  const skippedItems: string[] = [];
  const touchedBarcodes: string[] = [];

  for (const item of doc.items) {
    const barcode = itemBarcode(item);
    if (!barcode) { skipped++; skippedItems.push(item.quoteName || 'Article sans code'); continue; }
    const product = byBarcode.get(barcode);

    // Build the list of (locationKey, qty) targets for this item.
    const targets: { key: string; qty: number; locId: string | null }[] = [];
    if (item.dispatch && item.dispatch.length > 0) {
      for (const d of item.dispatch) {
        const key = resolveKey(product, [d.stock_location_abbrev, d.stock_location_name]);
        if (key && d.quantity > 0) targets.push({ key, qty: d.quantity, locId: d.stock_location_id || null });
      }
    } else {
      // No dispatch: if the product has exactly one location with stock, use it.
      const levels = product?.stock_levels || {};
      const withStock = Object.entries(levels).filter(([, v]) => Number(v) > 0);
      if (withStock.length === 1) targets.push({ key: withStock[0][0], qty: item.quantity, locId: null });
    }

    if (targets.length === 0) { skipped++; skippedItems.push(item.quoteName || barcode); continue; }

    for (const t of targets) {
      await StockService.applyMovement({
        barcode,
        locationKey: t.key,
        type: 'out',
        quantity: t.qty,
        reason: `BL ${doc.quoteNumber}`,
        sourceType: 'bl',
        sourceId: doc.id,
        createdBy: opts.createdBy ?? null,
        locationId: t.locId,
      });
      posted++;
    }
    touchedBarcodes.push(barcode);
  }

  if (touchedBarcodes.length > 0) {
    const { notifyLowStock } = await import('./lowStockAlert');
    void notifyLowStock(touchedBarcodes);
  }

  return { posted, skipped, skippedItems };
}

/**
 * Post stock-IN (return) movements for a credit note / return document (avoir):
 * returned goods go back into stock. Idempotent by source_id. Uses each item's
 * dispatch locations; falls back to the item's single stocked location.
 */
export async function postDocumentStockReturn(
  doc: Quote,
  opts: { createdBy?: string | null } = {}
): Promise<PostResult> {
  if (await isDocumentStockPosted(doc.id)) return { posted: 0, skipped: 0, skippedItems: [] };

  const products = await StockService.getProducts();
  const byBarcode = new Map(products.map(p => [p.barcode, p]));

  let posted = 0, skipped = 0;
  const skippedItems: string[] = [];

  for (const item of doc.items) {
    const barcode = itemBarcode(item);
    if (!barcode) { skipped++; skippedItems.push(item.quoteName || 'Article sans code'); continue; }
    const product = byBarcode.get(barcode);

    const targets: { key: string; qty: number; locId: string | null }[] = [];
    if (item.dispatch && item.dispatch.length > 0) {
      for (const d of item.dispatch) {
        const key = resolveKey(product, [d.stock_location_abbrev, d.stock_location_name]);
        if (key && d.quantity > 0) targets.push({ key, qty: d.quantity, locId: d.stock_location_id || null });
      }
    } else {
      // No dispatch: return to the item's single stocked location, else the
      // first known location on the product.
      const levels = product?.stock_levels || {};
      const keys = Object.keys(levels);
      const withStock = Object.entries(levels).filter(([, v]) => Number(v) > 0);
      const key = withStock.length === 1 ? withStock[0][0] : (keys[0] || null);
      if (key) targets.push({ key, qty: item.quantity, locId: null });
    }

    if (targets.length === 0) { skipped++; skippedItems.push(item.quoteName || barcode); continue; }

    for (const t of targets) {
      await StockService.applyMovement({
        barcode,
        locationKey: t.key,
        type: 'return',
        quantity: t.qty,
        reason: `Avoir ${doc.quoteNumber}`,
        sourceType: 'return',
        sourceId: doc.id,
        createdBy: opts.createdBy ?? null,
        locationId: t.locId,
      });
      posted++;
    }
  }

  return { posted, skipped, skippedItems };
}

/**
 * Reverse a document's stock movements (e.g. avoir / annulation): posts the
 * opposite of every movement recorded under sourceId, tagged as a return.
 */
export async function reverseDocumentStock(
  sourceId: string,
  reference: string,
  opts: { createdBy?: string | null } = {}
): Promise<number> {
  const moves = await StockService.getMovements({ limit: 1000 });
  const original = moves.filter(m => m.source_id === sourceId && (m.type === 'out' || m.type === 'in'));
  let count = 0;
  for (const m of original) {
    await StockService.applyMovement({
      barcode: m.barcode,
      locationKey: m.location_key,
      // reverse: an 'out' (negative qty) comes back as a positive 'return'
      type: m.quantity < 0 ? 'return' : 'adjustment',
      quantity: Math.abs(m.quantity) * (m.quantity < 0 ? 1 : -1),
      reason: `Annulation ${reference}`,
      sourceType: 'return',
      sourceId: `reversal:${sourceId}`,
      createdBy: opts.createdBy ?? null,
      locationId: m.location_id,
    });
    count++;
  }
  return count;
}
