import { supabase } from '../integrations/supabase/client';
import type { Product } from '../types';

export type ClassificationChange = Partial<Pick<Product, 'kiosk_category' | 'sector_ids'>>;

export type ClassificationSaveResult = {
  saved: Record<string, ClassificationChange>;
  failed: Array<{ barcode: string; message: string }>;
};

const PARALLEL_UPDATES = 6;

/**
 * Save kiosk type / sector changes for many products. Each product is its
 * own update (values differ per product); a failure on one does not stop
 * the others, and an update that matched no row counts as a failure.
 */
export async function saveProductClassifications(changes: Record<string, ClassificationChange>): Promise<ClassificationSaveResult> {
  const entries = Object.entries(changes).filter(([, change]) => Object.keys(change).length > 0);
  const result: ClassificationSaveResult = { saved: {}, failed: [] };
  for (let index = 0; index < entries.length; index += PARALLEL_UPDATES) {
    await Promise.all(entries.slice(index, index + PARALLEL_UPDATES).map(async ([barcode, change]) => {
      const values = {
        ...('kiosk_category' in change ? { kiosk_category: change.kiosk_category ?? null } : {}),
        ...('sector_ids' in change ? { sector_ids: change.sector_ids ?? [] } : {}),
      };
      const { data, error } = await supabase.from('products').update(values).eq('barcode', barcode).select('barcode');
      if (error) result.failed.push({ barcode, message: error.message });
      else if (!data?.length) result.failed.push({ barcode, message: 'Produit introuvable' });
      else result.saved[barcode] = values;
    }));
  }
  return result;
}

const sameSectors = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every(id => b.includes(id));

/** Drop fields equal to the product's saved values, so only real edits are kept. */
export function effectiveChange(product: Pick<Product, 'kiosk_category' | 'sector_ids'>, change: ClassificationChange): ClassificationChange {
  const next: ClassificationChange = {};
  if ('kiosk_category' in change && (change.kiosk_category ?? null) !== (product.kiosk_category ?? null)) next.kiosk_category = change.kiosk_category ?? null;
  if ('sector_ids' in change && !sameSectors(change.sector_ids, product.sector_ids)) next.sector_ids = change.sector_ids ?? [];
  return next;
}
