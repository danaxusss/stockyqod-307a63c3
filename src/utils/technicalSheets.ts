import { supabase } from '../integrations/supabase/client';
import type { TechnicalSheet } from '../types';

const BUCKET = 'technical-sheets';
export const SHEET_MAX_BYTES = 50 * 1024 * 1024;

// Before the source_url migration the column is unknown to the database.
const missingSourceUrl = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204' || /source_url/.test(error.message || ''));

export async function loadAllSheets(): Promise<TechnicalSheet[]> {
  const { data, error } = await supabase.from('technical_sheets').select('*').order('title');
  if (error) throw error;
  return (data || []) as unknown as TechnicalSheet[];
}

export type SheetLink = Pick<TechnicalSheet, 'id' | 'title' | 'file_url'>;

/** Sheets linked to each product, by barcode (read in pages: the API caps rows per request). */
export async function loadSheetLinks(): Promise<Record<string, SheetLink[]>> {
  const links: Record<string, SheetLink[]> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('technical_sheet_products')
      .select('product_barcode, technical_sheets(id, title, file_url)')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of (data || []) as unknown as { product_barcode: string; technical_sheets: SheetLink | null }[]) {
      if (row.technical_sheets) (links[row.product_barcode] ||= []).push(row.technical_sheets);
    }
    if (!data || data.length < pageSize) return links;
  }
}

/** A sheet already stored from this web address, if any. */
export async function findSheetBySourceUrl(url: string): Promise<TechnicalSheet | null> {
  const { data, error } = await supabase.from('technical_sheets').select('*').eq('source_url', url).limit(1);
  if (error) return null;
  return ((data || [])[0] as TechnicalSheet) || null;
}

/** Link a sheet to a product; linking twice is not an error. */
export async function linkSheetToProduct(sheetId: string, barcode: string): Promise<void> {
  const { error } = await supabase.from('technical_sheet_products').insert({ sheet_id: sheetId, product_barcode: barcode });
  if (error && error.code !== '23505') throw error;
}

/** Store a file in the technical sheet library (storage + table row). */
export async function createSheetFromFile(file: File, meta: { title: string; manufacturer: string; sourceUrl?: string | null }): Promise<TechnicalSheet> {
  if (file.size > SHEET_MAX_BYTES) throw new Error('Fichier trop volumineux (max 50 Mo)');
  const id = crypto.randomUUID();
  const extension = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const path = `${id}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (uploadError) throw uploadError;
  const fileUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const row = {
    id, title: meta.title.slice(0, 200), manufacturer: meta.manufacturer || '', category: '',
    file_url: fileUrl, file_size: file.size, file_type: file.type || 'application/pdf',
  };
  let { error } = await supabase.from('technical_sheets').insert({ ...row, source_url: meta.sourceUrl || null });
  if (missingSourceUrl(error)) ({ error } = await supabase.from('technical_sheets').insert(row));
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
  const now = new Date().toISOString();
  return { ...row, sector: '', view_count: 0, download_count: 0, created_at: now, updated_at: now, source_url: meta.sourceUrl || null };
}
