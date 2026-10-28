import { supabase } from '../../utils/supabaseClient';
import { StockService, type BatchMovement } from '../../utils/supabaseStock';
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

export interface PostResult { posted: number; skipped: number; skippedItems: string[]; negatives?: number; alreadyPosted?: boolean; }

type Target = { candidates: string[]; qty: number; locId: string | null };

/**
 * Lines of a document as stock movements. Lines without a product code, with a
 * code that is not a stocked product, or without a location to move are left
 * out and reported (the rest of the document still posts).
 */
function documentTargets(doc: Quote, byBarcode: Map<string, Product>, fallback: 'single' | 'single-or-first') {
  const lines: Array<{ barcode: string; targets: Target[] }> = [];
  const skippedItems: string[] = [];
  for (const item of doc.items) {
    const barcode = itemBarcode(item);
    const product = barcode ? byBarcode.get(barcode) : undefined;
    if (!barcode || !product) { skippedItems.push(item.quoteName || barcode || 'Article sans code'); continue; }

    const targets: Target[] = [];
    if (item.dispatch && item.dispatch.length > 0) {
      for (const d of item.dispatch) {
        const candidates = [d.stock_location_abbrev, d.stock_location_name].map(v => (v || '').trim()).filter(Boolean);
        if (candidates.length && d.quantity > 0) targets.push({ candidates, qty: d.quantity, locId: d.stock_location_id || null });
      }
    } else {
      const levels = product.stock_levels || {};
      const withStock = Object.entries(levels).filter(([, v]) => Number(v) > 0);
      const key = withStock.length === 1 ? withStock[0][0] : fallback === 'single-or-first' ? (Object.keys(levels)[0] || null) : null;
      if (key) targets.push({ candidates: [key], qty: item.quantity, locId: null });
    }

    if (targets.length === 0) { skippedItems.push(item.quoteName || barcode); continue; }
    lines.push({ barcode, targets });
  }
  return { lines, skippedItems };
}

/**
 * Post stock-OUT movements for a delivered document (BL): the whole BL in one
 * transaction, once (posting key "bl-out:<id>"), so a failure leaves nothing
 * half-posted and a retry or a second click cannot post it twice.
 */
export async function postDocumentStockOut(
  doc: Quote,
  opts: { createdBy?: string | null } = {}
): Promise<PostResult> {
  // BLs posted before atomic postings existed have movements but no posting key.
  if (await isDocumentStockPosted(doc.id)) return { posted: 0, skipped: 0, skippedItems: [], alreadyPosted: true };

  const products = await StockService.getProducts();
  const byBarcode = new Map(products.map(p => [p.barcode, p]));
  const { lines, skippedItems } = documentTargets(doc, byBarcode, 'single');
  const movements: BatchMovement[] = lines.flatMap(line => line.targets.map(t => ({
    barcode: line.barcode,
    locationKeys: t.candidates,
    type: 'out' as const,
    quantity: t.qty,
    reason: `BL ${doc.quoteNumber}`,
    sourceType: 'bl' as const,
    sourceId: doc.id,
    locationId: t.locId,
  })));
  if (movements.length === 0) return { posted: 0, skipped: skippedItems.length, skippedItems, negatives: 0 };

  const result = await StockService.applyMovements(`bl-out:${doc.id}`, movements, opts.createdBy ?? null);
  if (result.duplicate) return { posted: 0, skipped: 0, skippedItems: [], alreadyPosted: true };
  const negatives = result.movements.filter(m => m.balance_after != null && Number(m.balance_after) < 0).length;

  const touched = lines.map(line => line.barcode);
  if (touched.length > 0) {
    const { notifyLowStock } = await import('./lowStockAlert');
    void notifyLowStock(touched);
  }
  return { posted: result.movements.length, skipped: skippedItems.length, skippedItems, negatives };
}

/**
 * Post stock-IN (return) movements for a credit note / return document
 * (avoir): returned goods go back into stock, in one transaction, once
 * (posting key "return-in:<id>").
 */
export async function postDocumentStockReturn(
  doc: Quote,
  opts: { createdBy?: string | null } = {}
): Promise<PostResult> {
  if (await isDocumentStockPosted(doc.id)) return { posted: 0, skipped: 0, skippedItems: [], alreadyPosted: true };

  const products = await StockService.getProducts();
  const byBarcode = new Map(products.map(p => [p.barcode, p]));
  const { lines, skippedItems } = documentTargets(doc, byBarcode, 'single-or-first');
  const movements: BatchMovement[] = lines.flatMap(line => line.targets.map(t => ({
    barcode: line.barcode,
    locationKeys: t.candidates,
    type: 'return' as const,
    quantity: t.qty,
    reason: `Avoir ${doc.quoteNumber}`,
    sourceType: 'return' as const,
    sourceId: doc.id,
    locationId: t.locId,
  })));
  if (movements.length === 0) return { posted: 0, skipped: skippedItems.length, skippedItems };

  const result = await StockService.applyMovements(`return-in:${doc.id}`, movements, opts.createdBy ?? null);
  if (result.duplicate) return { posted: 0, skipped: 0, skippedItems: [], alreadyPosted: true };
  return { posted: result.movements.length, skipped: skippedItems.length, skippedItems };
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
