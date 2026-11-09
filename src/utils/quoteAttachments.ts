import { supabase } from './supabaseClient';
import { loadCurrentProductImages, resolveProductImageUrl } from './productImages';
import { getQuoteItemBrand, getQuoteItemName } from './quoteItemDisplay';
import type { QuoteItem, SharedProductImage } from '../types';

// Documents joined to a quote: the technical sheet of each product that has
// one, and the photo of each product that has none, so the client gets
// something for every product.

export interface QuoteAttachments {
  sheetIds: string[];
  images: SharedProductImage[];
}

export const NO_ATTACHMENTS: QuoteAttachments = { sheetIds: [], images: [] };

const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : new URL(url, window.location.origin).toString());

export async function findQuoteAttachments(items: QuoteItem[]): Promise<QuoteAttachments> {
  const barcodes = Array.from(new Set(items.map(i => i.product?.barcode).filter((b): b is string => !!b)));
  if (barcodes.length === 0) return NO_ATTACHMENTS;

  const { data, error } = await supabase
    .from('technical_sheet_products')
    .select('sheet_id, product_barcode')
    .in('product_barcode', barcodes);
  if (error) throw error;
  const rows = (data || []) as { sheet_id: string; product_barcode: string }[];
  const sheetIds = Array.from(new Set(rows.map(r => r.sheet_id)));
  const withSheet = new Set(rows.map(r => r.product_barcode));

  // Products without a sheet: their current photo, else the one in the quote.
  const withoutSheet = items.filter(i => i.product?.barcode && !withSheet.has(i.product.barcode));
  let current = new Map<string, string | null>();
  try { current = await loadCurrentProductImages(withoutSheet.map(i => i.product.barcode)); } catch { /* use the quote snapshot */ }
  const seen = new Set<string>();
  const images: SharedProductImage[] = [];
  for (const item of withoutSheet) {
    const barcode = item.product.barcode;
    if (seen.has(barcode)) continue;
    seen.add(barcode);
    const url = resolveProductImageUrl(current.get(barcode) ?? item.product.image ?? null);
    if (!url) continue;
    images.push({ barcode, name: getQuoteItemName(item), brand: getQuoteItemBrand(item) || '', url: absolute(url) });
  }
  return { sheetIds, images };
}

/** Label of the link printed on the quote. */
export function attachmentsLabel(a: QuoteAttachments): string {
  if (a.sheetIds.length && a.images.length) return 'Consulter les fiches techniques et photos';
  if (a.images.length) return 'Voir les photos des produits';
  return 'Consulter les fiches techniques';
}

/** Short summary for the quote page, e.g. "3 fiches · 2 photos". */
export function attachmentsSummary(a: QuoteAttachments): string {
  const parts: string[] = [];
  if (a.sheetIds.length) parts.push(`${a.sheetIds.length} fiche${a.sheetIds.length > 1 ? 's' : ''}`);
  if (a.images.length) parts.push(`${a.images.length} photo${a.images.length > 1 ? 's' : ''} (produits sans fiche)`);
  return parts.join(' · ');
}

/**
 * Public link listing the quote's sheets and photos. `expiryDays` null keeps
 * it forever. Before the product_images migration, sheets alone are shared.
 */
export async function createAttachmentsLink(
  quoteNumber: string,
  a: QuoteAttachments,
  expiryDays: number | null,
): Promise<{ url: string; expiryLabel: string; label: string; imagesDropped: boolean }> {
  const token = crypto.randomUUID();
  const row: Record<string, unknown> = {
    token,
    sheet_ids: a.sheetIds,
    title: `Devis ${quoteNumber}`,
    expires_at: expiryDays === null ? null : new Date(Date.now() + expiryDays * 86400000).toISOString(),
  };
  let imagesDropped = false;
  let { error } = await (supabase.from('sheet_share_links') as any).insert({ ...row, product_images: a.images });
  if (error && /product_images/.test(error.message || '')) {
    if (!a.sheetIds.length) throw new Error('Les photos ne peuvent pas encore être partagées : exécutez la migration 20261109120000_share_link_product_images.sql dans Supabase.');
    imagesDropped = true;
    ({ error } = await (supabase.from('sheet_share_links') as any).insert(row));
  }
  if (error) throw new Error(`Lien des fiches techniques : ${error.message}`);
  return {
    url: `${window.location.origin}/share/${token}`,
    expiryLabel: expiryDays === null ? 'permanent' : `${expiryDays} jours`,
    label: attachmentsLabel(imagesDropped ? { ...a, images: [] } : a),
    imagesDropped,
  };
}
