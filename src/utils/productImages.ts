import { supabase } from '@/integrations/supabase/client';
import type { Product } from '../types';
import {
  isSupportedProductImage,
  PRODUCT_IMAGE_MAX_BYTES,
} from './productImageBatch';

export {
  analyzeProductImageFiles,
  productBarcodeFromFilename,
  PRODUCT_IMAGE_BATCH_LIMIT,
  PRODUCT_IMAGE_MAX_BYTES,
  type ProductImageBatchAnalysis,
  type ProductImageCandidate,
  type ProductImageIssue,
} from './productImageBatch';

export const PRODUCT_IMAGE_MAX_DIMENSION = 1200;

const JPEG_QUALITY = 0.86;

export function resolveProductImageUrl(image?: string | null): string | null {
  if (!image) return null;
  if (!image.includes('/')) return `${import.meta.env.BASE_URL || '/'}catalogue-images/${image}`;
  return supabase.storage.from('product-photos').getPublicUrl(image).data.publicUrl;
}

export function compressProductImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = image.naturalWidth || image.width;
      let height = image.naturalHeight || image.height;
      if (!width || !height) {
        reject(new Error('Image illisible'));
        return;
      }

      const scale = Math.min(1, PRODUCT_IMAGE_MAX_DIMENSION / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Compression indisponible'));
        return;
      }

      // JPEG has no transparency; a white background avoids black areas on PNG files.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('Compression impossible'));
          return;
        }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      }, 'image/jpeg', JPEG_QUALITY);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image illisible'));
    };
    image.src = objectUrl;
  });
}

async function removeUploadedImage(photoId: string, storagePath: string) {
  await supabase.from('product_photo_products').delete().eq('photo_id', photoId);
  await supabase.from('product_photos').delete().eq('id', photoId);
  await supabase.storage.from('product-photos').remove([storagePath]);
}

async function cleanPreviousPrimaryImage(storagePath: string, barcode: string) {
  if (!storagePath.includes('/')) return;

  const { data: photos } = await supabase
    .from('product_photos')
    .select('id')
    .eq('storage_path', storagePath)
    .limit(1);
  const photoId = photos?.[0]?.id as string | undefined;
  if (!photoId) return;

  const { data: links } = await supabase
    .from('product_photo_products')
    .select('barcode')
    .eq('photo_id', photoId);
  const linkedBarcodes = (links || []).map((link: { barcode: string }) => link.barcode);
  if (linkedBarcodes.some(linkedBarcode => linkedBarcode !== barcode)) return;

  await removeUploadedImage(photoId, storagePath);
}

export async function uploadPrimaryProductImage(args: {
  product: Pick<Product, 'barcode' | 'name' | 'image'>;
  file: File;
  companyId: string;
  createdBy?: string | null;
  replaceExisting?: boolean;
}): Promise<string> {
  const { product, file, companyId, createdBy, replaceExisting = false } = args;
  if (!companyId) throw new Error('Aucune société associée');
  if (!isSupportedProductImage(file.name)) throw new Error('Format accepté : JPG, PNG ou WebP');
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) throw new Error('Image trop volumineuse (maximum 10 Mo)');
  if (product.image && !replaceExisting) throw new Error('Une image existe déjà pour ce produit');

  const compressed = await compressProductImage(file);
  const photoId = crypto.randomUUID();
  const safeBarcode = encodeURIComponent(product.barcode);
  const storagePath = `${companyId}/primary/${safeBarcode}-${Date.now()}-${photoId.slice(0, 8)}.jpg`;
  const previousImage = product.image || null;

  const { error: uploadError } = await supabase.storage
    .from('product-photos')
    .upload(storagePath, compressed, { upsert: false, contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;

  try {
    const { error: photoError } = await supabase.from('product_photos').insert({
      id: photoId,
      company_id: companyId,
      title: product.name || product.barcode,
      storage_path: storagePath,
      file_name: compressed.name,
      file_size: compressed.size,
      created_by: createdBy || null,
    });
    if (photoError) throw photoError;

    const { error: linkError } = await supabase.from('product_photo_products').insert({
      photo_id: photoId,
      barcode: product.barcode,
      product_name: product.name || product.barcode,
    });
    if (linkError) throw linkError;

    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update({ image: storagePath })
      .eq('barcode', product.barcode)
      .select('barcode')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedProduct) throw new Error(`Produit ${product.barcode} introuvable dans Stocky`);
  } catch (error) {
    await removeUploadedImage(photoId, storagePath).catch(() => undefined);
    throw error;
  }

  if (previousImage && previousImage !== storagePath) {
    await cleanPreviousPrimaryImage(previousImage, product.barcode).catch(() => undefined);
  }
  return storagePath;
}

export async function loadCurrentProductImages(barcodes: string[]): Promise<Map<string, string | null>> {
  const images = new Map<string, string | null>();
  const uniqueBarcodes = Array.from(new Set(barcodes.filter(Boolean)));
  for (let index = 0; index < uniqueBarcodes.length; index += 200) {
    const { data, error } = await supabase
      .from('products')
      .select('barcode, image')
      .in('barcode', uniqueBarcodes.slice(index, index + 200));
    if (error) throw error;
    for (const row of data || []) images.set(row.barcode, row.image || null);
  }
  return images;
}
